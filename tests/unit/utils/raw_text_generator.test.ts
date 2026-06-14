import { describe, it, expect } from "vitest";
import { RawTextGenerator } from "@/utils/raw_text_generator";
import { ParsedFile, FileInfo } from "@/types";

// Builds a minimal ParsedFile for generator tests. Only the fields the raw
// generator reads need realistic values; the rest are filled with sensible
// defaults.
function makeParsedFile(
  relativePath: string,
  content: string,
  language: FileInfo["language"]
): ParsedFile {
  return {
    fileInfo: {
      absolutePath: `/abs/${relativePath}`,
      relativePath,
      size: Buffer.byteLength(content, "utf-8"),
      language,
      extension: relativePath.slice(relativePath.lastIndexOf(".")),
    },
    content,
    syntaxTree: null,
    structuralSummary: null,
    lineCount: content.split("\n").length,
    encoding: "utf-8",
  };
}

describe("RawTextGenerator.generate", () => {
  it("emits a project header with the directory name and file count", () => {
    const files = [makeParsedFile("a.ts", "const a = 1;", "typescript")];
    const output = RawTextGenerator.generate(files, "/projects/demo");
    const firstLine = output.split("\n")[0];
    expect(firstLine).toContain("# demo");
    expect(firstLine).toContain("1 files");
  });

  it("emits an abbreviated language distribution line", () => {
    const files = [
      makeParsedFile("a.ts", "const a = 1;", "typescript"),
      makeParsedFile("b.js", "const b = 2;", "javascript"),
    ];
    const output = RawTextGenerator.generate(files, "/projects/demo");
    const distributionLine = output.split("\n")[1];
    expect(distributionLine).toContain("ts:1");
    expect(distributionLine).toContain("js:1");
  });

  it("groups files without a grammar under the text label", () => {
    const files = [makeParsedFile("notes.txt", "hello", null)];
    const output = RawTextGenerator.generate(files, "/projects/demo");
    expect(output.split("\n")[1]).toContain("text:1");
  });

  it("delimits each file with its relative path and includes full content", () => {
    const files = [
      makeParsedFile("src/a.ts", "line one\nline two", "typescript"),
    ];
    const output = RawTextGenerator.generate(files, "/projects/demo");
    expect(output).toContain("=== src/a.ts ===");
    expect(output).toContain("line one\nline two");
  });

  it("orders files by relative path regardless of input order", () => {
    const files = [
      makeParsedFile("z.ts", "z", "typescript"),
      makeParsedFile("a.ts", "a", "typescript"),
    ];
    const output = RawTextGenerator.generate(files, "/projects/demo");
    expect(output.indexOf("=== a.ts ===")).toBeLessThan(
      output.indexOf("=== z.ts ===")
    );
  });
});
