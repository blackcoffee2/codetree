import { ConfigReader } from "./config_reader";

/**
 * Resolves the output format that the prompt commands should describe.
 *
 * The format is taken solely from the on-disk configuration rather than from any
 * command-line flag or by inspecting a previously generated snapshot. The lookup
 * reads `.codetree/config.json` at the given project root through ConfigReader,
 * which already validates the value and coerces anything other than "compact" or
 * "raw" back to the default. When the key is absent, or no config file exists at
 * all, the built-in default is used, so a project that has never been configured
 * still resolves to a sensible format.
 *
 * Unlike the `tree` and `code` commands, this deliberately performs no first-run
 * setup: it never calls ConfigReader.ensureConfig and so never creates a config
 * file or touches .gitignore. Producing a prompt is a read-only action and must
 * not write anything into the user's project; a missing configuration simply
 * falls back to the default.
 */
export function resolveOutputFormat(projectRoot: string): "compact" | "raw" {
  const config = ConfigReader.readConfig(projectRoot);
  return config.outputFormat ?? ConfigReader.getDefaultConfig().outputFormat;
}
