import fs from "fs/promises";
import path from "path";
import globby from "globby";
import { logger } from "../utils/logger";
import { SizeCalculator, SizeInfo } from "../utils/size_calculator";
import { isBinaryContent } from "../utils/binary_detector";
import ora from "ora";

/**
 * Number of leading bytes read from a file to decide whether it is binary.
 */
const BINARY_PROBE_SIZE = 8192;

export interface ExtractConfig {
  rootDirectory: string;
  outputFile: string;
  filesToExtract: string[];
  verbose: boolean;
}

export interface ExtractionResult {
  outputFile: string;
  filesFound: number;
  filesExtracted: number;
  missingFiles: string[];
  totalSize: SizeInfo;
  outputContent: string;
}

interface FileSearchResult {
  found: boolean;
  resolvedPath?: string;
  relativePath?: string;
  multipleMatches?: string[];
}

export class FileExtractor {
  private config: ExtractConfig;

  constructor(config: ExtractConfig) {
    this.config = config;
  }

  async extract(): Promise<ExtractionResult> {
    const spinner = ora("Extracting files...").start();

    try {
      const result: ExtractionResult = {
        outputFile: this.config.outputFile,
        filesFound: 0,
        filesExtracted: 0,
        missingFiles: [],
        totalSize: { bytes: 0, formattedSize: "0 B", tokens: 0 },
        outputContent: "",
      };

      const extractedContents: string[] = [];
      const outputLines: string[] = [];

      // Process each file
      for (const requestedFile of this.config.filesToExtract) {
        spinner.text = `Searching for ${requestedFile}...`;

        const searchResult = await this.findFile(requestedFile);

        if (
          searchResult.found &&
          searchResult.resolvedPath &&
          searchResult.relativePath
        ) {
          try {
            // Read raw bytes first so binary files can be hard-ignored rather
            // than dumped as garbage into the text output.
            const buffer = await fs.readFile(searchResult.resolvedPath);
            if (isBinaryContent(buffer.subarray(0, BINARY_PROBE_SIZE))) {
              result.missingFiles.push(requestedFile);
              logger.warn(`Skipping binary file: ${searchResult.relativePath}`);
              continue;
            }

            const content = buffer.toString("utf-8");
            extractedContents.push(content);

            // Add to output
            outputLines.push(`=== ${searchResult.relativePath} ===`);
            outputLines.push("");

            outputLines.push(content);
            outputLines.push(""); // Empty line between files

            result.filesFound++;
            result.filesExtracted++;

            logger.debug(`Extracted: ${searchResult.relativePath}`);

            // Warn about multiple matches
            if (
              searchResult.multipleMatches &&
              searchResult.multipleMatches.length > 1
            ) {
              logger.warn(
                `Multiple files found for '${requestedFile}', using: ${searchResult.relativePath}`
              );
              logger.warn(
                `Other matches: ${searchResult.multipleMatches
                  .filter((m) => m !== searchResult.relativePath)
                  .join(", ")}`
              );
            }
          } catch (error) {
            result.missingFiles.push(requestedFile);
            logger.warn(`Failed to read file: ${requestedFile}`);
          }
        } else {
          result.missingFiles.push(requestedFile);
          logger.warn(`File not found: ${requestedFile}`);
        }
      }

      // Calculate total size
      result.totalSize = SizeCalculator.calculateTotalSize(extractedContents);

      // Write output file. Ensure the parent directory exists first: the
      // default output path lives inside the .codetree directory, which may not
      // exist yet when config reading is disabled, and a user-supplied path may
      // name a directory that has not been created.
      const finalOutput = outputLines.join("\n");
      await fs.mkdir(path.dirname(this.config.outputFile), { recursive: true });
      await fs.writeFile(this.config.outputFile, finalOutput, "utf-8");

      // Returned so the CLI can copy the extraction to the clipboard without
      // re-reading the file it was just written to.
      result.outputContent = finalOutput;

      spinner.succeed(`Extracted ${result.filesExtracted} files successfully`);
      return result;
    } catch (error) {
      spinner.fail("Failed to extract files");
      throw error;
    }
  }

