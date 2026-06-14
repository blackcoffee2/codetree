#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { CodeTreeGenerator } from "./core/code_tree_generator";
import { ProjectRootFinder } from "./utils/project_root_finder";
import { logger } from "./utils/logger";
import path from "path";
import fs from "fs";
import { ConfigReader } from "./utils/config_reader";
import { FileExtractor } from "./core/file_extractor";
import { resolveOutputFormat } from "./utils/output_format";
import { buildTreePrompt, buildCodePrompt } from "./utils/prompt_templates";
import { copyToClipboard } from "./utils/clipboard";

const program = new Command();

const { version } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf-8")
);

program
  .name("codetree")
  .description("Generate Tree-sitter based snapshots of your codebase")
  .version(version);

/**
 * Delivers a generated prompt either by copying it to the clipboard (the
 * default) or by printing it to stdout when the user passed --print.
 *
 * In print mode the prompt is written on its own with no surrounding log lines,
 * so the output stays clean for redirection or piping into another tool. In the
 * default copy mode a single confirmation line is shown. If the clipboard write
 * fails - which is expected in headless, SSH, or CI environments where no
 * clipboard provider exists - the prompt is printed as a fallback with a warning
 * so it is never silently lost.
 */
async function deliverPrompt({
  prompt,
  command,
  print,
  format,
}: {
  prompt: string;
  command: "tree" | "code";
  print: boolean;
  format?: "compact" | "raw";
}): Promise<void> {
  if (print) {
    console.log(prompt);
    return;
  }

  try {
    await copyToClipboard(prompt);
    logger.success(
      chalk.green(
        `${command} prompt ${format ? `${format}` : ""} copied to clipboard`
      )
    );
  } catch (error) {
    logger.warn(`Could not copy to clipboard: ${error}`);
    logger.warn("Printing the prompt instead so it is not lost:");
    console.log(prompt);
  }
}

/**
 * Copies generated snapshot content to the system clipboard as a convenience
 * after the output file has already been written.
 *
 * Unlike deliverPrompt, the fallback here does not print the content to stdout
 * on failure: snapshots can be very large (especially the raw format), and the
 * content is already safely persisted to the output file, so a warning that
 * points back at that file is the appropriate fallback. A clipboard failure -
 * routine in headless, SSH, or CI environments - therefore never fails the
 * command, since the primary deliverable (the file) is unaffected.
 */
async function copyOutputToClipboard(
  content: string,
  outputFile: string
): Promise<void> {
  try {
    await copyToClipboard(content);
    logger.success(chalk.green("📋 Output also copied to clipboard"));
  } catch (error) {
    logger.warn(`Could not copy to clipboard: ${error}`);
    logger.warn(`The output is still available in ${outputFile}`);
  }
}

