import { describe, it, expect } from "vitest";
import { SizeCalculator } from "@/utils/size_calculator";

describe("SizeCalculator.calculateContentSize", () => {
  it("reports zero for empty content", () => {
    const result = SizeCalculator.calculateContentSize("");
    expect(result.bytes).toBe(0);
    expect(result.formattedSize).toBe("0 B");
    expect(result.tokens).toBe(0);
  });

  it("counts bytes using UTF-8 width, not character count", () => {
    // A multibyte character occupies more bytes than its single code unit, so
    // byte length and string length diverge here.
    const content = "あ";
    const result = SizeCalculator.calculateContentSize(content);
    expect(result.bytes).toBe(Buffer.byteLength(content, "utf-8"));
    expect(result.bytes).toBeGreaterThan(content.length);
  });

  it("estimates tokens at roughly four characters each, rounding up", () => {
    // The heuristic is ceil(chars / 4); ten characters therefore yields three.
    const result = SizeCalculator.calculateContentSize("abcdefghij");
    expect(result.tokens).toBe(3);
  });
});

describe("SizeCalculator.calculateTotalSize", () => {
  it("sums multiple sources by concatenation", () => {
    const combined = SizeCalculator.calculateTotalSize(["abcd", "efgh"]);
    const single = SizeCalculator.calculateContentSize("abcdefgh");
    expect(combined.bytes).toBe(single.bytes);
    expect(combined.tokens).toBe(single.tokens);
  });

  it("handles an empty list", () => {
    const result = SizeCalculator.calculateTotalSize([]);
    expect(result.bytes).toBe(0);
    expect(result.tokens).toBe(0);
  });
});

describe("SizeCalculator formatted size boundaries", () => {
  it("formats byte-range sizes with a B suffix", () => {
    const result = SizeCalculator.calculateContentSize("a".repeat(512));
    expect(result.formattedSize).toBe("512.0 B");
  });

  it("formats kilobyte-range sizes with a KB suffix", () => {
    // 2048 bytes is exactly two kilobytes.
    const result = SizeCalculator.calculateContentSize("a".repeat(2048));
    expect(result.formattedSize).toBe("2.0 KB");
  });

  it("formats megabyte-range sizes with an MB suffix", () => {
    const result = SizeCalculator.calculateContentSize("a".repeat(1024 * 1024));
    expect(result.formattedSize).toBe("1.0 MB");
  });
});
