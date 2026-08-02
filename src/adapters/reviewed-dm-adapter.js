import {
  appendDmCheckpoint,
  dmLiveBatchLimit,
  dmPreviewDigest,
  dmStopReason,
  validateDmResolution,
} from '../core/dm-jobs.js';
import { directThreadId } from './instagram-dm-unsender.js';

function clone(value) {
  return typeof structuredClone === 'function'
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
}

function activity(kind, item, message, now, details = {}) {
  return {
    id: `${item.id}:${kind}:${now}`,
    timestamp: new Date(now).toISOString(),
    kind,
    message,
    details,
  };
}

async function save(job, onCheckpoint) {
  await onCheckpoint?.(job);
  return job;
}

function exactDmRemovalConfirmed(item, performed, after) {
  const expectedThreadId = directThreadId(item?.conversationId);
  const postcondition = performed?.postcondition;
  return Boolean(
    expectedThreadId
    && performed?.result === 'unsent'
    && performed?.conversationId === item?.conversationId
    && performed?.messageId === item?.messageId
    && postcondition?.exactThread === true
    && postcondition?.expectedThreadId === expectedThreadId
    && postcondition?.observedThreadId === expectedThreadId
    && postcondition?.retainedRowDisconnected === true
    && postcondition?.retainedIdentityNodeDisconnected === true
    && postcondition?.exactCandidateAbsent === true
    && postcondition?.observationReason === 'exact-message-not-found'
    && after?.missing === true
    && after?.conversationId === item?.conversationId
    && after?.messageId === item?.messageId
    && after?.evidence?.observedThreadId === expectedThreadId
    && after?.exactIdentityAvailable === true
    && after?.reason === 'exact-message-not-found'
    && !after?.ambiguous
    && !after?.unexpectedUi
  );
}

function stopJob(job, reason, now) {
  const next = clone(job);
  next.status = 'stopped';
  next.control = 'stopped';
  next.stopReason = reason;
  next.updatedAt = new Date(now).toISOString();
  next.activity.push({
    id: `${next.id}:safe-stop:${now}`,
    timestamp: new Date(now).toISOString(),
    kind: 'safe-stop',
    message: `DM job stopped: ${reason}.`,
    details: { reason },
  });
  return next;
}