const treeCommand = program
  .command("tree")
  .description("Generate a codetree snapshot of the specified directory")
  .argument(
    "[directory]",
    "Directory to analyze (defaults to current directory)",
    "."
  )
  .option("-o, --output <file>", "Output file path")
  .option(
    "-f, --format <format>",
    "Output format: 'compact' (default) or 'raw'"
  )
  .option(
    "-e, --exclude <patterns...>",
    "Additional patterns to exclude (glob format)",
    []
  )
  .option("-d, --max-depth <number>", "Maximum directory depth to traverse")
  .option("-s, --max-size <size>", "Maximum file size to process (in KB)")
  .option(
    "--syntax-tree",
    "Include syntax trees in output (compact format only, increases size significantly)"
  )
  .option("--no-gitignore", "Skip reading .gitignore file")
  .option("--no-config", "Skip reading .codetree/config.json file")
  .option("--no-copy", "Skip copying the generated output to the clipboard")
  .option("--verbose", "Enable verbose logging")
  .action(async (directory: string, options) => {
    try {
      if (options.verbose) {
        logger.setVerbose(true);
      }

      // Validate format option only when explicitly provided. When omitted, the
      // value is left undefined so the config file (then the built-in default)
      // can supply it.
      if (options.format && !["compact", "raw"].includes(options.format)) {
        logger.error(
          `Invalid format '${options.format}'. Use 'compact' or 'raw'.`
        );
        process.exit(1);
      }

      // First-run setup (create .codetree/config.json) unless config reading is
      // disabled. Anchored at the current working directory, not the directory
      // being scanned.
      if (options.config) {
        ConfigReader.ensureConfig(process.cwd());
      }

      // Set default output file if not specified. The default lives inside the
      // tool's own .codetree directory (at the project root) so generated
      // snapshots are kept out of the project tree: that directory is already
      // added to .gitignore on first run and is always excluded from scans.
      let outputFile = options.output;
      if (!outputFile) {
        outputFile = path.join(".codetree", "codetree_tree.txt");
      }

      logger.info(chalk.blue("🌳 CodeTree - Analyzing your codebase..."));
      logger.info(`Target directory: ${chalk.cyan(path.resolve(directory))}`);

      // Show user what project root was detected and add gitignore warning
      const { projectRoot } = ProjectRootFinder.getConfigPaths(
        directory,
        options.gitignore
      );

      if (!options.gitignore) {
        logger.warn(
          "⚠️  Skipping .gitignore - will process ALL files in directory!"
        );
        logger.warn(
          "   This will likely include build artifacts, dependencies, and other unwanted files."
        );
        logger.warn(
          "   Consider using .gitignore patterns for proper exclusions."
        );
      } else {
        logger.info(`📋 Using .gitignore patterns for file exclusions`);
      }

      if (projectRoot !== path.resolve(directory)) {
        logger.info(`Project root detected: ${projectRoot}`);
        logger.info(`Config files will be read from: ${projectRoot}`);
      }

      // Validate directory
      if (!fs.existsSync(directory)) {
        logger.error(`Directory '${directory}' does not exist`);
        process.exit(1);
      }

      if (!fs.statSync(directory).isDirectory()) {
        logger.error(`'${directory}' is not a directory`);
        process.exit(1);
      }

      // Warn about syntax tree option with raw format
      if (options.syntaxTree && options.format === "raw") {
        logger.warn("⚠️  --syntax-tree option is ignored for raw format");
      }

      const generator = new CodeTreeGenerator({
        rootDirectory: path.resolve(directory),
        outputFile: outputFile,
        // The settings below are left undefined when their flags are omitted so
        // that the config file can take effect. Numeric flags are parsed only
        // when present. The syntax-tree flag is undefined unless passed; its
        // compact-format gating is applied after resolution in the generator.
        outputFormat: options.format,
        maxDepth:
          options.maxDepth !== undefined
            ? parseInt(options.maxDepth)
            : undefined,
        maxFileSize:
          options.maxSize !== undefined
            ? parseInt(options.maxSize) * 1024
            : undefined,
        generateSyntaxTree: options.syntaxTree === true ? true : undefined,
        cliExclude: options.exclude,
        readGitignore: options.gitignore,
        readConfig: options.config,
        verbose: options.verbose,
      });

      // Generate the code tree and get results
      const result = await generator.generate();

      // Success message with detailed statistics
      logger.success(chalk.green(`✅ Code snapshot generated: ${outputFile}`));
      logger.info("");
      logger.info("📊 Generation Summary:");
      logger.info(`   Files processed: ${result.filesProcessed}`);

      if (result.filesProcessed > 0) {
        logger.info(
          `   Original content: ${
            result.originalContent.formattedSize
          } (${result.originalContent.tokens.toLocaleString()} tokens)`
        );
        logger.info(
          `   Generated output: ${
            result.generatedOutput.formattedSize
          } (${result.generatedOutput.tokens.toLocaleString()} tokens)`
        );

        const compressionRatio =
          (result.generatedOutput.bytes / result.originalContent.bytes) * 100;

        // Report against the resolved output format rather than inferring it
        // from byte sizes. Only the compact format produces a structural index
        // smaller than the source, so a compression ratio is meaningful only
        // there; the raw format reproduces the full source and is expected to be
        // slightly larger than the input because of the added header.
        const isCompact = result.outputFormat === "compact";

        if (isCompact) {
          const compressionColor =
            compressionRatio < 10
              ? chalk.green
              : compressionRatio < 25
                ? chalk.yellow
                : chalk.red;

          logger.info(
            `   Compression ratio: ${compressionColor(
              compressionRatio.toFixed(1) + "%"
            )}`
          );
        }

        // Additional helpful info
        const savedBytes =
          result.originalContent.bytes - result.generatedOutput.bytes;
        const savedSize = (savedBytes / 1024).toFixed(1);
        if (savedBytes > 0) {
          logger.info(`   Space saved: ${chalk.green(savedSize + " KB")}`);
        } else if (savedBytes < 0) {
          const addedSize = (Math.abs(savedBytes) / 1024).toFixed(1);
          logger.info(
            `   Space added: ${chalk.yellow(
              addedSize + " KB"
            )} (due to headers)`
          );
        }
      }

      // Copy the generated snapshot to the clipboard by default. Skipped when
      // --no-copy was passed (which sets options.copy to false) and when no
      // files were processed, since there is nothing useful to paste. A
      // clipboard failure only warns; the file has already been written.
      if (options.copy && result.filesProcessed > 0) {
        await copyOutputToClipboard(result.outputContent, outputFile);
      }
    } catch (error) {
      logger.error("Failed to generate code snapshot:", error);
      process.exit(1);
    }
  });

