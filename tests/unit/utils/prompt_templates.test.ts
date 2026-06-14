import { describe, it, expect } from "vitest";
import { buildTreePrompt, buildCodePrompt } from "@/utils/prompt_templates";

describe("buildTreePrompt", () => {
  it("describes the compact format as a structural index", () => {
    const prompt = buildTreePrompt("compact");
    expect(prompt).toContain("compact structural index");
    // The compact prompt should instruct the model to ask for files it cannot
    // see in full.
    expect(prompt).toContain("ask for it by its relative path");
  });

  it("describes the symbol legend in the compact prompt", () => {
    const prompt = buildTreePrompt("compact");
    expect(prompt).toContain("fn (functions)");
    expect(prompt).toContain("cls:ClassName(method1,method2)");
  });

  it("describes the raw format as complete source", () => {
    const prompt = buildTreePrompt("raw");
    expect(prompt).toContain("complete source");
    expect(prompt).toContain("=== relative/path ===");
  });

  it("does not mention asking for files in the raw prompt", () => {
    // The raw snapshot already contains every file, so the model is told to
    // answer directly rather than request files.
    const prompt = buildTreePrompt("raw");
    expect(prompt).not.toContain("ask for it by its relative path");
  });
});

describe("buildCodePrompt", () => {
  it("instructs the model to return only a JSON array", () => {
    const prompt = buildCodePrompt();
    expect(prompt).toContain("JSON array");
    expect(prompt).toContain("```json");
  });

  it("includes an example array shape matching the filesToExtract contract", () => {
    const prompt = buildCodePrompt();
    expect(prompt).toContain('["src/a.ts", "src/b.ts"]');
  });
});
