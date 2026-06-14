import { SizeInfo } from "../utils/size_calculator";

export interface GenerationResult {
  outputFile: string;
  originalContent: SizeInfo;
  generatedOutput: SizeInfo;
  outputFormat: "compact" | "raw";
  filesProcessed: number;
  outputContent: string;
}
