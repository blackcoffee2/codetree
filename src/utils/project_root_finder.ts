import fs from "fs";
import path from "path";

export class ProjectRootFinder {
  /**
   * Validates that the CLI is being run from a project root directory
   * A project root must contain .gitignore
   */
  static validateProjectRoot(currentDir: string = process.cwd()): string {
    const gitignorePath = path.join(currentDir, ".gitignore");

    if (!fs.existsSync(gitignorePath)) {
      throw new Error(
        `CLI must be run from a project root directory. ` +
          `Expected to find .gitignore in ${currentDir}`
      );
    }

    return currentDir;
  }

  /**
   * Get project root and config paths for a given directory
   * Enforces that the CLI is run from project root (unless --no-gitignore is used)
   */
  static getConfigPaths(
    targetDirectory: string,
    requireGitignore: boolean = true
  ): {
    projectRoot: string;
    targetDirectory: string;
  } {
    const currentWorkingDir = process.cwd();
    const resolvedTarget = path.resolve(targetDirectory);

    // Only validate project root if gitignore is required
    let projectRoot = currentWorkingDir;
    if (requireGitignore) {
      projectRoot = this.validateProjectRoot(currentWorkingDir);
    }

    return {
      projectRoot,
      targetDirectory: resolvedTarget,
    };
  }
}
