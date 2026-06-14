/**
 * Pre-written instruction prompts that tell an LLM how to consume a CodeTree
 * snapshot, tailored to the snapshot's output format.
 *
 * These builders return instruction text only; they never embed a snapshot. The
 * intended workflow is that the user copies the prompt, pastes it into an LLM,
 * and then pastes the snapshot produced by `codetree tree` or `codetree code`
 * after it. Because the compact and raw formats look completely different, each
 * builder selects format-specific wording so the model is told how to read the
 * exact artifact it is about to receive.
 *
 * The strings are assembled from arrays of lines joined with newlines, matching
 * the style the output generators use elsewhere in the project. Keeping the text
 * in ordinary double-quoted strings (rather than template literals) also lets
 * the embedded fenced code block, which uses backticks, appear verbatim without
 * any escaping.
 */

/**
 * Describes the compact format's layout so the model knows how to interpret the
 * header, the symbol legend, and the symbol notation. Shared by the tree and
 * code prompts, which differ only in the task wrapped around this description.
 */
const COMPACT_FORMAT_DESCRIPTION: string[] = [
  "The codebasse snapshot is a compact structural index, not full source code. Its layout is:",
  "",
  "- The first line is a project header: the project name followed by the total file and line counts.",
  "- The second line is the language distribution, where each entry is an abbreviated language and its file count (for example, `ts:15 js:1`).",
  "- A legend then defines the symbol kinds: fn (functions), cls (classes, interfaces, structs, enums, and other types), imp (imports), exp (exports), var (variables), and mod (modules or namespaces).",
  "- The remainder is an indented directory tree. Directories end with a slash, and each file is listed alongside the symbols found in it.",
  "- A class and its methods are written together as `cls:ClassName(method1,method2)`. A standalone function is written as `fn:functionName`. Other kinds follow the same `kind:name` form.",
  "",
  "Treat the symbols as a heuristic outline derived from the syntax tree. They show what each file contains and roughly where, but they are not exhaustive and do not include implementation bodies.",
];

/**
 * Describes the raw format's layout. The raw snapshot contains complete file
 * contents, so the description focuses on the delimiter convention rather than
 * on any symbol notation.
 */
const RAW_FORMAT_DESCRIPTION: string[] = [
  "This codebase snapshot contains the complete source of each file. Its layout is:",
  "",
  "- The first line is a project header: the project name followed by the total file and line counts.",
  "- The second line is the language distribution, where each entry is an abbreviated language and its file count (for example, `ts:15 js:1`).",
  "- Each file then appears as a `=== relative/path ===` delimiter line, followed by the full contents of that file, with a blank line separating files.",
  "",
  "Because the full contents are present, you can read any file directly rather than asking for it.",
];

/**
 * A reusable description of the file-request contract used by the code prompts.
 *
 * The model must answer with only a JSON array of relative paths so the result
 * can be pasted verbatim into the `filesToExtract` field of
 * `.codetree/config.json`, after which `codetree code` retrieves exactly those
 * files. The instruction is deliberately strict about emitting nothing but the
 * array, since any surrounding prose would break that copy-into-config step.
 */
const FILE_REQUEST_CONTRACT: string[] = [
  "When you have decided which files you need, respond with ONLY a JSON array of their relative paths and nothing else: no prose, no explanation, and no surrounding text. Use the paths exactly as they appear in the snapshot. Wrap the array in a fenced code block like this:",
  "",
  "```json",
  '["src/a.ts", "src/b.ts"]',
  "```",
];

/**
 * Builds the prompt for the `tree` command, which teaches an LLM how to read a
 * snapshot and use it as a map of the codebase.
 *
 * The compact variant frames the snapshot as a structural index and tells the
 * model to ask for individual files when it needs their full contents. The raw
 * variant, where complete source is already present, instead points the model
 * at answering directly from that source.
 */
export function buildTreePrompt(format: "compact" | "raw"): string {
  const lines: string[] = [];

  if (format === "compact") {
    lines.push(...COMPACT_FORMAT_DESCRIPTION);
    lines.push("");
    lines.push(
      "Use this index as a map of the codebase: rely on it to understand the project's structure, locate relevant files, and reason about where functionality lives. When you need the full contents of a file that the index only summarizes, ask for it by its relative path."
    );
  } else {
    lines.push(...RAW_FORMAT_DESCRIPTION);
    lines.push("");
    lines.push(
      "Use the source to understand the project's structure and to answer questions about the codebase, referring to specific files and lines where that helps."
    );
  }

  return lines.join("\n");
}

/**
 * Builds the prompt for the `code` command, which instructs an LLM to identify
 * the files it needs and return them as a JSON array suitable for the
 * `filesToExtract` workflow.
 *
 * Both variants end with the same file-request contract so the downstream
 * behaviour is identical regardless of format. They differ only in how they
 * frame the selection: the compact variant must choose files it cannot yet see
 * in full, whereas the raw variant narrows an already-complete set down to the
 * files that actually matter for the next step.
 */
export function buildCodePrompt(): string {
  const lines: string[] = [];

  lines.push(...FILE_REQUEST_CONTRACT);

  return lines.join("\n");
}
