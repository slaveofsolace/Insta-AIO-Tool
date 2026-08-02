import {
  finalizeActionAttempt,
  reserveActionAttempt,
} from '../core/action-ledger.js';
import { updateStateAtomically } from '../core/storage.js';

export function createIndexedDbActionLedger() {
  return {
    async reserve(claim, settings, now) {
      const outcome = await updateStateAtomically((state) => (
        reserveActionAttempt(state, claim, settings, now)
      ));
      return outcome.result;
    },

    async finalize(attemptId, completion, now) {
      const outcome = await updateStateAtomically((state) => ({
        state: finalizeActionAttempt(state, attemptId, {
          ...completion,
          now,
        }),
        result: { ok: true },
      }));
      return outcome.result;
    },
  };
}

export async function saveActionJobCheckpoint(job) {
  const outcome = await updateStateAtomically((state) => {
    const actionJobs = [...state.actionJobs];
    const index = actionJobs.findIndex((candidate) => candidate.id === job.id);
    if (index < 0) throw new Error('Reviewed action job no longer exists.');
    actionJobs[index] = job;
    return {
      state: {
        ...state,
        actionJobs,
        activity: [...job.activity, ...state.activity]
          .filter((entry, index, all) => (
            all.findIndex((candidate) => candidate.id === entry.id) === index
          ))
          .slice(0, 5000),
      },
      result: { ok: true },
    };
  });
  return outcome.state;
}
