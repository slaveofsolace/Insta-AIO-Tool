import {
  finalizeDmAttempt,
  reserveDmAttempt,
} from '../core/dm-ledger.js';
import { updateStateAtomically } from '../core/storage.js';

export function createIndexedDbDmLedger() {
  return {
    async reserve(claim, now) {
      const outcome = await updateStateAtomically((state) => (
        reserveDmAttempt(state, claim, now)
      ));
      return outcome.result;
    },

    async finalize(attemptId, completion, now) {
      const outcome = await updateStateAtomically((state) => ({
        state: finalizeDmAttempt(state, attemptId, {
          ...completion,
          now,
        }),
        result: { ok: true },
      }));
      return outcome.result;
    },
  };
}

export async function saveDmJobCheckpoint(job) {
  const outcome = await updateStateAtomically((state) => {
    const dmJobs = [...state.dmJobs];
    const index = dmJobs.findIndex((candidate) => candidate.id === job.id);
    if (index < 0) throw new Error('Reviewed DM job no longer exists.');
    dmJobs[index] = job;
    return {
      state: {
        ...state,
        dmJobs,
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