  /**
   * Find a file using multiple strategies:
   * 1. Try exact path match
   * 2. Search entire project for filename
   * 3. Handle multiple matches
   */
  private async findFile(requestedFile: string): Promise<FileSearchResult> {
    // Strategy 1: Try exact path first
    const exactPath = path.resolve(this.config.rootDirectory, requestedFile);

    try {
      await fs.access(exactPath);
      const relativePath = path.relative(this.config.rootDirectory, exactPath);

      logger.debug(`Found exact match: ${relativePath}`);
      return {
        found: true,
        resolvedPath: exactPath,
        relativePath: relativePath,
      };
    } catch {
      // File not found at exact path, proceed to search
      logger.debug(
        `Exact path not found for '${requestedFile}', searching project...`
      );
    }

    // Strategy 2: Search entire project
    return await this.searchProjectForFile(requestedFile);
  }

  /**
   * Search the entire project for a file by name
   */
  private async searchProjectForFile(
    filename: string
  ): Promise<FileSearchResult> {
    try {
      // Use glob to search for the file
      const searchPattern = `**/${filename}`;

      logger.debug(`Searching with pattern: ${searchPattern}`);

      const matches = await globby(searchPattern, {
        cwd: this.config.rootDirectory,
        absolute: true,
        onlyFiles: true,
        dot: false, // Don't search hidden files
        ignore: [
          // Exclude common directories that shouldn't contain source files
          "**/node_modules/**",
          "**/.git/**",
          "**/.codetree/**",
          "**/dist/**",
          "**/build/**",
          "**/.next/**",
          "**/coverage/**",
          "**/.nyc_output/**",
        ],
      });

      if (matches.length === 0) {
        logger.debug(`No matches found for: ${filename}`);
        return { found: false };
      }

      // Convert to relative paths for better display
      const relativePaths = matches.map((match) =>
        path.relative(this.config.rootDirectory, match)
      );

      // Sort matches by preference (shorter paths first, src directories preferred)
      const sortedMatches = this.sortMatchesByPreference(relativePaths);
      const bestMatch = sortedMatches[0];
      const bestMatchAbsolute = path.resolve(
        this.config.rootDirectory,
        bestMatch
      );

      logger.debug(`Found ${matches.length} matches, using: ${bestMatch}`);

      return {
        found: true,
        resolvedPath: bestMatchAbsolute,
        relativePath: bestMatch,
        multipleMatches: sortedMatches,
      };
    } catch (error) {
      logger.debug(`Search failed for ${filename}: ${error}`);
      return { found: false };
    }
  }

  /**
   * Sort file matches by preference
   * Prefer: shorter paths, src directories, common source locations
   */
  private sortMatchesByPreference(matches: string[]): string[] {
    return matches.sort((a, b) => {
      // Preference scores (lower = better)
      const scoreA = this.calculatePathScore(a);
      const scoreB = this.calculatePathScore(b);

      if (scoreA !== scoreB) {
        return scoreA - scoreB;
      }

      // If scores are equal, prefer shorter paths
      return a.length - b.length;
    });
  }

  /**
   * Calculate preference score for a file path
   */
  private calculatePathScore(filePath: string): number {
    let score = 0;
    const lowerPath = filePath.toLowerCase();

    // Prefer common source directories
    if (lowerPath.startsWith("src/")) score -= 20;
    if (lowerPath.startsWith("lib/")) score -= 15;
    if (lowerPath.startsWith("utils/")) score -= 10;
    if (lowerPath.startsWith("components/")) score -= 10;
    if (lowerPath.startsWith("pages/")) score -= 10;

    // Penalize deep nesting
    const depth = filePath.split(path.sep).length;
    score += depth * 2;

    // Penalize test/spec directories
    if (lowerPath.includes("/test/") || lowerPath.includes("/tests/"))
      score += 30;
    if (lowerPath.includes("/spec/") || lowerPath.includes("/specs/"))
      score += 30;
    if (lowerPath.includes("/__tests__/")) score += 30;

    // Penalize backup/temp files
    if (lowerPath.includes(".bak") || lowerPath.includes(".tmp")) score += 50;
    if (lowerPath.includes("/tmp/") || lowerPath.includes("/temp/"))
      score += 40;

    return score;
  }
}
