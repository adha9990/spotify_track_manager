import { createStore, entries } from "idb-keyval";
import { z } from "zod";
import type { CachedRecording } from "./similar-tracks";

const version = "discogs-multi-bs64-1/audio-v1/";
const audioVector = z.custom<Float32Array>((value) =>
  ArrayBuffer.isView(value) && Object.prototype.toString.call(value) === "[object Float32Array]",
).refine((data) => data.length === 1280 && data.every(Number.isFinite));
const recording = z.object({
  title: z.string().nullable(),
  artist: z.string().nullable(),
  isrcs: z.array(z.string()),
  durationMs: z.number().positive().finite(),
  vector: audioVector,
});

export async function readCachedRecordings(): Promise<CachedRecording[]> {
  try {
    const store = createStore("stm-audio-index", "recordings");
    const cached = await entries<IDBValidKey, unknown>(store);
    return cached.flatMap(([key, value]) => {
      if (typeof key !== "string" || !key.startsWith(version)) return [];
      const parsed = recording.safeParse(value);
      return parsed.success ? [parsed.data] : [];
    });
  } catch {
    return [];
  }
}
