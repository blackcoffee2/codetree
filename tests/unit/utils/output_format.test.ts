import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveOutputFormat } from "@/utils/output_format";

describe("resolveOutputFormat", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetree-format-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns the configured format when one is present", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ outputFormat: "raw" })
    );

    expect(resolveOutputFormat(tempDir)).toBe("raw");
  });

  it("falls back to the default when no config file exists", () => {
    // Resolving a format is read-only and must not create a config file, so a
    // project that has never been configured simply resolves to the default.
    expect(resolveOutputFormat(tempDir)).toBe("compact");
    expect(fs.existsSync(path.join(tempDir, ".codetree"))).toBe(false);
  });

  it("falls back to the default when the config omits the format key", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ maxDepth: 4 })
    );

    expect(resolveOutputFormat(tempDir)).toBe("compact");
  });
});
