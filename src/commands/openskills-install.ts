import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { execa } from "execa";
import { z } from "zod";

import { enforceSourcePolicy, loadGuardSkillsConfig, type GuardSkillsConfig } from "../config/load.js";
import { runProviderInstall, type SkillInstallerProvider } from "../install/skills.js";
import { GuardSkillsError } from "../lib/errors.js";
import type { ResolvedFile, ResolvedSkill } from "../resolver/github.js";
import { scanResolvedSkill } from "../scanner/scan.js";
import { calculateRiskScore } from "../scoring/engine.js";
import { evaluateGate, type AddCommandOptions } from "./add.js";

const ALLOWED_TEXT_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".py",
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".toml",
  ".ini",
  ".cfg",
]);

const SKIP_DIRS = new Set([".git", "node_modules", "dist", "build", ".next", ".turbo"]);

const cliOpenSkillsOptionsSchema = z.object({
  config: z.string().optional(),
  strict: z.boolean().optional(),
  ci: z.boolean().optional(),
  json: z.boolean().optional(),
  yes: z.boolean().optional(),
  dryRun: z.boolean().optional(),
  force: z.boolean().optional(),
  allowUnverifiable: z.boolean().optional(),
  githubTimeoutMs: z.coerce.number().int().min(1000).max(120000).optional(),
  githubRetries: z.coerce.number().int().min(0).max(6).optional(),
  githubRetryBaseMs: z.coerce.number().int().min(50).max(5000).optional(),
  maxFileBytes: z.coerce.number().int().min(4096).max(5000000).optional(),
  maxAuxFiles: z.coerce.number().int().min(1).max(200).optional(),
  maxTotalFiles: z.coerce.number().int().min(1).max(400).optional(),
});

type CliOpenSkillsOptions = z.infer<typeof cliOpenSkillsOptionsSchema>;

type OpenSkillsOptions = Omit<AddCommandOptions, "skill">;

const DEFAULT_OPTIONS: OpenSkillsOptions = {
  strict: false,
  ci: false,
  json: false,
  yes: false,
  dryRun: false,
  force: false,
  allowUnverifiable: false,
  githubTimeoutMs: 15000,
  githubRetries: 2,
  githubRetryBaseMs: 300,
  maxFileBytes: 250000,
  maxAuxFiles: 40,
  maxTotalFiles: 120,
};

function resolveEffectiveOptions(
  cliOptions: CliOpenSkillsOptions,
  config: GuardSkillsConfig,
): OpenSkillsOptions {
  const defaults = config.defaults ?? {};
  const resolver = config.resolver ?? {};

  return {
    strict: cliOptions.strict ?? defaults.strict ?? DEFAULT_OPTIONS.strict,
    ci: cliOptions.ci ?? defaults.ci ?? DEFAULT_OPTIONS.ci,
    json: cliOptions.json ?? defaults.json ?? DEFAULT_OPTIONS.json,
    yes: cliOptions.yes ?? defaults.yes ?? DEFAULT_OPTIONS.yes,
    dryRun: cliOptions.dryRun ?? defaults.dryRun ?? DEFAULT_OPTIONS.dryRun,
    force: cliOptions.force ?? defaults.force ?? DEFAULT_OPTIONS.force,
    allowUnverifiable:
      cliOptions.allowUnverifiable ??
      defaults.allowUnverifiable ??
      DEFAULT_OPTIONS.allowUnverifiable,
    githubTimeoutMs:
      cliOptions.githubTimeoutMs ??
      resolver.githubTimeoutMs ??
      DEFAULT_OPTIONS.githubTimeoutMs,
    githubRetries:
      cliOptions.githubRetries ??
      resolver.githubRetries ??
      DEFAULT_OPTIONS.githubRetries,
    githubRetryBaseMs:
      cliOptions.githubRetryBaseMs ??
      resolver.githubRetryBaseMs ??
      DEFAULT_OPTIONS.githubRetryBaseMs,
    maxFileBytes:
      cliOptions.maxFileBytes ??
      resolver.maxFileBytes ??
      DEFAULT_OPTIONS.maxFileBytes,
    maxAuxFiles:
      cliOptions.maxAuxFiles ??
      resolver.maxAuxFiles ??
      DEFAULT_OPTIONS.maxAuxFiles,
    maxTotalFiles:
      cliOptions.maxTotalFiles ??
      resolver.maxTotalFiles ??
      DEFAULT_OPTIONS.maxTotalFiles,
  };
}

