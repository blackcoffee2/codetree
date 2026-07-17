import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { ConfigReader } from "@/utils/config_reader";

// The logger writes through the global console, and this suite deliberately
// exercises paths that log by design: first-run creation announces the config
// and gitignore it writes, and the failure-path tests trigger warnings for an
// invalid outputFormat and malformed JSON. Vitest echoes anything printed
// during a test, so the console is silenced for the whole file to keep the
// test output clean. The mocks are restored after each test so no other file
// is affected.
beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ConfigReader.getDefaultConfig", () => {
  it("starts with an empty user exclude list and compact format", () => {
    const defaults = ConfigReader.getDefaultConfig();
    expect(defaults.exclude).toEqual([]);
    expect(defaults.outputFormat).toBe("compact");
    expect(defaults.maxDepth).toBe(10);
    expect(defaults.generateSyntaxTree).toBe(false);
  });
});

describe("ConfigReader.mergeConfigurations", () => {
  it("prefers a command-line value over both the config file and defaults", () => {
    const merged = ConfigReader.mergeConfigurations(
      { maxDepth: 3 },
      { maxDepth: 7 }
    );
    expect(merged.maxDepth).toBe(3);
  });

  it("falls back to the config file when the command-line value is omitted", () => {
    const merged = ConfigReader.mergeConfigurations(
      {},
      { maxDepth: 7, outputFormat: "raw" }
    );
    expect(merged.maxDepth).toBe(7);
    expect(merged.outputFormat).toBe("raw");
  });

  it("falls back to defaults when neither source supplies a value", () => {
    const merged = ConfigReader.mergeConfigurations({}, {});
    const defaults = ConfigReader.getDefaultConfig();
    expect(merged.maxDepth).toBe(defaults.maxDepth);
    expect(merged.maxFileSize).toBe(defaults.maxFileSize);
    expect(merged.outputFormat).toBe(defaults.outputFormat);
  });

  it("respects a false generateSyntaxTree from the config file", () => {
    // Nullish coalescing must treat false as a present value rather than
    // skipping past it to the default.
    const merged = ConfigReader.mergeConfigurations(
      {},
      { generateSyntaxTree: false }
    );
    expect(merged.generateSyntaxTree).toBe(false);
  });

  it("respects a zero maxDepth from the config file", () => {
    // Zero is a legitimate value and must not be coalesced away to the default.
    const merged = ConfigReader.mergeConfigurations({}, { maxDepth: 0 });
    expect(merged.maxDepth).toBe(0);
  });

  it("uses the config file exclude list when present", () => {
    const merged = ConfigReader.mergeConfigurations(
      {},
      { exclude: ["**/*.spec.ts"] }
    );
    expect(merged.exclude).toEqual(["**/*.spec.ts"]);
  });

  it("uses the default exclude list when the config omits it", () => {
    const merged = ConfigReader.mergeConfigurations({}, {});
    expect(merged.exclude).toEqual(ConfigReader.getDefaultConfig().exclude);
  });
});

describe("ConfigReader filesystem behavior", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "codetree-config-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("creates the config directory, config file, and gitignore entry on first run", () => {
    ConfigReader.ensureConfig(tempDir);

    const configPath = path.join(tempDir, ".codetree", "config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const written = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(written).toEqual(ConfigReader.getDefaultConfig());

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".gitignore"),
      "utf-8"
    );
    expect(gitignore).toContain(".codetree/");
  });

  it("does not overwrite an existing .codetree directory", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "config.json");
    fs.writeFileSync(configPath, JSON.stringify({ outputFormat: "raw" }));

    ConfigReader.ensureConfig(tempDir);

    // The user's edited config is preserved untouched because the directory
    // already existed.
    const after = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(after).toEqual({ outputFormat: "raw" });
  });

  it("does not duplicate the gitignore entry when it is already present", () => {
    fs.writeFileSync(path.join(tempDir, ".gitignore"), ".codetree\n");

    ConfigReader.ensureConfig(tempDir);

    const gitignore = fs.readFileSync(
      path.join(tempDir, ".gitignore"),
      "utf-8"
    );
    const occurrences = gitignore
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line === ".codetree" || line === ".codetree/");
    expect(occurrences).toHaveLength(1);
  });

  it("returns an empty object when no config file exists", () => {
    expect(ConfigReader.readConfig(tempDir)).toEqual({});
  });

  it("reads a valid config file from disk", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ outputFormat: "raw", maxDepth: 5 })
    );

    const config = ConfigReader.readConfig(tempDir);
    expect(config.outputFormat).toBe("raw");
    expect(config.maxDepth).toBe(5);
  });

  it("coerces an invalid outputFormat back to compact", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, "config.json"),
      JSON.stringify({ outputFormat: "nonsense" })
    );

    expect(ConfigReader.readConfig(tempDir).outputFormat).toBe("compact");
  });

  it("returns an empty object when the config file is malformed JSON", () => {
    const configDir = path.join(tempDir, ".codetree");
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(path.join(configDir, "config.json"), "{ not valid json");

    expect(ConfigReader.readConfig(tempDir)).toEqual({});
  });
});
