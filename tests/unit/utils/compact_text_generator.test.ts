import { describe, it, expect } from "vitest";
import { CompactTextGenerator } from "@/utils/compact_text_generator";
import { ParsedFile, FileInfo } from "@/types";

// The compact generator consumes the string structural summary that TreeWalker
// produces, in the form "nodeType: signature (line N)" per line. These tests
// feed pre-built summaries directly so the regex parsing and symbol grouping
// can be exercised without loading any grammar.
function makeParsedFile(
  relativePath: string,
  structuralSummary: string | null,
  language: FileInfo["language"]
): ParsedFile {
  const content = "// placeholder\n";
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
    structuralSummary,
    lineCount: 1,
    encoding: "utf-8",
  };
}

// Returns the single file line from the generated output for the given file
// name, which is where its symbol string appears.
function fileLine(output: string, fileName: string): string {
  const line = output.split("\n").find((l) => l.trim().startsWith(fileName));
  if (!line) {
    throw new Error(`No output line found for ${fileName}`);
  }
  return line;
}

describe("CompactTextGenerator header", () => {
  it("emits the project header and language distribution", () => {
    const files = [makeParsedFile("a.ts", null, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(output.split("\n")[0]).toContain("# demo");
    expect(output).toContain("ts:1");
  });

  it("includes the symbol legend", () => {
    const files = [makeParsedFile("a.ts", null, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(output).toContain("Symbol Legend");
  });
});

describe("CompactTextGenerator symbol extraction", () => {
  it("lists a standalone function with the fn prefix", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "function_declaration: function doThing() (line 1)",
    ].join("\n");
    const files = [makeParsedFile("a.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(fileLine(output, "a.ts")).toContain("fn:doThing");
  });

  it("groups methods under their class by indentation", () => {
    // A class node followed by indented function nodes should render as
    // cls:Name(method,method) rather than as standalone functions.
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "class_declaration: class Service (line 1)",
      "  method_definition: start() (line 2)",
      "  method_definition: stop() (line 3)",
    ].join("\n");
    const files = [makeParsedFile("svc.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(fileLine(output, "svc.ts")).toContain("cls:Service(start,stop)");
  });

  it("renders a class without methods as a bare class name", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "class_declaration: class Empty (line 1)",
    ].join("\n");
    const files = [makeParsedFile("e.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    const line = fileLine(output, "e.ts");
    expect(line).toContain("cls:Empty");
    expect(line).not.toContain("Empty(");
  });

  it("extracts an import module name with the imp prefix", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "import_statement: import { foo } from './bar/baz' (line 1)",
    ].join("\n");
    const files = [makeParsedFile("a.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    // A module path is reduced to its final segment with the extension stripped.
    expect(fileLine(output, "a.ts")).toContain("imp:baz");
  });

  it("deduplicates repeated symbol names", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "function_declaration: function dup() (line 1)",
      "function_declaration: function dup() (line 5)",
    ].join("\n");
    const files = [makeParsedFile("a.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    const line = fileLine(output, "a.ts");
    const matches = line.match(/dup/g) ?? [];
    expect(matches).toHaveLength(1);
  });

  it("orders symbol groups as classes, functions, then imports", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "import_statement: import { x } from './x' (line 1)",
      "class_declaration: class C (line 2)",
      "function_declaration: function f() (line 6)",
    ].join("\n");
    const files = [makeParsedFile("a.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    const line = fileLine(output, "a.ts");
    expect(line.indexOf("cls:")).toBeLessThan(line.indexOf("fn:"));
    expect(line.indexOf("fn:")).toBeLessThan(line.indexOf("imp:"));
  });

  it("lists a file with no structural summary by name only", () => {
    const files = [makeParsedFile("plain.txt", null, null)];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(fileLine(output, "plain.txt").trim()).toBe("plain.txt");
  });

  it("ignores the header and the no-structures sentinel", () => {
    const summary = [
      "=== STRUCTURAL ELEMENTS ===",
      "No significant structures found",
    ].join("\n");
    const files = [makeParsedFile("empty.ts", summary, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(fileLine(output, "empty.ts").trim()).toBe("empty.ts");
  });
});

describe("CompactTextGenerator directory nesting", () => {
  it("emits nested directories with trailing slashes", () => {
    const files = [makeParsedFile("src/core/a.ts", null, "typescript")];
    const output = CompactTextGenerator.generate(files, "/projects/demo");
    expect(output).toContain("src/");
    expect(output).toContain("core/");
  });
});