function enforceOptionPolicy(options: OpenSkillsOptions, config: GuardSkillsConfig): void {
  const policy = config.policy;
  if (!policy) {
    return;
  }

  if (options.force && policy.allowForce === false) {
    throw new GuardSkillsError(
      "POLICY_VIOLATION",
      "Policy blocks --force overrides (allowForce=false).",
    );
  }

  if (options.allowUnverifiable && policy.allowUnverifiableOverride === false) {
    throw new GuardSkillsError(
      "POLICY_VIOLATION",
      "Policy blocks --allow-unverifiable overrides (allowUnverifiableOverride=false).",
    );
  }
}

function findSkillDirs(rootDir: string): string[] {
  const found = new Set<string>();
  const stack: Array<{ dir: string; depth: number }> = [{ dir: rootDir, depth: 0 }];

  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    const skillFile = path.join(current.dir, "SKILL.md");
    if (fs.existsSync(skillFile) && fs.statSync(skillFile).isFile()) {
      found.add(current.dir);
      continue;
    }

    if (current.depth >= 8) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current.dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (SKIP_DIRS.has(entry.name)) {
        continue;
      }
      stack.push({ dir: path.join(current.dir, entry.name), depth: current.depth + 1 });
    }
  }

  return [...found].sort();
}

function collectLocalFiles(
  skillDir: string,
  options: Pick<OpenSkillsOptions, "maxFileBytes" | "maxTotalFiles">,
): { files: ResolvedFile[]; unverifiableReasons: string[] } {
  const files: ResolvedFile[] = [];
  const unverifiableReasons: string[] = [];
  const stack: string[] = [skillDir];

  while (stack.length > 0) {
    const currentDir = stack.pop();
    if (!currentDir) {
      continue;
    }

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      unverifiableReasons.push(`Cannot read directory: ${currentDir}`);
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          stack.push(fullPath);
        }
        continue;
      }

      if (!entry.isFile()) {
        continue;
      }

      const relativePath = path.relative(skillDir, fullPath).replace(/\\/g, "/");
      const ext = path.extname(relativePath).toLowerCase();
      const isSkillFile = path.basename(relativePath).toLowerCase() === "skill.md";
      if (!isSkillFile && !ALLOWED_TEXT_EXTENSIONS.has(ext)) {
        continue;
      }

      if (files.length >= options.maxTotalFiles) {
        unverifiableReasons.push(
          `Reached maxTotalFiles=${options.maxTotalFiles}. Remaining files were not scanned.`,
        );
        return { files, unverifiableReasons };
      }

      let sizeBytes = 0;
      try {
        sizeBytes = fs.statSync(fullPath).size;
      } catch {
        unverifiableReasons.push(`Cannot stat file: ${relativePath}`);
        continue;
      }

      if (sizeBytes > options.maxFileBytes) {
        unverifiableReasons.push(
          `Skipped oversized file (${sizeBytes} bytes > ${options.maxFileBytes}): ${relativePath}`,
        );
        continue;
      }

      try {
        files.push({
          path: relativePath,
          content: fs.readFileSync(fullPath, "utf8"),
        });
      } catch {
        unverifiableReasons.push(`Cannot read text content: ${relativePath}`);
      }
    }
  }

  return { files, unverifiableReasons };
}

function resolveSource(source: string): { kind: "local"; path: string } | { kind: "git"; cloneUrl: string } {
  const maybePath = path.resolve(source);
  if (fs.existsSync(maybePath)) {
    return { kind: "local", path: maybePath };
  }

  const shorthand = source.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
  if (shorthand) {
    return { kind: "git", cloneUrl: `https://github.com/${shorthand[1]}/${shorthand[2]}.git` };
  }

  try {
    const parsed = new URL(source);
    if (parsed.hostname === "github.com" || parsed.hostname === "www.github.com") {
      return { kind: "git", cloneUrl: source.endsWith(".git") ? source : `${source}.git` };
    }
  } catch {
    // no-op
  }

  return { kind: "git", cloneUrl: source };
}

function aggregateLevel(levels: Array<"SAFE" | "WARNING" | "UNSAFE" | "CRITICAL" | "UNVERIFIABLE">) {
  if (levels.includes("UNVERIFIABLE")) {
    return "UNVERIFIABLE" as const;
  }
  if (levels.includes("CRITICAL")) {
    return "CRITICAL" as const;
  }
  if (levels.includes("UNSAFE")) {
    return "UNSAFE" as const;
  }
  if (levels.includes("WARNING")) {
    return "WARNING" as const;
  }
  return "SAFE" as const;
}

