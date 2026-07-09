import { describe, it, expect } from "vitest";
import { diffParts } from "./titleDiff";

function expectRebuild(
  a: string,
  b: string,
  result: ReturnType<typeof diffParts>,
) {
  expect(result.commonPrefix + result.aMiddle + result.commonSuffix).toBe(a);
  expect(result.commonPrefix + result.bMiddle + result.commonSuffix).toBe(b);
}

describe("diffParts", () => {
  it("只有前綴差異時，commonSuffix 為空、aMiddle 為空、bMiddle 為附加段", () => {
    const a = "勇氣";
    const b = "勇氣 (Live版)";

    const result = diffParts(a, b);

    expect(result.commonPrefix).toBe("勇氣");
    expect(result.commonSuffix).toBe("");
    expect(result.aMiddle).toBe("");
    expect(result.bMiddle).toBe(" (Live版)");
    expectRebuild(a, b, result);
  });

  it("前後綴皆有共同部分時，中段各自取出相異片段", () => {
    const a = "Song (Live)";
    const b = "Song (Remix)";

    const result = diffParts(a, b);

    expect(result.commonPrefix).toBe("Song (");
    expect(result.commonSuffix).toBe(")");
    expect(result.aMiddle).toBe("Live");
    expect(result.bMiddle).toBe("Remix");
    expectRebuild(a, b, result);
  });

  it("完全相同的字串時，兩個 middle 皆為空字串", () => {
    const a = "勇氣";
    const b = "勇氣";

    const result = diffParts(a, b);

    expect(result.aMiddle).toBe("");
    expect(result.bMiddle).toBe("");
    expectRebuild(a, b, result);
  });

  it("跨語言零重疊標題時，前後綴皆空、middle 為整個原字串", () => {
    const a = "告白氣球";
    const b = "Bubble Love";

    const result = diffParts(a, b);

    expect(result.commonPrefix).toBe("");
    expect(result.commonSuffix).toBe("");
    expect(result.aMiddle).toBe(a);
    expect(result.bMiddle).toBe(b);
    expectRebuild(a, b, result);
  });

  it("短字串前後綴重疊時不可重建出超出原字串長度的結果（如 xx / xxx 不可變成 xxxx）", () => {
    const a = "xx";
    const b = "xxx";

    const result = diffParts(a, b);

    expect(result.commonPrefix + result.aMiddle + result.commonSuffix).toBe(
      "xx",
    );
    expect(result.commonPrefix + result.bMiddle + result.commonSuffix).toBe(
      "xxx",
    );
  });

  it("其中一個字串為空字串時，另一個字串整個成為該側的 middle", () => {
    const a = "";
    const b = "abc";

    const result = diffParts(a, b);

    expect(result.commonPrefix).toBe("");
    expect(result.commonSuffix).toBe("");
    expect(result.aMiddle).toBe("");
    expect(result.bMiddle).toBe("abc");
    expectRebuild(a, b, result);
  });
});
