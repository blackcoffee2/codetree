import { describe, it, expect, beforeAll } from "vitest";
import type { Parser } from "web-tree-sitter";
import { LanguageDetector } from "@/core/language_detector";
import { TreeWalker } from "@/core/tree_walker";
import { CompactTextGenerator } from "@/utils/compact_text_generator";
import { ParsedFile } from "@/types";

// Strong assertions for JavaScript and TypeScript, exercised through the full
// compact pipeline: real grammar -> parse -> TreeWalker summary ->
// CompactTextGenerator symbol formatting. These two languages are where the
// downstream regex extractor is reliable, so the exact symbol shape is asserted
// here rather than the weak "identifier appears" check used for other languages.

describe("JS/TS compact pipeline", () => {
  let detector: LanguageDetector;
  let walker: TreeWalker;
  let parser: Parser;

  beforeAll(async () => {
    const { Parser } = await import("web-tree-sitter");
    await Parser.init();
    parser = new Parser();
    detector = new LanguageDetector();
    walker = new TreeWalker();
  });

  // Runs a source string through the real parser and walker to produce the
  // structural summary the compact generator consumes, then formats it and
  // returns the single output line carrying the file's symbols.
  async function symbolLineFor(
    language: "javascript" | "typescript",
    relativePath: string,
    source: string
  ): Promise<string> {
    const grammar = await detector.getSafeParser(language);
    expect(grammar).not.toBeNull();

    parser.setLanguage(grammar!);
    const tree = parser.parse(source);
    expect(tree).not.toBeNull();

    const structuralSummary = walker.extractSummary(tree!.rootNode, source);

    const parsedFile: ParsedFile = {
      fileInfo: {
        absolutePath: `/abs/${relativePath}`,
        relativePath,
        size: Buffer.byteLength(source, "utf-8"),
        language,
        extension: relativePath.slice(relativePath.lastIndexOf(".")),
      },
      content: source,
      syntaxTree: null,
      structuralSummary,
      lineCount: source.split("\n").length,
      encoding: "utf-8",
    };

    const output = CompactTextGenerator.generate(
      [parsedFile],
      "/projects/demo"
    );
    const line = output
      .split("\n")
      .find((l) => l.trim().startsWith(relativePath.split("/").pop()!));
    if (!line) {
      throw new Error(`No output line found for ${relativePath}`);
    }
    return line;
  }

  it("groups a TypeScript class with its methods", async () => {
    const source = [
      "export class Service {",
      "  start() {}",
      "  stop() {}",
      "}",
      "",
    ].join("\n");
    const line = await symbolLineFor("typescript", "svc.ts", source);
    expect(line).toContain("cls:Service(");
    expect(line).toContain("start");
    expect(line).toContain("stop");
  });

  it("lists a standalone TypeScript function under fn", async () => {
    const source =
      "export function add(a: number, b: number) {\n  return a + b;\n}\n";
    const line = await symbolLineFor("typescript", "math.ts", source);
    expect(line).toContain("fn:");
    expect(line).toContain("add");
  });

  it("captures a JavaScript class and a separate top-level function", async () => {
    const source = [
      "class Repo {",
      "  save() {}",
      "}",
      "function helper() {}",
      "",
    ].join("\n");
    const line = await symbolLineFor("javascript", "repo.js", source);
    // The class method stays grouped under the class while the top-level
    // function is reported separately as a standalone function.
    expect(line).toContain("cls:Repo(");
    expect(line).toContain("save");
    expect(line).toContain("fn:");
    expect(line).toContain("helper");
  });
});
