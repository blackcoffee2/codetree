import { SupportedLanguage } from "../core/language_detector";

/**
 * Describes a single file discovered during the directory walk.
 *
 * `language` is null when no Tree-sitter grammar is available for the file's
 * extension. Such files are still included in a snapshot - language detection
 * only governs whether a richer structural summary can be produced, not whether
 * the file is processed at all.
 *
 * `relativePath` is relative to the scan root (the directory passed on the
 * command line), not the current working directory, so a snapshot of a
 * subdirectory remains self-contained.
 */
export interface FileInfo {
  absolutePath: string;
  relativePath: string;
  size: number;
  language: SupportedLanguage | null;
  extension: string;
}

/**
 * A file that has been read and, where possible, analyzed.
 *
 * `syntaxTree` and `structuralSummary` are null when the file has no associated
 * grammar, when structural analysis was not requested, or when parsing failed.
 * A null `structuralSummary` causes the file to be listed without a symbol
 * outline rather than excluded.
 */
export interface ParsedFile {
  fileInfo: FileInfo;
  content: string;
  syntaxTree: string | null;
  structuralSummary: string | null;
  lineCount: number;
  encoding: string;
}

/**
 * Runtime configuration constructed by the CLI and passed to the generator.
 *
 * The settings that may also be defined in `.codetree/config.json` -
 * `outputFormat`, `maxDepth`, `maxFileSize`, and `generateSyntaxTree` - are
 * optional here. When the corresponding command-line flag is omitted, the value
 * is left undefined so that the configuration file (and then the built-in
 * default) can supply it. If these were always given a concrete value at the
 * CLI layer, that value would unconditionally override the config file.
 *
 * `readGitignore` and `readConfig` are always set, since they are driven by
 * boolean flags (`--no-gitignore`, `--no-config`) that default to enabled.
 * Note that there is no configuration key for reading .gitignore: it is always
 * read unless `--no-gitignore` is passed.
 *
 * `cliExclude` carries any additional patterns supplied via `-e/--exclude`.
 * These are merged with the config file's `exclude` and the project's
 * .gitignore rather than replacing them.
 */
export interface CodeTreeConfig {
  rootDirectory: string;
  outputFile: string;
  outputFormat?: "compact" | "raw";
  maxDepth?: number;
  maxFileSize?: number;
  generateSyntaxTree?: boolean;
  readGitignore: boolean;
  readConfig: boolean;
  verbose: boolean;
  cliExclude?: string[];
}

/**
 * Shape of the on-disk `.codetree/config.json` file.
 *
 * `exclude` is seeded on first run with the default lockfile patterns and is
 * fully user-editable. There is intentionally no `include` key: scoping a
 * snapshot to a subset of the project is done by passing a directory on the
 * command line. There is also no `readGitignore` key, as .gitignore is always
 * read (overridable per-run with `--no-gitignore`).
 *
 * `filesToExtract` is consumed only by the `code` command, which reads a
 * hand-picked list of files to output verbatim.
 */
export interface ConfigFile {
  exclude: string[];
  maxDepth: number;
  maxFileSize: number;
  generateSyntaxTree: boolean;
  outputFormat: "compact" | "raw";
  filesToExtract?: string[];
}

export interface AnalysisStats {
  totalFiles: number;
  totalLines: number;
  totalSize: number;
  languageDistribution: Record<string, number>;
  largestFiles: Array<{
    path: string;
    size: number;
    lines: number;
  }>;
}

export * from "./generation_result";
