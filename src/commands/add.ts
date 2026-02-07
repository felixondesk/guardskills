import { z } from "zod";

import { enforceSourcePolicy, loadGuardSkillsConfig, type GuardSkillsConfig } from "../config/load.js";
import { runSkillsInstall } from "../install/skills.js";
import { GuardSkillsError } from "../lib/errors.js";
import { printHumanReport, printJsonReport } from "../lib/output.js";
import { resolveSkillFromGitHub } from "../resolver/github.js";
import { scanResolvedSkill } from "../scanner/scan.js";
import { calculateRiskScore } from "../scoring/engine.js";

const cliAddOptionsSchema = z.object({
  skill: z.string().min(1),
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

const effectiveAddOptionsSchema = z.object({
  skill: z.string().min(1),
  strict: z.boolean(),
  ci: z.boolean(),
  json: z.boolean(),
  yes: z.boolean(),
  dryRun: z.boolean(),
  force: z.boolean(),
  allowUnverifiable: z.boolean(),
  githubTimeoutMs: z.number().int().min(1000).max(120000),
  githubRetries: z.number().int().min(0).max(6),
  githubRetryBaseMs: z.number().int().min(50).max(5000),
  maxFileBytes: z.number().int().min(4096).max(5000000),
  maxAuxFiles: z.number().int().min(1).max(200),
  maxTotalFiles: z.number().int().min(1).max(400),
});

const DEFAULT_OPTIONS: z.infer<typeof effectiveAddOptionsSchema> = {
  skill: "",
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

type CliAddCommandOptions = z.infer<typeof cliAddOptionsSchema>;
export type AddCommandOptions = z.infer<typeof effectiveAddOptionsSchema>;

function resolveEffectiveAddOptions(
  cliOptions: CliAddCommandOptions,
  config: GuardSkillsConfig,
): AddCommandOptions {
  const defaults = config.defaults ?? {};
  const resolver = config.resolver ?? {};

  return effectiveAddOptionsSchema.parse({
    skill: cliOptions.skill,
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
  });
}

function enforceOptionPolicy(options: AddCommandOptions, config: GuardSkillsConfig): void {
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

export function evaluateGate(
  level: "SAFE" | "WARNING" | "UNSAFE" | "CRITICAL" | "UNVERIFIABLE",
  options: AddCommandOptions,
): { exitCode: number; canInstall: boolean; gateNote: string } {
  if (level === "UNVERIFIABLE") {
    if (options.allowUnverifiable) {
      return {
        exitCode: 0,
        canInstall: true,
        gateNote: "UNVERIFIABLE accepted via --allow-unverifiable.",
      };
    }

    return {
      exitCode: 20,
      canInstall: false,
      gateNote: "Blocked: scan result is UNVERIFIABLE. Use --allow-unverifiable to override.",
    };
  }

  if (level === "CRITICAL") {
    return {
      exitCode: 20,
      canInstall: false,
      gateNote: "Blocked: CRITICAL risk.",
    };
  }

  if (level === "UNSAFE") {
    if (options.force) {
      return {
        exitCode: 0,
        canInstall: true,
        gateNote: "UNSAFE accepted via --force.",
      };
    }

    return {
      exitCode: 20,
      canInstall: false,
      gateNote: "Blocked: UNSAFE risk. Use --force to override.",
    };
  }

  if (level === "WARNING" && !options.yes) {
    return {
      exitCode: 10,
      canInstall: false,
      gateNote: "WARNING requires confirmation. Re-run with --yes.",
    };
  }

  return {
    exitCode: 0,
    canInstall: true,
    gateNote: level === "WARNING" ? "WARNING accepted via --yes." : "SAFE to proceed.",
  };
}

export async function runAddCommand(repo: string, rawOptions: unknown): Promise<number> {
  const cliOptions = cliAddOptionsSchema.parse(rawOptions);
  const loadedConfig = loadGuardSkillsConfig(cliOptions.config);

  const options = resolveEffectiveAddOptions(cliOptions, loadedConfig.config);

  enforceSourcePolicy(repo, loadedConfig.config.policy);
  enforceOptionPolicy(options, loadedConfig.config);

  const resolved = await resolveSkillFromGitHub(repo, options.skill, {
    requestTimeoutMs: options.githubTimeoutMs,
    retries: options.githubRetries,
    retryBaseDelayMs: options.githubRetryBaseMs,
    maxFileSizeBytes: options.maxFileBytes,
    maxAuxFiles: options.maxAuxFiles,
    maxTotalFiles: options.maxTotalFiles,
  });

  const scan = scanResolvedSkill(resolved);

  const decision = calculateRiskScore(scan.findings, {
    strict: options.strict,
    trustCredits: 0,
    hasUnverifiableContent: scan.hasUnverifiableContent,
  });

  const gate = evaluateGate(decision.level, options);

  const configNote = loadedConfig.path ? ` Config: ${loadedConfig.path}` : "";
  const report = {
    command: "guardskills add",
    repo,
    skill: options.skill,
    strict: options.strict,
    ci: options.ci,
    dryRun: options.dryRun,
    configPath: loadedConfig.path ?? undefined,
    decision,
    scanFiles: resolved.files.map((file) => file.path),
    skillDir: resolved.skillDir,
    commitSha: resolved.commitSha,
    unverifiableReasons: scan.unverifiableReasons,
    note: `${options.ci ? `${gate.gateNote} CI mode: install skipped.` : gate.gateNote}${configNote}`,
  };

  if (options.json) {
    printJsonReport(report);
  } else {
    printHumanReport(report);
  }

  if (!gate.canInstall) {
    return gate.exitCode;
  }

  if (options.dryRun || options.ci) {
    return 0;
  }

  return runSkillsInstall(repo, options.skill);
}