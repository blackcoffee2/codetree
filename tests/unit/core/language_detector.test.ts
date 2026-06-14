import { describe, it, expect } from "vitest";
import { isBinaryContent } from "@/utils/binary_detector";

describe("isBinaryContent", () => {
  it("treats an empty buffer as text", () => {
    expect(isBinaryContent(Buffer.alloc(0))).toBe(false);
  });

  it("treats plain ASCII text as text", () => {
    const buffer = Buffer.from("const x = 1;\nconst y = 2;\n", "utf-8");
    expect(isBinaryContent(buffer)).toBe(false);
  });

  it("treats UTF-8 multibyte content as text", () => {
    // Bytes >= 128 are part of multibyte UTF-8 sequences and must count as text
    // so that non-ASCII source files are not misclassified as binary.
    const buffer = Buffer.from("const greeting = 'こんにちは';", "utf-8");
    expect(isBinaryContent(buffer)).toBe(false);
  });

  it("treats common whitespace control bytes as text", () => {
    // Tab, line feed, form feed, and carriage return are the control bytes the
    // detector explicitly allows.
    const buffer = Buffer.from([0x09, 0x0a, 0x0c, 0x0d, 0x41, 0x42]);
    expect(isBinaryContent(buffer)).toBe(false);
  });

  it("classifies a buffer containing a NUL byte as binary", () => {
    // A NUL byte is the definitive binary signal; a single occurrence is enough
    // even amid otherwise printable bytes.
    const buffer = Buffer.from([0x41, 0x42, 0x00, 0x43]);
    expect(isBinaryContent(buffer)).toBe(true);
  });

  it("classifies content above the non-text ratio as binary", () => {
    // No NUL byte present, but more than thirty percent of the bytes fall in the
    // disallowed control range, which crosses the threshold.
    const bytes: number[] = [];
    for (let i = 0; i < 100; i++) {
      // 0x01 is a control byte outside the allowed whitespace set.
      bytes.push(i < 40 ? 0x01 : 0x41);
    }
    expect(isBinaryContent(Buffer.from(bytes))).toBe(true);
  });

  it("tolerates a small number of stray control bytes in text", () => {
    // A handful of control bytes below the threshold should not flip an
    // otherwise-textual file to binary.
    const bytes: number[] = [];
    for (let i = 0; i < 100; i++) {
      bytes.push(i < 5 ? 0x01 : 0x41);
    }
    expect(isBinaryContent(Buffer.from(bytes))).toBe(false);
  });

  it("inspects only the leading sample of a large buffer", () => {
    // Bytes beyond the inspected sample window must not influence the result, so
    // a long run of text followed by binary past the window stays classified as
    // text.
    const head = Buffer.alloc(8192, 0x41);
    const tail = Buffer.alloc(100, 0x00);
    expect(isBinaryContent(Buffer.concat([head, tail]))).toBe(false);
  });
});
