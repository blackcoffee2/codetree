import { describe, it, expect, beforeAll } from "vitest";
import type { Parser } from "web-tree-sitter";
import { LanguageDetector, SupportedLanguage } from "@/core/language_detector";
import { TreeWalker } from "@/core/tree_walker";

// This is the integration tier. Unlike the pure-unit tests, it loads the real
// WebAssembly grammars shipped in tree-sitter-wasms and runs the actual parser,
// so it proves end to end that each supported language can be loaded, parsed,
// and summarized. It is slower and depends on web-tree-sitter's runtime, which
// is why it lives apart from the fast unit tests.

// A representative snippet per language together with one identifier that must
// survive parsing into the structural summary. Assertions here are deliberately
// weak - grammar loads, summary is non-empty, the identifier appears somewhere -
// because TreeWalker's summary is a heuristic outline and encoding its exact
// per-language output would freeze accidental behavior. Stronger symbol-shape
// assertions are reserved for JavaScript and TypeScript in js_ts_pipeline.test.ts,
// where the downstream extractor is reliable.
const LANGUAGE_FIXTURES: Array<{
  language: SupportedLanguage;
  snippet: string;
  expectedIdentifier: string;
}> = [
  {
    language: "javascript",
    snippet: "function greet(name) {\n  return `hi ${name}`;\n}\n",
    expectedIdentifier: "greet",
  },
  {
    language: "jsx",
    snippet:
      'function App() {\n  return <div className="app">hello</div>;\n}\n',
    expectedIdentifier: "App",
  },
  {
    language: "typescript",
    snippet:
      "export function add(a: number, b: number): number {\n  return a + b;\n}\n",
    expectedIdentifier: "add",
  },
  {
    language: "tsx",
    snippet:
      "export function Button(): JSX.Element {\n  return <button>ok</button>;\n}\n",
    expectedIdentifier: "Button",
  },
  {
    language: "python",
    snippet: "def compute(value):\n    return value * 2\n",
    expectedIdentifier: "compute",
  },
  {
    language: "java",
    snippet:
      "public class Calculator {\n  public int square(int n) {\n    return n * n;\n  }\n}\n",
    expectedIdentifier: "Calculator",
  },
  {
    language: "kotlin",
    snippet: "fun multiply(a: Int, b: Int): Int {\n    return a * b\n}\n",
    expectedIdentifier: "multiply",
  },
  {
    language: "go",
    snippet:
      "package main\n\nfunc Add(a int, b int) int {\n\treturn a + b\n}\n",
    expectedIdentifier: "Add",
  },
  {
    language: "rust",
    snippet: "fn divide(a: i32, b: i32) -> i32 {\n    a / b\n}\n",
    expectedIdentifier: "divide",
  },
  {
    language: "cpp",
    snippet: "class Widget {\npublic:\n  int area() const { return 42; }\n};\n",
    expectedIdentifier: "Widget",
  },
  {
    language: "c",
    snippet: "int subtract(int a, int b) {\n  return a - b;\n}\n",
    expectedIdentifier: "subtract",
  },
  {
    language: "csharp",
    // The block-scoped namespace stacks the most member-body wrappers of any
    // supported language, and the expected identifier is the method name, so
    // this fixture fails if the walker's wrapper-depth rule regresses and
    // methods fall past the depth limit.
    snippet:
      "namespace Demo {\n  public class Calculator {\n    public int Square(int n) {\n      return n * n;\n    }\n  }\n}\n",
    expectedIdentifier: "Square",
  },
  {
    language: "dart",
    snippet: "int triple(int n) {\n  return n * 3;\n}\n",
    expectedIdentifier: "triple",
  },
  {
    language: "swift",
    snippet: "func negate(_ value: Int) -> Int {\n    return -value\n}\n",
    expectedIdentifier: "negate",
  },
];

describe("supported language grammars", () => {
  let detector: LanguageDetector;
  let walker: TreeWalker;
  let parser: Parser;

  // Parser.init must complete before any grammar is loaded or any source is
  // parsed. It is run once for the whole suite.
  beforeAll(async () => {
    const { Parser } = await import("web-tree-sitter");
    await Parser.init();
    parser = new Parser();
    detector = new LanguageDetector();
    walker = new TreeWalker();
  });

  // Every supported language must load its grammar, parse its snippet, and
  // produce a non-empty summary that mentions the expected identifier.
  it.each(LANGUAGE_FIXTURES)(
    "loads, parses, and summarizes $language",
    async ({ language, snippet, expectedIdentifier }) => {
      const grammar = await detector.getSafeParser(language);
      expect(grammar, `grammar for ${language} should load`).not.toBeNull();

      parser.setLanguage(grammar!);
      const tree = parser.parse(snippet);
      expect(tree, `parse tree for ${language} should exist`).not.toBeNull();

      const summary = walker.extractSummary(tree!.rootNode, snippet);
      expect(summary.length).toBeGreaterThan(0);
      expect(summary).not.toContain("No significant structures found");
      expect(summary).toContain(expectedIdentifier);
    }
  );

  it("covers every language the detector reports as supported", () => {
    // Guards against a new language being added to the detector without a
    // corresponding fixture here.
    const fixtured = new Set(LANGUAGE_FIXTURES.map((f) => f.language));
    const supported = detector.getSupportedLanguages();
    const missing = supported.filter((lang) => !fixtured.has(lang));
    expect(missing).toEqual([]);
  });
});
