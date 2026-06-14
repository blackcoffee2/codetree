import fs from "fs/promises";
import path from "path";
import globby from "globby";
import type { Parser } from "web-tree-sitter";
import { LanguageDetector } from "./language_detector";
import { TreeWalker } from "./tree_walker";
import { logger } from "../utils/logger";
import { ConfigReader } from "../utils/config_reader";
import { CompactTextGenerator } from "../utils/compact_text_generator";
import { RawTextGenerator } from "../utils/raw_text_generator";
import { SizeCalculator } from "../utils/size_calculator";
import { isBinaryContent } from "../utils/binary_detector";
import { INTERNAL_IGNORE_PATTERNS } from "../utils/default_ignore";
import { FileInfo, CodeTreeConfig, ParsedFile } from "../types";
import { GenerationResult } from "../types/generation_result";
import ora from "ora";

/**
 * Number of leading bytes read from a file to decide whether it is binary,
 * before committing to reading the whole file as text.
 */
const BINARY_PROBE_SIZE = 8192;

export class CodeTreeGenerator {
  private config: CodeTreeConfig & {
    outputFormat: "compact" | "raw";
    maxDepth: number;
    maxFileSize: number;
    generateSyntaxTree: boolean;
    excludePatterns: string[];
  };
  private languageDetector: LanguageDetector;
  private treeWalker: TreeWalker;

  // The WebAssembly parser is created lazily after a one-time runtime
  // initialization. The promise guards against concurrent or repeated init.
  private parser: Parser | null = null;
  private parserInitPromise: Promise<void> | null = null;

  constructor(config: CodeTreeConfig) {
    this.config = this.mergeWithConfigFiles(config);
    this.languageDetector = new LanguageDetector();
    this.treeWalker = new TreeWalker();
  }

  private mergeWithConfigFiles(config: CodeTreeConfig): CodeTreeConfig & {
    outputFormat: "compact" | "raw";
    maxDepth: number;
    maxFileSize: number;
    generateSyntaxTree: boolean;
    excludePatterns: string[];
  } {
    // Config files live at the project root, which is the directory the command
    // was invoked from (the current working directory). This is intentionally
    // independent of the directory being scanned, so that scanning a
    // subdirectory still uses the project's single configuration.
    const projectRoot = process.cwd();

    // Create the configuration on first run unless reading config is disabled.
    if (config.readConfig) {
      ConfigReader.ensureConfig(projectRoot);
    }

    const configFile = config.readConfig
      ? ConfigReader.readConfig(projectRoot)
      : {};

    // Resolve settings from CLI options, then the config file, then defaults.
    const merged = ConfigReader.mergeConfigurations(
      {
        maxDepth: config.maxDepth,
        maxFileSize: config.maxFileSize,
        generateSyntaxTree: config.generateSyntaxTree,
        outputFormat: config.outputFormat,
      },
      configFile
    );

    // Structural summaries only apply to the compact format, so the syntax-tree
    // option is gated on the resolved format here rather than at the CLI layer.
    const generateSyntaxTree =
      merged.generateSyntaxTree && merged.outputFormat === "compact";

    // The exclude channel handed to the globber combines the always-on internal
    // patterns, the resolved config exclude list, and any patterns from the
    // -e/--exclude flag. The project's .gitignore is applied separately by the
    // globber itself and is not part of this list.
    const excludePatterns = [
      ...INTERNAL_IGNORE_PATTERNS,
      ...merged.exclude,
      ...(config.cliExclude ?? []),
    ];

    return {
      ...config,
      outputFormat: merged.outputFormat,
      maxDepth: merged.maxDepth,
      maxFileSize: merged.maxFileSize,
      generateSyntaxTree,
      excludePatterns,
    };
  }

  /**
   * Initialize the WebAssembly parser exactly once.
   *
   * web-tree-sitter is loaded with a dynamic import so this CommonJS build works
   * whether the package is published as ESM or CommonJS. Parser.init must
   * complete before any grammar is loaded or any source is parsed, so callers
   * await this before invoking the language detector's loader.
   */
  private async ensureParserInitialized(): Promise<void> {
    if (!this.parserInitPromise) {
      this.parserInitPromise = (async () => {
        const { Parser } = await import("web-tree-sitter");
        await Parser.init();
        this.parser = new Parser();
      })();
    }

    return this.parserInitPromise;
  }

