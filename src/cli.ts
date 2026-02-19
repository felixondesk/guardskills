import { Command } from "commander";

import { runAddCommand } from "./commands/add.js";
import { runInteractiveInstallCommand } from "./commands/openskills-install.js";
import { runScanClawHubCommand } from "./commands/scan-clawhub.js";
import { runScanLocalCommand } from "./commands/scan-local.js";
import { GuardSkillsError, isGuardSkillsError } from "./lib/errors.js";

function withCommonAddOptions(command: Command, requireSkill: boolean): Command {
  const configured = command
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
    .option("--max-total-files <count>", "Max total resolved files to scan");

  return requireSkill
    ? configured.requiredOption("--skill <name>", "Skill name to install")
    : configured.option("--skill <name>", "Skill name to install");
}

async function main(): Promise<void> {
  const program = new Command();

  program
    .name("guardskills")
    .description("Security wrapper around skill installation CLIs")
    .version("1.1.0");

  const legacyAdd = program
    .command("add")
    .description("Scan a skill source and conditionally install it via skills CLI")
    .argument("<repo>", "GitHub repository URL or owner/repo");

  withCommonAddOptions(legacyAdd, true).action(
    async (repo: string, options: Record<string, unknown>) => {
      const code = await runAddCommand(repo, options);
      process.exitCode = code;
    },
  );

  const skills = program
    .command("skills")
    .description("Guarded wrapper for skills.sh install commands");

  withCommonAddOptions(
    skills
      .command("add")
      .description("Scan a skill source and conditionally install it via skills CLI")
      .argument("<repo>", "GitHub repository URL or owner/repo"),
    false,
  ).action(async (repo: string, options: Record<string, unknown>) => {
    const resolvedSkill = typeof options.skill === "string" ? options.skill : undefined;
    const code = resolvedSkill
      ? await runAddCommand(repo, options, {
        provider: "skills",
        commandName: "guardskills skills add",
      })
      : await runInteractiveInstallCommand("skills", repo, undefined, options);
    process.exitCode = code;
  });

  const playbooks = program
    .command("playbooks")
    .description("Guarded wrapper for Playbooks install commands");

  withCommonAddOptions(
    playbooks
      .command("add")
      .description("Scan a skill source and conditionally install it via Playbooks CLI")
      .argument("<resource>", "Playbooks resource type (must be 'skill')")
      .argument("<repo>", "GitHub repository URL or owner/repo"),
    true,
  ).action(async (resource: string, repo: string, options: Record<string, unknown>) => {
    if (resource !== "skill") {
      throw new GuardSkillsError(
        "INVALID_OPTIONS",
        `Unsupported playbooks resource '${resource}'. Use: guardskills playbooks add skill <repo> --skill <name>`,
      );
    }

    const code = await runAddCommand(repo, options, {
      provider: "playbooks",
      commandName: "guardskills playbooks add skill",
    });
    process.exitCode = code;
  });

  const openskills = program
    .command("openskills")
    .description("Guarded wrapper for OpenSkills install commands");

  withCommonAddOptions(
    openskills
      .command("install")
      .description("Scan a skill source and conditionally install it via OpenSkills CLI")
      .argument("<repo>", "GitHub repository URL or owner/repo")
      .argument("[skill]", "Skill name to install"),
    false,
  ).action(async (repo: string, skill: string | undefined, options: Record<string, unknown>) => {
    const resolvedSkill = skill ?? (typeof options.skill === "string" ? options.skill : undefined);
    const code = await runInteractiveInstallCommand("openskills", repo, resolvedSkill, options);
    process.exitCode = code;
  });

  const skillkit = program
    .command("skillkit")
    .description("Guarded wrapper for skillkit install commands");

  withCommonAddOptions(
    skillkit
      .command("install")
      .description("Scan a skill source and conditionally install it via skillkit CLI")
      .argument("<repo>", "GitHub repository URL or owner/repo")
      .argument("[skill]", "Skill name to install"),
    false,
  ).action(async (repo: string, skill: string | undefined, options: Record<string, unknown>) => {
    const resolvedSkill = skill ?? (typeof options.skill === "string" ? options.skill : undefined);
    const code = await runInteractiveInstallCommand("skillkit", repo, resolvedSkill, options);
    process.exitCode = code;
  });

  program
    .command("scan-local")
    .description("Scan a local skill folder and print a risk decision")
    .argument("<path>", "Local folder path (or SKILL.md file path)")
    .option("--skill <name>", "Skill directory name when path contains multiple skills")
    .option("--config <path>", "Path to guardskills.config.json")
    .option("--strict", "Use stricter risk thresholds")
    .option("--json", "Output machine-readable JSON")
    .option("--max-file-bytes <bytes>", "Max file size to scan")
    .option("--max-total-files <count>", "Max total files to scan")
    .action(async (repo: string, options: Record<string, unknown>) => {
      const code = await runScanLocalCommand(repo, options);
      process.exitCode = code;
    });

  program
    .command("scan-clawhub")
    .description("Scan a ClawHub skill package and print a risk decision")
    .argument("<identifier>", "ClawHub package identifier")
    .option("--skill <name>", "Override skill folder name to resolve in source repository")
    .option("--version <version>", "Preferred package version/tag")
    .option("--clawhub-registry <url>", "ClawHub registry base URL")
    .option("--config <path>", "Path to guardskills.config.json")
    .option("--strict", "Use stricter risk thresholds")
    .option("--json", "Output machine-readable JSON")
    .option("--github-timeout-ms <ms>", "Upstream resolver request timeout in milliseconds")
    .option("--github-retries <count>", "Retry count for retryable upstream errors")
    .option("--github-retry-base-ms <ms>", "Base backoff delay for upstream retries")
    .option("--max-file-bytes <bytes>", "Max file size to scan")
    .option("--max-aux-files <count>", "Max auxiliary files from scripts/src folders")
    .option("--max-total-files <count>", "Max total resolved files to scan")
    .action(async (identifier: string, options: Record<string, unknown>) => {
      const code = await runScanClawHubCommand(identifier, options);
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