export async function executeReviewedDmJob(inputJob, {
  driver,
  ledger = null,
  settings = {},
  signal,
  onCheckpoint,
  now = () => Date.now(),
} = {}) {
  if (!driver?.inspectSession || !driver?.resolveConversation || !driver?.resolveMessage) {
    throw new Error('The reviewed DM adapter requires session, conversation, and message inspection.');
  }
  if (inputJob?.kind !== 'insta-aio-reviewed-dm-job') {
    throw new Error('Select a reviewed DM job.');
  }
  if (!['ready', 'paused', 'running'].includes(inputJob?.status)) {
    throw new Error('Confirm the reviewed DM job before execution.');
  }
  if (!['dry-run', 'live'].includes(inputJob.mode) || !inputJob.reviewConfirmedAt) {
    throw new Error('Confirm the reviewed DM mode before execution.');
  }
  if (
    !Array.isArray(inputJob.items)
    || dmPreviewDigest(inputJob.items) !== inputJob.previewDigest
  ) {
    throw new Error('The reviewed DM preview changed after confirmation.');
  }
  if (inputJob.mode === 'live') {
    if (!inputJob.destructiveConfirmedAt) {
      throw new Error('Live DM execution requires the second destructive confirmation.');
    }
    if (settings.liveDmUnsendEnabled !== true) {
      throw new Error('Live DM unsend is disabled in settings.');
    }
    const maximum = dmLiveBatchLimit(settings);
    if (inputJob.items.length > maximum) {
      throw new Error(
        `The live DM batch contains ${inputJob.items.length} messages; the configured limit is ${maximum}.`,
      );
    }
    if (!driver.performReviewedUnsend || !ledger) {
      throw new Error('Live DM execution requires an unsend driver and transactional ledger.');
    }
  }

  let job = clone(inputJob);
  job.status = 'running';
  job.control = 'running';
  job.updatedAt = new Date(now()).toISOString();
  await save(job, onCheckpoint);

  for (const sourceItem of job.items) {
    const item = job.items.find((candidate) => candidate.id === sourceItem.id);
    if (['dry-run-complete', 'completed', 'skipped'].includes(item.status)) continue;
    if (signal?.aborted) {
      job.status = 'paused';
      job.control = 'paused';
      job.updatedAt = new Date(now()).toISOString();
      return save(job, onCheckpoint);
    }
    if (item.sentByMe !== true) {
      job = appendDmCheckpoint(job, item.id, {
        status: 'safe-stopped',
        error: 'received-message',
      }, {
        now: now(),
        activity: activity(
          'dm-safe-stop',
          item,
          'Received messages are not eligible for unsend.',
          now(),
        ),
      });
      await save(job, onCheckpoint);
      job = stopJob(job, 'received-message', now());
      return save(job, onCheckpoint);
    }

    const session = await driver.inspectSession();
    const sessionStop = dmStopReason(session);
    if (sessionStop) {
      job = stopJob(job, sessionStop, now());
      return save(job, onCheckpoint);
    }

    const conversation = await driver.resolveConversation(item.conversationId);
    const conversationStop = dmStopReason(conversation);
    if (conversationStop || conversation?.conversationId !== item.conversationId) {
      const reason = conversationStop || 'wrong-conversation';
      job = stopJob(job, reason, now());
      return save(job, onCheckpoint);
    }

    const resolved = await driver.resolveMessage(item);
    const validation = validateDmResolution(item, conversation, resolved);
    if (!validation.ok) {
      job = appendDmCheckpoint(job, item.id, {
        status: 'safe-stopped',
        error: validation.stopReason,
        resolutionEvidence: resolved?.evidence || null,
      }, {
        now: now(),
        activity: activity(
          'dm-safe-stop',
          item,
          `Stopped before unsend: ${validation.stopReason}.`,
          now(),
          { reason: validation.stopReason },
        ),
      });
      await save(job, onCheckpoint);
      job = stopJob(job, validation.stopReason, now());
      return save(job, onCheckpoint);
    }

    if (job.mode === 'dry-run') {
      job = appendDmCheckpoint(job, item.id, {
        status: 'dry-run-complete',
        result: 'resolved-no-click',
        resolutionEvidence: resolved.evidence || null,
      }, {
        now: now(),
        activity: activity(
          'dm-dry-run',
          item,
          `Resolved sent message ${item.messageId} without clicking Unsend.`,
          now(),
        ),
      });
      await save(job, onCheckpoint);
      continue;
    }

    if (typeof driver.inspectLiveAuthorization === 'function') {
      const authorization = await driver.inspectLiveAuthorization({
        ...item,
        resolutionToken: resolved.resolutionToken,
      });
      const authorizationStop = dmStopReason(authorization)
        || (authorization?.authorized === true
          ? null
          : authorization?.reason || 'dm-live-authorization-required');
      if (authorizationStop) {
        job = appendDmCheckpoint(job, item.id, {
          status: 'safe-stopped',
          error: authorizationStop,
          resolutionEvidence: resolved?.evidence || null,
        }, {
          now: now(),
          activity: activity(
            'dm-safe-stop',
            item,
            `Stopped before unsend: ${authorizationStop}.`,
            now(),
            { reason: authorizationStop },
          ),
        });
        await save(job, onCheckpoint);
        job = stopJob(job, authorizationStop, now());
        return save(job, onCheckpoint);
      }
    }

    const reservation = await ledger.reserve({
      jobId: job.id,
      itemId: item.id,
      conversationId: item.conversationId,
      messageId: item.messageId,
    }, now());
    if (!reservation?.ok) {
      const reason = reservation?.reason || 'ledger-rejected';
      job = stopJob(job, reason, now());
      return save(job, onCheckpoint);
    }

    let performed;
    try {
      performed = await driver.performReviewedUnsend({
        ...item,
        resolutionToken: resolved.resolutionToken,
      });
    } catch (error) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: { message: error.message },
      }, now());
      job = stopJob(job, 'uncertain-unsend-outcome', now());
      return save(job, onCheckpoint);
    }

    const performedStop = dmStopReason(performed);
    if (performedStop) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: performed,
      }, now());
      job = stopJob(job, performedStop, now());
      return save(job, onCheckpoint);
    }

    const after = await driver.resolveMessage(item);
    if (!exactDmRemovalConfirmed(item, performed, after)) {
      await ledger.finalize(reservation.record.id, {
        status: 'uncertain',
        result: after,
      }, now());
      job = appendDmCheckpoint(job, item.id, {
        status: 'safe-stopped',
        error: 'unsend-not-confirmed',
        resolutionEvidence: resolved.evidence || null,
      }, {
        now: now(),
        activity: activity(
          'dm-safe-stop',
          item,
          `Could not confirm removal of message ${item.messageId}; execution stopped.`,
          now(),
        ),
      });
      await save(job, onCheckpoint);
      job = stopJob(job, 'unsend-not-confirmed', now());
      return save(job, onCheckpoint);
    }

    await ledger.finalize(reservation.record.id, {
      status: 'succeeded',
      result: performed,
    }, now());
    job = appendDmCheckpoint(job, item.id, {
      status: 'completed',
      attemptCount: item.attemptCount + 1,
      result: performed.result || 'unsent',
      resolutionEvidence: resolved.evidence || null,
    }, {
      now: now(),
      activity: activity(
        'dm-completed',
        item,
        `Unsent reviewed message ${item.messageId}.`,
        now(),
      ),
    });
    await save(job, onCheckpoint);
  }

  job.status = 'completed';
  job.control = 'stopped';
  job.updatedAt = new Date(now()).toISOString();
  return save(job, onCheckpoint);
}
