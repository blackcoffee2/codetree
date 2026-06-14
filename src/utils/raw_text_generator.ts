import { ParsedFile, AnalysisStats } from "../types";
import path from "path";

export class RawTextGenerator {
  static generate(parsedFiles: ParsedFile[], rootDirectory: string): string {
    const stats = this.generateStats(parsedFiles);
    const projectName = path.basename(rootDirectory);

    const lines: string[] = [];

    // Project header with basic stats
    lines.push(
      `# ${projectName} (${stats.totalFiles} files, ${this.formatLines(
        stats.totalLines
      )} lines)`
    );

    // Language distribution
    const langStats = Object.entries(stats.languageDistribution)
      .map(([lang, count]) => `${this.abbreviateLanguage(lang)}:${count}`)
      .join(" ");
    lines.push(langStats);
    lines.push(""); // Empty line for readability

    // Sort files by path for consistent output
    const sortedFiles = [...parsedFiles].sort((a, b) =>
      a.fileInfo.relativePath.localeCompare(b.fileInfo.relativePath)
    );

    // Generate raw file content
    for (const file of sortedFiles) {
      lines.push(`=== ${file.fileInfo.relativePath} ===`);
      lines.push(file.content);
      lines.push(""); // Empty line between files
    }

    return lines.join("\n");
  }

  private static generateStats(parsedFiles: ParsedFile[]): AnalysisStats {
    const stats: AnalysisStats = {
      totalFiles: parsedFiles.length,
      totalLines: 0,
      totalSize: 0,
      languageDistribution: {},
      largestFiles: [], // Not needed for raw format
    };

    parsedFiles.forEach((file) => {
      stats.totalLines += file.lineCount;
      stats.totalSize += file.fileInfo.size;

      // Files without an associated grammar have a null language; group them
      // under a generic label so they still appear in the distribution.
      const lang = file.fileInfo.language ?? "text";
      stats.languageDistribution[lang] =
        (stats.languageDistribution[lang] || 0) + 1;
    });

    return stats;
  }

  private static abbreviateLanguage(language: string): string {
    const abbreviations: Record<string, string> = {
      javascript: "js",
      typescript: "ts",
      python: "py",
      java: "java",
      kotlin: "kt",
      go: "go",
      rust: "rs",
      cpp: "cpp",
      c: "c",
      dart: "dart",
      swift: "swift",
    };

    return abbreviations[language] || language;
  }

  private static formatLines(lines: number): string {
    if (lines < 1000) return lines.toString();
    if (lines < 1000000) return `${(lines / 1000).toFixed(1)}k`;
    return `${(lines / 1000000).toFixed(1)}m`;
  }
}
