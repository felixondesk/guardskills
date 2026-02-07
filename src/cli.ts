import { Command } from "commander";

import { runAddCommand } from "./commands/add.js";
import { isGuardSkillsError } from "./lib/errors.js";

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("guardskills")
    .description("Security wrapper around skills add")
    .version("0.1.0-alpha.0");

  program
    .command("add")
    .description("Scan a skill source and conditionally install it via skills CLI")
    .argument("<repo>", "GitHub repository URL or owner/repo")
    .requiredOption("--skill <name>", "Skill name to install")
    .option("--config <path>", "Path to guardskills.config.json")
    .option("--strict", "Use stricter risk thresholds")
    .option("--ci", "Deterministic CI mode: scan + gate only, no install handoff")
    .option("--json", "Output machine-readable JSON")
    .option("--yes", "Auto-confirm warnings")
    .option("--dry-run", "Scan only, do not install")
    .option("--force", "Override UNSAFE outcome")
    .option("--allow-unverifiable", "Override UNVERIFIABLE outcome")
    .option("--github-timeout-ms <ms>", "GitHub API request timeout in milliseconds")
    .option("--github-retries <count>", "Retry count for retryable GitHub errors")
    .option("--github-retry-base-ms <ms>", "Base backoff delay for GitHub retries")
    .option("--max-file-bytes <bytes>", "Max file size to scan")
    .option("--max-aux-files <count>", "Max auxiliary files from scripts/src folders")
    .option("--max-total-files <count>", "Max total resolved files to scan")
    .action(async (repo: string, options: Record<string, unknown>) => {
      const code = await runAddCommand(repo, options);
      process.exitCode = code;
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  if (isGuardSkillsError(error)) {
    const statusText = error.status !== undefined ? ` (status ${error.status})` : "";
    console.error(`guardskills error [${error.code}]${statusText}: ${error.message}`);
  } else {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`guardskills error: ${message}`);
  }
  process.exitCode = 30;
});
