import {
  actionLiveBatchLimit,
  actionPreviewDigest,
  actionStopReason,
  appendActionCheckpoint,
  setActionJobControl,
  validateActionCompletion,
  validateActionObservation,
} from '../core/action-jobs.js';
import { getUnfollowProtectionReason } from '../core/queue.js';

function aborted(signal) {
  return Boolean(signal?.aborted);
}

function activity(kind, item, message, now = Date.now(), details = {}) {
  return {
    id: `${item.id}:${kind}:${now}`,
    timestamp: new Date(now).toISOString(),
    kind,
    message,
    details,
  };
}

async function checkpoint(job, callback) {
  await callback?.(job);
  return job;
}

function stopJob(job, reason, now = Date.now()) {
  const next = setActionJobControl(job, 'stopped', now);
  next.stopReason = reason;
  next.activity.push({
    id: `${next.id}:safe-stop:${now}`,
    timestamp: new Date(now).toISOString(),
    kind: 'safe-stop',
    message: `Action job stopped: ${reason}.`,
    details: { reason },
  });
  return next;
}

export async function executeReviewedActionJob(inputJob, {
  driver,
  ledger = null,
  settings = {},
  snapshot = null,
  signal,
  onCheckpoint,
  now = () => Date.now(),
} = {}) {
  if (!driver?.inspectSession || !driver?.resolveProfile) {
    throw new Error('The reviewed action adapter requires session and profile inspection.');
  }
  if (inputJob?.kind !== 'insta-aio-reviewed-action-job') {
    throw new Error('Select a reviewed action job.');
  }
  if (!['ready', 'paused', 'running'].includes(inputJob?.status)) {
    throw new Error('Confirm the reviewed action job before execution.');
  }
  if (!['dry-run', 'live'].includes(inputJob.mode) || !inputJob.confirmedAt) {
    throw new Error('Confirm the reviewed action mode before execution.');
  }
  if (
    !Array.isArray(inputJob.items)
    || actionPreviewDigest(inputJob.items) !== inputJob.previewDigest
  ) {
    throw new Error('The reviewed action preview changed after confirmation.');
  }
  if (inputJob.mode === 'live') {
    if (settings.liveActionEnabled !== true) {
      throw new Error('Live account actions are disabled in settings.');
    }
    const maximum = actionLiveBatchLimit(settings);
    if (inputJob.items.length > maximum) {
      throw new Error(
        `The live batch contains ${inputJob.items.length} items; the configured limit is ${maximum}.`,
      );
    }
    if (!driver.performReviewedAction || !ledger) {
      throw new Error('Live execution requires an action driver and transactional ledger.');
    }
  }

  let job = setActionJobControl(inputJob, 'running', now());
  await checkpoint(job, onCheckpoint);

  for (const sourceItem of job.items) {
    const item = job.items.find((candidate) => candidate.id === sourceItem.id);
    if (['dry-run-complete', 'completed', 'skipped'].includes(item.status)) continue;
    if (aborted(signal) || job.control === 'paused') {
      job = setActionJobControl(job, 'paused', now());
      return checkpoint(job, onCheckpoint);
    }

    if (item.action === 'unfollow') {
      const protectionReason = getUnfollowProtectionReason(
        { username: item.username },
        snapshot,
        settings,
      );
      if (protectionReason) {
        job = appendActionCheckpoint(job, item.id, {
          status: 'blocked',
          blockReason: protectionReason,
        }, {
          now: now(),
          activity: activity(
            'action-blocked',
            item,
            `Blocked protected unfollow target @${item.username}.`,
            now(),
            { protectionReason },
          ),
        });
        await checkpoint(job, onCheckpoint);
        continue;
      }
    }

    const session = await driver.inspectSession();
    const sessionStop = actionStopReason(session);
    if (sessionStop) {
      job = stopJob(job, sessionStop, now());
      return checkpoint(job, onCheckpoint);
    }

    const before = await driver.resolveProfile(item.username);
    const validation = validateActionObservation(item, before);
    if (!validation.ok) {
      job = appendActionCheckpoint(job, item.id, {
        status: 'safe-stopped',
        beforeEvidence: before.evidence || null,
        error: validation.stopReason,
      }, {
        now: now(),
        activity: activity(
          'action-safe-stop',
          item,
          `Stopped before ${item.action} for @${item.username}: ${validation.stopReason}.`,
          now(),
          { reason: validation.stopReason },
        ),
      });
      await checkpoint(job, onCheckpoint);
      job = stopJob(job, validation.stopReason, now());
      return checkpoint(job, onCheckpoint);
    }
    if (validation.skipReason) {
      job = appendActionCheckpoint(job, item.id, {
        status: 'skipped',
        result: validation.skipReason,
        beforeEvidence: before.evidence || null,
      }, {
        now: now(),
        activity: activity(
          'action-skipped',
          item,
          `Skipped @${item.username}: ${validation.skipReason}.`,
          now(),
        ),
      });
      await checkpoint(job, onCheckpoint);
      continue;
    }

    if (job.mode === 'dry-run') {
      job = appendActionCheckpoint(job, item.id, {
        status: 'dry-run-complete',
        result: 'resolved-no-click',
        beforeEvidence: before.evidence || null,
      }, {
        now: now(),
        activity: activity(
          'action-dry-run',
          item,
          `Resolved ${item.action} for @${item.username} without clicking.`,
          now(),
        ),
      });
      await checkpoint(job, onCheckpoint);
      continue;
    }

    const reservation = await ledger.reserve({
      jobId: job.id,
      itemId: item.id,
      queueItemId: item.queueItemId,
      action: item.action,
      username: item.username,
    }, settings, now());
    if (!reservation?.ok) {
      const reason = reservation?.reason || 'ledger-rejected';
      job = appendActionCheckpoint(job, item.id, {
        status: 'safe-stopped',
        beforeEvidence: before.evidence || null,
        error: reason,
      }, {
        now: now(),
        activity: activity(
          'action-safe-stop',
          item,
          `Stopped before ${item.action} for @${item.username}: ${reason}.`,
          now(),
        ),
      });
      await checkpoint(job, onCheckpoint);
      job = stopJob(job, reason, now());
      return checkpoint(job, onCheckpoint);
    }

    let performed;
    try {
      performed = await driver.performReviewedAction({
        ...item,
        expectedRelationship: before.relationship,
        resolutionToken: before.resolutionToken,
      });
    } catch (error) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: { message: error.message },
      }, now());
      job = appendActionCheckpoint(job, item.id, {
        status: 'safe-stopped',
        beforeEvidence: before.evidence || null,
        error: 'driver-error-after-reservation',
      }, {
        now: now(),
        activity: activity(
          'action-safe-stop',
          item,
          `Action outcome for @${item.username} is uncertain; execution stopped.`,
          now(),
        ),
      });
      await checkpoint(job, onCheckpoint);
      job = stopJob(job, 'uncertain-action-outcome', now());
      return checkpoint(job, onCheckpoint);
    }

    const performedStop = actionStopReason(performed);
    if (performedStop) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: performed,
      }, now());
      job = stopJob(job, performedStop, now());
      return checkpoint(job, onCheckpoint);
    }

    const after = await driver.resolveProfile(item.username);
    const completion = validateActionCompletion(item, after);
    if (!completion.ok) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: after,
      }, now());
      job = appendActionCheckpoint(job, item.id, {
        status: 'safe-stopped',
        beforeEvidence: before.evidence || null,
        afterEvidence: after.evidence || null,
        error: completion.stopReason,
      }, {
        now: now(),
        activity: activity(
          'action-safe-stop',
          item,
          `Could not confirm ${item.action} for @${item.username}; execution stopped.`,
          now(),
          { reason: completion.stopReason },
        ),
      });
      await checkpoint(job, onCheckpoint);
      job = stopJob(job, completion.stopReason, now());
      return checkpoint(job, onCheckpoint);
    }

    await ledger.finalize(reservation.record.id, {
      status: 'succeeded',
      result: performed,
    }, now());
    job = appendActionCheckpoint(job, item.id, {
      status: 'completed',
      attemptCount: item.attemptCount + 1,
      result: performed.result || 'completed',
      beforeEvidence: before.evidence || null,
      afterEvidence: after.evidence || null,
    }, {
      now: now(),
      activity: activity(
        'action-completed',
        item,
        `Completed ${item.action} for @${item.username}.`,
        now(),
      ),
    });
    await checkpoint(job, onCheckpoint);
  }

  job.status = 'completed';
  job.control = 'stopped';
  job.updatedAt = new Date(now()).toISOString();
  return checkpoint(job, onCheckpoint);
}
