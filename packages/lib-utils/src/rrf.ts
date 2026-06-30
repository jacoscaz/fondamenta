
// ============================================================================
//           Utilities for Reciprocal Rank Fusion (RRF)
// ============================================================================

/**
 * Fuses arrays of items ordered by descending relevance using the Reciprocal
 * Rank Fusion (RRF) algorithm.
 *
 * Ranks are assigned to items based on their position in their respective
 * arrays, with lower indexes ranking higher.
 *
 * @param results -- array of arrays of items ordered by descending relevance
 * @param identity -- a function that returns the identity of an item
 * @param limit -- the maximum number of items to return
 * @param K -- the RRF constant (default: 60)
 * @returns
 */
export const rrfFuseResults = async <T, I>(
  results: T[][],
  ident: (item: T) => I,
  limit: number,
  K: number = 60,
): Promise<T[]> => {

  const scores = new Map<I, number>();
  const records = new Map<I, T>();

  for (const list of results) {
    for (let rank = 0; rank < list.length; rank++) {
      const record = list[rank];
      const score = 1 / (K + rank + 1);
      const id = ident(record);
      scores.set(id, (scores.get(id) ?? 0) + score);
      records.set(id, record);
    }
  }

  const fused = Array.from(records.values())
    .sort((a, b) => (scores.get(ident(b)) ?? 0) - (scores.get(ident(a)) ?? 0));

  return fused.slice(0, limit);
};
