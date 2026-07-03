// Durable cache of computed title embeddings, keyed by track id — so the expensive
// one-time full-library embedding pass runs once and later scans only embed new or
// renamed tracks. Implemented by a better-sqlite3 adapter (adapters/db/embeddings);
// the service depends only on this interface.

/** A cached embedding row: the vector plus the inputs that make it stale-detectable. */
export interface CachedEmbedding {
  /** The L2-normalized sentence vector. */
  vec: number[];
  /**
   * The canonicalized title the vector was computed from (canonical(track.name)) — a
   * mismatch means the track was renamed and the vector is stale. Despite the "hash"
   * name it is normalized *plaintext*, not a cryptographic digest: it is only a
   * change-detection key, never a privacy measure (the cache DB is local userData).
   */
  nameHash: string;
  /** Identifier of the model that produced the vector — a mismatch means the model changed. */
  model: string;
}

export interface EmbeddingCache {
  /** Fetch cached embeddings for the given track ids. Missing ids are simply absent from the map. */
  get(ids: string[]): Map<string, CachedEmbedding>;
  /** Upsert embeddings for a batch of tracks. */
  put(rows: { trackId: string; vec: number[]; nameHash: string; model: string }[]): void;
}