  async generate(): Promise<GenerationResult> {
    const spinner = ora("Scanning files...").start();

    try {
      // Get all files to process
      const files = await this.getFilesToProcess();
      spinner.succeed(`Found ${files.length} files to process`);

      if (files.length === 0) {
        logger.warn("No files found to process");
        logger.info("This might be due to:");
        logger.info("- Files being excluded by .gitignore patterns");
        logger.info("- Files being excluded by .codetree/config.json");
        logger.info("- All files in the directory being binary");
        logger.info("- Try using --no-gitignore or --no-config flags");

        // Return empty result. The output content is empty so the CLI can
        // detect that there is nothing worth copying to the clipboard.
        return {
          outputFile: this.config.outputFile,
          originalContent: { bytes: 0, formattedSize: "0 B", tokens: 0 },
          generatedOutput: { bytes: 0, formattedSize: "0 B", tokens: 0 },
          outputFormat: this.config.outputFormat,
          filesProcessed: 0,
          outputContent: "",
        };
      }

      // Process files
      const processSpinner = ora("Processing files...").start();
      const parsedFiles: ParsedFile[] = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        processSpinner.text = `Processing ${file.relativePath} (${i + 1}/${
          files.length
        })`;

        try {
          const parsedFile = await this.processFile(file);
          if (parsedFile) {
            parsedFiles.push(parsedFile);
          }
        } catch (error) {
          logger.warn(`Failed to process ${file.relativePath}:`, error);
        }
      }

      processSpinner.succeed(
        `Processed ${parsedFiles.length} files successfully`
      );

      // Calculate original content size
      const originalContents = parsedFiles.map((file) => file.content);
      const originalContent =
        SizeCalculator.calculateTotalSize(originalContents);

      // Generate output
      const outputSpinner = ora("Generating output...").start();
      const outputContent = await this.generateOutput(parsedFiles);
      const generatedOutput =
        SizeCalculator.calculateContentSize(outputContent);
      outputSpinner.succeed("Output generated successfully");

      return {
        outputFile: this.config.outputFile,
        originalContent,
        generatedOutput,
        outputFormat: this.config.outputFormat,
        filesProcessed: parsedFiles.length,
        // Returned so the CLI can copy the snapshot to the clipboard without
        // re-reading the file it was just written to.
        outputContent,
      };
    } catch (error) {
      spinner.fail("Failed to generate code tree");
      throw error;
    }
  }

  private async getFilesToProcess(): Promise<FileInfo[]> {
    const files: FileInfo[] = [];

    logger.debug(`Scanning directory: ${this.config.rootDirectory}`);
    logger.debug(
      `Exclude patterns: ${JSON.stringify(this.config.excludePatterns)}`
    );
    logger.debug(`Reading .gitignore: ${this.config.readGitignore}`);

    // The globber walks the scan root, pruning the internal and configured
    // exclude patterns during traversal. When enabled, it also reads and
    // applies the project's .gitignore - in the common case (no negation
    // patterns or nested ignore files) it skips traversing ignored directories
    // entirely, which avoids walking large dependency or build directories.
    let matches: string[] = [];
    try {
      matches = await globby("**/*", {
        cwd: this.config.rootDirectory,
        absolute: true,
        onlyFiles: true,
        dot: false,
        gitignore: this.config.readGitignore,
        ignore: this.config.excludePatterns,
      });
    } catch (globError) {
      logger.debug(`Globbing failed: ${globError}`);
    }

    logger.debug(`Globber returned ${matches.length} candidate files`);

    for (const filePath of matches) {
      try {
        const relativePath = path.relative(this.config.rootDirectory, filePath);

        const stats = await fs.stat(filePath);

        // Skip files that are too large
        if (stats.size > this.config.maxFileSize) {
          logger.warn(`Skipping large file: ${filePath} (${stats.size} bytes)`);
          continue;
        }

        // Depth is measured relative to the scan root, so a subdirectory
        // snapshot's depth limit is counted from that subdirectory.
        const depth = relativePath.split(path.sep).length;

        logger.debug(
          `File: ${relativePath}, depth: ${depth}, maxDepth: ${this.config.maxDepth}`
        );

        if (depth > this.config.maxDepth) {
          logger.debug(
            `Skipping file due to depth: ${relativePath} (depth: ${depth})`
          );
          continue;
        }

        // Language detection no longer gates inclusion: a file without an
        // associated grammar is still included (with a null language) and is
        // simply listed without a structural summary. Detection only governs
        // whether a richer summary can be produced.
        const language = this.languageDetector.detectLanguage(filePath);

        logger.debug(
          `File: ${relativePath}, detected language: ${language ?? "none"}`
        );

        files.push({
          absolutePath: filePath,
          relativePath,
          size: stats.size,
          language,
          extension: path.extname(filePath),
        });

        logger.debug(`Added file: ${relativePath}`);
      } catch (error) {
        logger.debug(`Error processing file ${filePath}: ${error}`);
      }
    }

    logger.debug(`Total files found: ${files.length}`);
    return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  }

  private async processFile(file: FileInfo): Promise<ParsedFile | null> {
    try {
      // Read the leading bytes first and hard-ignore the file if its content
      // looks binary. This is the sole mechanism for excluding binaries - there
      // is no extension list - so it applies regardless of output format.
      const buffer = await fs.readFile(file.absolutePath);
      if (isBinaryContent(buffer.subarray(0, BINARY_PROBE_SIZE))) {
        logger.debug(`Skipping binary file: ${file.relativePath}`);
        return null;
      }

      const content = buffer.toString("utf-8");

      // For raw format, we don't need syntax tree or structural summary, and
      // the parser is never initialized.
      if (this.config.outputFormat === "raw") {
        return {
          fileInfo: file,
          content,
          syntaxTree: null,
          structuralSummary: null,
          lineCount: content.split("\n").length,
          encoding: "utf-8",
        };
      }

      let syntaxTree = null;
      let structuralSummary = null;

      // For compact format, generate structural analysis when a grammar is
      // available for the file. Files without a grammar fall through with a
      // null summary and are listed without symbols.
      if (file.language) {
        // The runtime must be initialized before a grammar can be loaded.
        await this.ensureParserInitialized();

        const language = await this.languageDetector.getSafeParser(
          file.language
        );

        if (language && this.parser) {
          try {
            this.parser.setLanguage(language);
            const tree = this.parser.parse(content);

            if (tree) {
              // Only retain the full syntax tree when it was explicitly
              // requested.
              if (this.config.generateSyntaxTree) {
                syntaxTree = tree.rootNode.toString();
              }

              structuralSummary = this.treeWalker.extractSummary(
                tree.rootNode,
                content
              );
            }
          } catch (parseError) {
            // A parse failure leaves the summary null: the file is still listed,
            // just without a symbol outline, rather than being dropped.
            logger.debug(`Failed to parse ${file.relativePath}: ${parseError}`);
          }
        }
      }

      return {
        fileInfo: file,
        content,
        syntaxTree,
        structuralSummary,
        lineCount: content.split("\n").length,
        encoding: "utf-8",
      };
    } catch (error) {
      logger.warn(`Error processing file ${file.relativePath}:`, error);
      return null;
    }
  }

  private async generateOutput(parsedFiles: ParsedFile[]): Promise<string> {
    let outputContent: string;

    if (this.config.outputFormat === "compact") {
      logger.verbose("Generating compact text output...");
      outputContent = CompactTextGenerator.generate(
        parsedFiles,
        this.config.rootDirectory
      );
    } else if (this.config.outputFormat === "raw") {
      logger.verbose("Generating raw text output...");
      outputContent = RawTextGenerator.generate(
        parsedFiles,
        this.config.rootDirectory
      );
    } else {
      throw new Error(`Unsupported output format: ${this.config.outputFormat}`);
    }

    // Ensure the output directory exists before writing. The default output
    // path lives inside the .codetree directory, which may not have been
    // created yet when config reading is disabled, and a user-supplied path may
    // point at a directory that does not exist.
    await fs.mkdir(path.dirname(this.config.outputFile), { recursive: true });

    // Write to file
    await fs.writeFile(this.config.outputFile, outputContent);

    logger.verbose(`Output written to ${this.config.outputFile}`);

    return outputContent;
  }
}
