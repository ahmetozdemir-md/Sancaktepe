export { sourceValueSignature as sourceSignature, invalidateSourceCompletion } from '../public/nobet-planlayici/source-refresh.js';

/** Only successful source-only writes create edges. Manual saves never advance a stale edit. */
export function createSourceRevisionTracker(limit = 64) {
  const edges = new Map();
  return {
    record(before, after) {
      if (Number.isSafeInteger(before) && after === before + 1) edges.set(before, after);
      while (edges.size > limit) edges.delete(edges.keys().next().value);
    },
    resolve(revision) {
      let current = revision;
      for (let count = 0; count < limit && edges.has(current); count++) current = edges.get(current);
      return current;
    },
  };
}