// Copy an LLM prompt describing how to read a generated tree snapshot. The
// prompt is selected for whichever output format the project is configured to
// produce, so the model is told how to interpret the exact artifact it will be
// handed. This is a sibling subcommand of `tree`; commander dispatches the
// matching subcommand name ahead of binding the parent's optional [directory]
// argument, so `codetree tree prompt` reaches this action rather than being read
// as a directory named "prompt".
treeCommand
  .command("prompt")
  .description(
    "Copy an LLM prompt explaining how to read a generated tree snapshot"
  )
  .option(
    "--print",
    "Print the prompt to stdout instead of copying it to the clipboard"
  )
  .action(async (options) => {
    try {
      // The format is read from the project configuration only. No config is
      // created here, since emitting a prompt should not write to the project.
      const format = resolveOutputFormat(process.cwd());
      const prompt = buildTreePrompt(format);
      await deliverPrompt({
        prompt: prompt,
        command: "tree",
        print: options.print === true,
        format: format,
      });
    } catch (error) {
      logger.error("Failed to generate tree prompt:", error);
      process.exit(1);
    }
  });

const codeCommand = program
  .command("code")
  .description("Extract specific files and output their raw content")
  .option(
    "--files <files>",
    "Comma-separated list of files to extract (e.g., 'main.ts,helper.js,utils/config.js')"
  )
  .option(
    "-o, --output <file>",
    "Output file path",
    path.join(".codetree", "codetree_code.txt")
  )
  .option("--no-config", "Skip reading .codetree/config.json file")
  .option("--no-copy", "Skip copying the extracted output to the clipboard")
  .option("--verbose", "Enable verbose logging")
  .action(async (options) => {
    try {
      if (options.verbose) {
        logger.setVerbose(true);
      }

      logger.info(
        chalk.blue("📄 CodeTree Extract - Extracting specific files...")
      );

      const currentDir = process.cwd();

      // First-run setup unless config reading is disabled.
      if (options.config) {
        ConfigReader.ensureConfig(currentDir);
      }

      let filesToExtract: string[] = [];

      // Get files from CLI option if provided
      if (options.files) {
        filesToExtract = options.files
          .split(",")
          .map((file: string) => file.trim())
          .filter((file: string) => file.length > 0);

        logger.info(
          `📁 Files from CLI: ${chalk.cyan(filesToExtract.join(", "))}`
        );
      }

      // Read from config if no CLI files provided and config is enabled
      if (filesToExtract.length === 0 && options.config) {
        const configFile = ConfigReader.readConfig(currentDir);
        if (
          configFile.filesToExtract &&
          Array.isArray(configFile.filesToExtract)
        ) {
          filesToExtract = configFile.filesToExtract;
          logger.info(
            `📁 Files from config: ${chalk.cyan(filesToExtract.join(", "))}`
          );
        }
      }

      // Validate we have files to extract
      if (filesToExtract.length === 0) {
        logger.error("No files specified for extraction.");
        logger.info("");
        logger.info("💡 Usage examples:");
        logger.info(
          `   ${chalk.cyan("codetree code --files 'main.ts,helper.js'")}`
        );
        logger.info(
          `   ${chalk.cyan(
            "codetree code --files 'src/utils.ts,lib/config.js'"
          )}`
        );
        logger.info(
          `   ${chalk.cyan("codetree code")} ${chalk.gray(
            "# Uses filesToExtract from config"
          )}`
        );
        logger.info("");
        logger.info("📝 Config file example (.codetree/config.json):");
        logger.info("   {");
        logger.info(
          '     "filesToExtract": ["main.ts", "helper.js", "src/utils.ts"]'
        );
        logger.info("   }");
        process.exit(1);
      }

      logger.info(
        `🔍 Auto-location enabled: files will be searched if not found at exact path`
      );
      logger.info(`📤 Output file: ${chalk.cyan(options.output)}`);

      const extractor = new FileExtractor({
        rootDirectory: currentDir,
        outputFile: options.output,
        filesToExtract,
        verbose: options.verbose,
      });

      const result = await extractor.extract();

      // Success message with detailed stats
      logger.success(chalk.green(`✅ Files extracted to: ${options.output}`));
      logger.info("");
      logger.info("📊 Extraction Summary:");
      logger.info(`   Files requested: ${filesToExtract.length}`);
      logger.info(
        `   Files found: ${chalk.green(result.filesFound.toString())}`
      );
      logger.info(
        `   Files extracted: ${chalk.green(result.filesExtracted.toString())}`
      );
      logger.info(
        `   Total size: ${
          result.totalSize.formattedSize
        } (${result.totalSize.tokens.toLocaleString()} tokens)`
      );

      if (result.missingFiles.length > 0) {
        logger.warn(
          `⚠️  Missing or skipped files (${
            result.missingFiles.length
          }): ${chalk.yellow(result.missingFiles.join(", "))}`
        );
        logger.info(
          "   💡 Check file names and paths, or use --verbose for search details"
        );
      }

      if (result.filesExtracted > 0) {
        logger.info("");
        logger.info("🎉 Next steps:");
        logger.info(
          `   • Review extracted content in ${chalk.cyan(options.output)}`
        );
        logger.info(
          "   • Use the file for code analysis, LLM processing, or documentation"
        );
      }

      // Copy the extracted output to the clipboard by default. Skipped when
      // --no-copy was passed (which sets options.copy to false) and when no
      // files were extracted, since there is nothing useful to paste. A
      // clipboard failure only warns; the file has already been written.
      if (options.copy && result.filesExtracted > 0) {
        await copyOutputToClipboard(result.outputContent, options.output);
      }
    } catch (error) {
      logger.error("Failed to extract files:", error);
      process.exit(1);
    }
  });

