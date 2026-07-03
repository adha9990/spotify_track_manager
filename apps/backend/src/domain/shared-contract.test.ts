import { LibrarySchema, SuspectPairSchema } from "@stm/shared";
import { describe, expect, it } from "vitest";
import { makeTrack } from "./fixtures";

// Contract tests for the "suspected duplicate pair" shape shared between backend
// and frontend (packages/shared/src/index.ts). These test the Zod contract only.

describe("SuspectPairSchema", () => {
  it("accepts a fully-populated suspect pair (keep/remove are full Track objects)", () => {
    const sample = {
      keep: makeTrack({ id: "1", name: "Song", artists: ["A"] }),
      remove: makeTrack({ id: "2", name: "Song (Remastered)", artists: ["A"] }),
      pairKey: "1|2",
      score: 1,
      hints: ["same title after suffix strip", "same primary artist"],
    };
    const result = SuspectPairSchema.safeParse(sample);
    expect(result.success).toBe(true);
  });

  it("rejects a pair missing pairKey (the required stable sorted-id join)", () => {
    const sample = {
      keep: makeTrack({ id: "1" }),
      remove: makeTrack({ id: "2" }),
      // pairKey intentionally omitted
      score: 0.8,
      hints: ["similar title"],
    };
    const result = SuspectPairSchema.safeParse(sample);
    expect(result.success).toBe(false);
  });

  it("rejects a pair whose hints is not an array of strings", () => {
    const sample = {
      keep: makeTrack({ id: "1" }),
      remove: makeTrack({ id: "2" }),
      pairKey: "1|2",
      score: 0.8,
      hints: "similar title", // should be string[], not string
    };
    const result = SuspectPairSchema.safeParse(sample);
    expect(result.success).toBe(false);
  });
});

describe("LibrarySchema with suspects", () => {
  it("accepts a library snapshot that includes an empty suspects array", () => {
    const result = LibrarySchema.safeParse({ tracks: [], cleanup: [], suspects: [] });
    expect(result.success).toBe(true);
  });

  it("rejects a library snapshot missing the suspects field (now required)", () => {
    const result = LibrarySchema.safeParse({ tracks: [], cleanup: [] });
    expect(result.success).toBe(false);
  });
});
