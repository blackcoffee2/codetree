import chalk from "chalk";

class Logger {
  private _verbose: boolean = false;

  setVerbose(verbose: boolean): void {
    this._verbose = verbose;
  }

  info(message: string, ...args: any[]): void {
    console.log(chalk.blue("ℹ"), message, ...args);
  }

  success(message: string, ...args: any[]): void {
    console.log(chalk.green("✓"), message, ...args);
  }

  warn(message: string, ...args: any[]): void {
    console.warn(chalk.yellow("⚠"), message, ...args);
  }

  error(message: string, ...args: any[]): void {
    console.error(chalk.red("✗"), message, ...args);
  }

  debug(message: string, ...args: any[]): void {
    if (this._verbose) {
      console.log(chalk.gray("🐛"), message, ...args);
    }
  }

  verbose(message: string, ...args: any[]): void {
    if (this._verbose) {
      console.log(chalk.gray("→"), message, ...args);
    }
  }
}

export const logger = new Logger();