// Copy an LLM prompt describing how to request files from a snapshot. The prompt
// instructs the model to reply with a JSON array of relative paths, which is the
// shape the `filesToExtract` config key expects, so the result can be pasted
// straight into the configuration before running `codetree code`. As with the
// tree prompt, this is a sibling subcommand and the format is read from config.
codeCommand
  .command("prompt")
  .description(
    "Copy an LLM prompt explaining how to request files from a snapshot"
  )
  .option(
    "--print",
    "Print the prompt to stdout instead of copying it to the clipboard"
  )
  .action(async (options) => {
    try {
      const prompt = buildCodePrompt();
      await deliverPrompt({
        prompt,
        command: "code",
        print: options.print === true,
      });
    } catch (error) {
      logger.error("Failed to generate code prompt:", error);
      process.exit(1);
    }
  });

program
  .command("languages")
  .description("List supported programming languages")
  .action(() => {
    const supportedLanguages = [
      "JavaScript (.js, .mjs, .cjs, .jsx)",
      "TypeScript (.ts, .tsx, .d.ts)",
      "Python (.py, .pyw, .py3)",
      "Java (.java)",
      "Kotlin (.kt, .kts)",
      "Go (.go)",
      "Rust (.rs)",
      "C++ (.cpp, .cc, .cxx, .hpp, .hxx, .hh)",
      "C (.c, .h)",
      "Dart (.dart)",
      "Swift (.swift)",
    ];

    logger.info(chalk.blue("🔧 Supported Languages for Structural Summaries:"));
    supportedLanguages.forEach((lang) => {
      console.log(`  • ${lang}`);
    });

    logger.info("");
    logger.info(
      chalk.gray(
        "Note: Files in other languages are still included as plain text;"
      )
    );
    logger.info(
      chalk.gray(
        "      only these produce a Tree-sitter structural summary in compact format."
      )
    );
  });