export async function runInteractiveInstallCommand(
  provider: SkillInstallerProvider,
  source: string,
  skillName: string | undefined,
  rawOptions: unknown,
): Promise<number> {
  if (provider !== "openskills" && provider !== "skills" && provider !== "skillkit") {
    throw new GuardSkillsError(
      "INVALID_OPTIONS",
      `Interactive install flow is not supported for provider '${provider}'.`,
    );
  }

  const cliOptions = cliOpenSkillsOptionsSchema.parse(rawOptions);
  const loadedConfig = loadGuardSkillsConfig(cliOptions.config);
  const options = resolveEffectiveOptions(cliOptions, loadedConfig.config);

  enforceSourcePolicy(source, loadedConfig.config.policy);
  enforceOptionPolicy(options, loadedConfig.config);

  const resolvedSource = resolveSource(source);
  const tempDir = resolvedSource.kind === "git"
    ? fs.mkdtempSync(path.join(os.tmpdir(), `guardskills-${provider}-`))
    : null;
  const scanRoot = resolvedSource.kind === "git" ? tempDir ?? "" : resolvedSource.path;

  try {
    if (resolvedSource.kind === "git") {
      try {
        await execa("git", ["clone", "--depth", "1", resolvedSource.cloneUrl, scanRoot], {
          timeout: options.githubTimeoutMs,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new GuardSkillsError(
          "GITHUB_UNKNOWN",
          `Failed to clone source '${source}' for ${provider} scan: ${message}`,
          { cause: error },
        );
      }
    }

    const discovered = findSkillDirs(scanRoot);
    if (discovered.length === 0) {
      throw new GuardSkillsError("SKILL_NOT_FOUND", "No SKILL.md files were found in the source.");
    }

    const selectedDirs = skillName
      ? discovered.filter((dir) => path.basename(dir).toLowerCase() === skillName.toLowerCase())
      : discovered;

    if (selectedDirs.length === 0) {
      throw new GuardSkillsError(
        "SKILL_NOT_FOUND",
        `Skill '${skillName}' was not found. Available: ${discovered.map((dir) => path.basename(dir)).join(", ")}`,
      );
    }

    const levels: Array<"SAFE" | "WARNING" | "UNSAFE" | "CRITICAL" | "UNVERIFIABLE"> = [];
    const summaries: Array<{ skill: string; level: string; riskScore: number | null }> = [];

    for (const skillDir of selectedDirs) {
      const skill = path.basename(skillDir);
      const { files, unverifiableReasons } = collectLocalFiles(skillDir, options);
      const resolvedSkill: ResolvedSkill = {
        source: `local:${skillDir}`,
        owner: "local",
        repo: "local",
        defaultBranch: "local",
        commitSha: "local",
        skillName: skill,
        skillDir: skillDir.replace(/\\/g, "/"),
        skillFilePath: "SKILL.md",
        files,
        unverifiableReasons,
      };

      const scan = scanResolvedSkill(resolvedSkill);
      const decision = calculateRiskScore(scan.findings, {
        strict: options.strict,
        trustCredits: 0,
        hasUnverifiableContent: scan.hasUnverifiableContent,
      });

      levels.push(decision.level);
      summaries.push({ skill, level: decision.level, riskScore: decision.riskScore });
    }

    const overall = aggregateLevel(levels);
    const gate = evaluateGate(overall, { ...options, skill: skillName ?? "ALL_SKILLS" });
    const label = provider === "openskills"
      ? "OpenSkills"
      : provider === "skillkit"
      ? "skillkit"
      : "skills.sh";
    const note = `${gate.gateNote} ${label} flow: ${skillName ? "single skill" : "interactive skill selection"}.`;

    if (options.json) {
      console.log(
        JSON.stringify(
          {
            command: `guardskills ${provider} ${provider === "skills" ? "add" : "install"}`,
            source,
            skill: skillName ?? null,
            scannedSkills: summaries.length,
            overallLevel: overall,
            skills: summaries,
            note,
          },
          null,
          2,
        ),
      );
    } else {
      console.log(`Command: guardskills ${provider} ${provider === "skills" ? "add" : "install"}`);
      console.log(`Source: ${source}`);
      console.log(`Selection: ${skillName ?? "interactive (all scanned)"}`);
      console.log(`Scanned Skills: ${summaries.length}`);
      console.log(`Decision: ${overall}`);
      console.log("Per-skill results:");
      for (const summary of summaries) {
        const score = summary.riskScore === null ? "n/a" : summary.riskScore.toFixed(1);
        console.log(`- ${summary.skill}: ${summary.level} (risk ${score})`);
      }
      console.log(`Note: ${note}`);
    }

    if (!gate.canInstall) {
      return gate.exitCode;
    }

    if (options.dryRun || options.ci) {
      return 0;
    }

    return runProviderInstall(provider, source, skillName);
  } finally {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  }
}
