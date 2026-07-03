// The text-embedding capability the cross-language duplicate detector needs, kept
// independent of how it's fulfilled (an offline ONNX model, a fake in tests). The
// service depends on this interface; the concrete transformers.js/LaBSE adapter
// lives in adapters/embedding and is wired at bin/server.ts. Dependency-inversion
// seam that keeps the inner layers free of any model/IO detail.

export interface EmbeddingGateway {
  /** Identifier of the underlying model — cached vectors from a different model are stale and re-embedded. */
  readonly modelId: string;
  /**
   * Embed a batch of texts into sentence vectors, one row per input text (order
   * preserved). Each row is L2-normalized so a plain dot product equals cosine
   * similarity. All rows share the same dimension.
   */
  embed(texts: string[]): Promise<number[][]>;
}
