import fs from "fs/promises";

export interface SizeInfo {
  bytes: number;
  formattedSize: string;
  tokens: number;
}

export class SizeCalculator {
  /**
   * Calculate size and token count for content
   */
  static calculateContentSize(content: string): SizeInfo {
    const bytes = Buffer.byteLength(content, "utf-8");
    const tokens = this.estimateTokenCount(content);

    return {
      bytes,
      formattedSize: this.formatBytes(bytes),
      tokens,
    };
  }

  /**
   * Calculate size and token count for a file
   */
  static async calculateFileSize(filePath: string): Promise<SizeInfo> {
    const stats = await fs.stat(filePath);
    const content = await fs.readFile(filePath, "utf-8");
    const tokens = this.estimateTokenCount(content);

    return {
      bytes: stats.size,
      formattedSize: this.formatBytes(stats.size),
      tokens,
    };
  }

  /**
   * Calculate total size and tokens from multiple sources
   */
  static calculateTotalSize(contents: string[]): SizeInfo {
    const totalContent = contents.join("");
    return this.calculateContentSize(totalContent);
  }

  /**
   * Estimate token count using a simple heuristic
   * This is an approximation - actual tokenization would depend on the specific tokenizer
   */
  private static estimateTokenCount(content: string): number {
    // Simple heuristic: ~4 characters per token for code/text
    // This is based on common tokenizer behavior (GPT-style)
    // For more accuracy, you could integrate an actual tokenizer library
    const chars = content.length;
    return Math.ceil(chars / 4);
  }

  /**
   * Format bytes into human-readable format
   */
  private static formatBytes(bytes: number): string {
    if (bytes === 0) return "0 B";

    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  }
}