// Validate command to check project structure
program
  .command("validate")
  .description("Validate project structure and configuration")
  .option("--no-gitignore", "Skip .gitignore validation")
  .action((options) => {
    try {
      logger.info(chalk.blue("🔍 Validating project structure..."));

      const currentDir = process.cwd();

      // Check project root requirements
      if (options.gitignore) {
        try {
          ProjectRootFinder.validateProjectRoot(currentDir);
          logger.success(
            "✅ Project root validation passed (.gitignore found)"
          );

          // Check .gitignore content
          const gitignorePath = path.join(currentDir, ".gitignore");
          const gitignoreContent = fs.readFileSync(gitignorePath, "utf-8");
          const lineCount = gitignoreContent
            .split("\n")
            .filter((line) => line.trim() && !line.startsWith("#")).length;
          logger.info(
            `   📋 .gitignore contains ${lineCount} exclusion patterns`
          );
        } catch (error) {
          logger.error(
            `❌ Project root validation failed: ${
              error instanceof Error ? error.message : error
            }`
          );
          process.exit(1);
        }
      } else {
        logger.info("ℹ️  Skipping .gitignore validation (--no-gitignore flag)");
      }

      // Check for config file
      const configPath = path.join(currentDir, ".codetree", "config.json");
      if (fs.existsSync(configPath)) {
        try {
          const configContent = fs.readFileSync(configPath, "utf-8");
          const config = JSON.parse(configContent);

          // Validate outputFormat if present
          if (
            config.outputFormat &&
            !["compact", "raw"].includes(config.outputFormat)
          ) {
            logger.error(
              `❌ Invalid outputFormat '${config.outputFormat}' in config. Use 'compact' or 'raw'.`
            );
            process.exit(1);
          }

          logger.success("✅ Configuration file is valid JSON");
          if (config.outputFormat) {
            logger.info(`   Output format: ${config.outputFormat}`);
          }

          const excludeCount = config.exclude ? config.exclude.length : 0;
          logger.info(
            `   📋 Config contains ${excludeCount} exclusion patterns`
          );
        } catch (error) {
          logger.error("❌ Configuration file contains invalid JSON");
          process.exit(1);
        }
      } else {
        logger.info(
          "ℹ️  No .codetree/config.json found (will be created on first run)"
        );
        logger.info(`   💡 Run ${chalk.cyan("codetree tree")} to create one`);
      }

      // Check for common project files
      const commonFiles = [
        "package.json",
        "pyproject.toml",
        "Cargo.toml",
        "go.mod",
        "pubspec.yaml", // Flutter
      ];
      const foundFiles = commonFiles.filter((file) =>
        fs.existsSync(path.join(currentDir, file))
      );

      if (foundFiles.length > 0) {
        logger.success(`✅ Detected project type(s): ${foundFiles.join(", ")}`);

        // Flutter-specific suggestion
        if (foundFiles.includes("pubspec.yaml")) {
          logger.info(
            `   💡 For Flutter projects, try: ${chalk.cyan(
              "codetree tree lib"
            )}`
          );
        }
      } else {
        logger.warn("⚠️  No common project files detected");
      }

      logger.success(
        chalk.green("🎉 Project validation completed successfully")
      );
    } catch (error) {
      logger.error("Failed to validate project:", error);
      process.exit(1);
    }
  });

// Error handling
program.exitOverride();

try {
  program.parse();
} catch (error) {
  if (error instanceof Error) {
    logger.error(error.message);
  }
  process.exit(1);
}

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
