import fs from "fs";
import path from "path";
import { logger } from "./logger";
import { ConfigFile } from "../types";

/**
 * Name of the tool's own directory, created at the project root (the directory
 * the command is invoked from). It holds the configuration file and is where
 * any tool output may be written, which is why it is excluded from snapshots.
 */
const CONFIG_DIR = ".codetree";

/** Configuration file stored inside CONFIG_DIR. */
const CONFIG_FILENAME = "config.json";

/**
 * Entry written into the project's .gitignore so the tool's own directory is
 * not tracked. Uses the trailing-slash directory form to match Git's syntax.
 */
const GITIGNORE_ENTRY = ".codetree/";

export class ConfigReader {
  /**
   * The built-in default configuration.
   *
   * This is written verbatim to `.codetree/config.json` on first run and is
   * also used as the lowest-priority layer when merging settings. The `exclude`
   * list starts empty and belongs entirely to the user: the tool's own always-on
   * exclusions (version control, its own folder, and lockfiles) are applied
   * separately during file discovery and are intentionally not shown here, so a
   * fresh config is not cluttered with patterns the user did not write.
   */
  static getDefaultConfig(): ConfigFile {
    return {
      exclude: [],
      maxDepth: 10,
      maxFileSize: 1048576, // 1 MB
      generateSyntaxTree: false,
      outputFormat: "compact",
    };
  }

  /**
   * Performs first-run setup for a project.
   *
   * First-run state is detected by the presence of the `.codetree` directory:
   * if it already exists the project is considered initialized and nothing is
   * changed, so the user's edits are never overwritten. Otherwise the directory
   * and a default config file are created, and the directory is added to the
   * project's .gitignore.
   *
   * Setup is best-effort. If the files cannot be written (for example due to
   * permissions) the command still proceeds using the built-in defaults rather
   * than failing.
   */
  static ensureConfig(projectRoot: string): void {
    const configDir = path.join(projectRoot, CONFIG_DIR);

    if (fs.existsSync(configDir)) {
      return;
    }

    try {
      fs.mkdirSync(configDir, { recursive: true });

      const configPath = path.join(configDir, CONFIG_FILENAME);
      fs.writeFileSync(
        configPath,
        JSON.stringify(this.getDefaultConfig(), null, 2)
      );
      logger.success(
        `Created configuration: ${path.join(CONFIG_DIR, CONFIG_FILENAME)}`
      );

      this.addToGitignore(projectRoot);
    } catch (error) {
      logger.warn(`Could not create ${CONFIG_DIR} configuration: ${error}`);
    }
  }

  /**
   * Adds the tool's directory to the project's .gitignore, creating the file if
   * it does not exist and appending idempotently if it does.
   */
  private static addToGitignore(projectRoot: string): void {
    const gitignorePath = path.join(projectRoot, ".gitignore");

    try {
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, `${GITIGNORE_ENTRY}\n`);
        logger.info(`Created .gitignore and added ${GITIGNORE_ENTRY}`);
        return;
      }

      const contents = fs.readFileSync(gitignorePath, "utf-8");

      // Accept the entry with or without a trailing slash so an existing
      // `.codetree` line is recognized and not duplicated.
      const alreadyIgnored = contents
        .split("\n")
        .map((line) => line.trim())
        .some((line) => line === GITIGNORE_ENTRY || line === ".codetree");

      if (alreadyIgnored) {
        return;
      }

      // Append on a fresh line, inserting a separating newline only when the
      // file does not already end with one so existing entries are preserved.
      const separator =
        contents.length === 0 || contents.endsWith("\n") ? "" : "\n";
      fs.appendFileSync(gitignorePath, `${separator}${GITIGNORE_ENTRY}\n`);
      logger.info(`Added ${GITIGNORE_ENTRY} to .gitignore`);
    } catch (error) {
      logger.warn(`Could not update .gitignore: ${error}`);
    }
  }

  /**
   * Reads `.codetree/config.json` from the given project root.
   *
   * Returns an empty object when the file is absent or cannot be parsed, so
   * callers always receive a usable (possibly empty) configuration.
   */
  static readConfig(projectRoot: string): Partial<ConfigFile> {
    const configPath = path.join(projectRoot, CONFIG_DIR, CONFIG_FILENAME);

    if (!fs.existsSync(configPath)) {
      logger.debug(`No ${path.join(CONFIG_DIR, CONFIG_FILENAME)} found`);
      return {};
    }

    try {
      const configContent = fs.readFileSync(configPath, "utf-8");
      const config = JSON.parse(configContent) as ConfigFile;
      logger.debug(`Loaded configuration from ${configPath}`);

      // Validate outputFormat if present
      if (
        config.outputFormat &&
        !["compact", "raw"].includes(config.outputFormat)
      ) {
        logger.warn(
          `Invalid outputFormat '${config.outputFormat}' in config file. Using 'compact' as default.`
        );
        config.outputFormat = "compact";
      }

      return config;
    } catch (error) {
      logger.warn(`Failed to parse config file: ${error}`);
      return {};
    }
  }

  /**
   * Resolves the effective settings from command-line options and the config
   * file, falling back to the built-in defaults.
   *
   * For each setting the resolution order is command line, then config file,
   * then default. A command-line value is only present when its flag was
   * actually passed - omitted options are left undefined by the CLI - which is
   * what allows a config file value to take effect rather than being silently
   * overridden by a default applied at the command-line layer.
   *
   * The nullish-coalescing operator is used deliberately so that legitimate
   * zero or false values from the config file are respected rather than treated
   * as absent.
   *
   * Note that .gitignore is not handled here. It is applied during file
   * discovery by the globbing layer, not merged into the exclude list. The
   * additional patterns from the `-e/--exclude` flag are likewise combined
   * separately, where discovery runs.
   */
  static mergeConfigurations(
    cliOptions: {
      maxDepth?: number;
      maxFileSize?: number;
      generateSyntaxTree?: boolean;
      outputFormat?: "compact" | "raw";
    },
    configFile: Partial<ConfigFile>
  ): {
    exclude: string[];
    maxDepth: number;
    maxFileSize: number;
    generateSyntaxTree: boolean;
    outputFormat: "compact" | "raw";
  } {
    const defaults = this.getDefaultConfig();

    return {
      // Once the config file exists its exclude list is authoritative, since it
      // was seeded with the defaults on first run and may since have been
      // edited. The default list is used only when no config file is read, such
      // as under --no-config.
      exclude: configFile.exclude ?? defaults.exclude,
      maxDepth: cliOptions.maxDepth ?? configFile.maxDepth ?? defaults.maxDepth,
      maxFileSize:
        cliOptions.maxFileSize ??
        configFile.maxFileSize ??
        defaults.maxFileSize,
      generateSyntaxTree:
        cliOptions.generateSyntaxTree ??
        configFile.generateSyntaxTree ??
        defaults.generateSyntaxTree,
      outputFormat:
        cliOptions.outputFormat ??
        configFile.outputFormat ??
        defaults.outputFormat,
    };
  }
}
