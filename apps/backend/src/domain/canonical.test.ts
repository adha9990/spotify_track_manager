import { describe, expect, it } from "vitest";
import { canonical } from "./canonical";

// canonical() produces a deterministic comparison key — never used for display.
// Requirement: Unicode NFKC (full-width -> half-width, incl. full-width space),
// Traditional -> Simplified Chinese (OpenCC), lowercase, trim + whitespace collapse.

describe("canonical", () => {
  it("normalizes full-width Latin letters to half-width via NFKC, then lowercases", () => {
    expect(canonical("ＬＥＭＯＮ")).toBe("lemon");
  });

  it("normalizes a full-width space to a regular space via NFKC", () => {
    expect(canonical("Ｌ　Ｅ")).toBe("l e");
  });

  it("maps a Traditional-Chinese title to the same key as its Simplified-Chinese form", () => {
    expect(canonical("演員")).toBe(canonical("演员"));
  });

  it("maps a Traditional-Chinese artist name to the same key as its Simplified-Chinese form", () => {
    expect(canonical("薛之謙")).toBe(canonical("薛之谦"));
  });

  it("lowercases ASCII text", () => {
    expect(canonical("Hello World")).toBe("hello world");
  });

  it("trims leading and trailing whitespace", () => {
    expect(canonical("  Hello  ")).toBe("hello");
  });

  it("collapses a run of internal whitespace to a single space", () => {
    expect(canonical("Hello    World")).toBe("hello world");
  });

  it("is deterministic: the same input always produces the same key", () => {
    expect(canonical("薛之謙")).toBe(canonical("薛之謙"));
  });

  it("does not conflate two different Traditional-Chinese strings", () => {
    expect(canonical("晴天")).not.toBe(canonical("稻香"));
  });
});
