import { describe, it, expect } from "vitest";
import { LanguageDetector } from "@/core/language_detector";

// Pure-unit coverage for extension-based detection. Nothing here loads a
// WebAssembly grammar; getSafeParser and the wasm mappings are proven against
// the real runtime in the integration tier (tests/integration/languages.test.ts),
// which is the test that catches a wrong or missing grammar file name.

describe("LanguageDetector.detectLanguage", () => {
  const detector = new LanguageDetector();

  it("maps common extensions to their languages", () => {
    expect(detector.detectLanguage("src/app.ts")).toBe("typescript");
    expect(detector.detectLanguage("src/app.tsx")).toBe("tsx");
    expect(detector.detectLanguage("src/app.js")).toBe("javascript");
    expect(detector.detectLanguage("main.py")).toBe("python");
    expect(detector.detectLanguage("main.go")).toBe("go");
    expect(detector.detectLanguage("lib.rs")).toBe("rust");
  });

  it("maps .cs and .csx to csharp", () => {
    expect(detector.detectLanguage("src/Program.cs")).toBe("csharp");
    expect(detector.detectLanguage("scripts/build.csx")).toBe("csharp");
  });

  it("matches extensions case-insensitively", () => {
    expect(detector.detectLanguage("Program.CS")).toBe("csharp");
    expect(detector.detectLanguage("App.TS")).toBe("typescript");
  });

  it("does not treat Razor files as C#", () => {
    // .cshtml interleaves markup with C#, so it is deliberately left without a
    // grammar and falls back to plain-text handling.
    expect(detector.detectLanguage("Views/Index.cshtml")).toBeNull();
  });

  it("returns null for unknown extensions and extensionless paths", () => {
    expect(detector.detectLanguage("notes.xyz")).toBeNull();
    expect(detector.detectLanguage("Makefile")).toBeNull();
  });
});

describe("LanguageDetector supported sets", () => {
  const detector = new LanguageDetector();

  it("reports csharp among the supported languages", () => {
    expect(detector.getSupportedLanguages()).toContain("csharp");
  });

  it("reports .cs and .csx among the supported extensions", () => {
    const extensions = detector.getSupportedExtensions();
    expect(extensions).toContain(".cs");
    expect(extensions).toContain(".csx");
  });

  it("answers isSupported from the extension mapping", () => {
    expect(detector.isSupported("src/Program.cs")).toBe(true);
    expect(detector.isSupported("readme.txt")).toBe(false);
  });
});
