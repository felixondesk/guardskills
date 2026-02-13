import { z } from "zod";

import { loadGuardSkillsConfig, type GuardSkillsConfig } from "../config/load.js";
import { printHumanClawHubReport, printJsonClawHubReport } from "../lib/output.js";
import { resolveSkillFromClawHub } from "../resolver/clawhub.js";
import { scanResolvedSkill } from "../scanner/scan.js";
import { calculateRiskScore } from "../scoring/engine.js";
import type { ScoringResult } from "../scoring/types.js";

const cliScanClawHubOptionsSchema = z.object({
  config: z.string().optional(),
  strict: z.boolean().optional(),
  json: z.boolean().optional(),
  skill: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  clawhubRegistry: z.string().min(1).optional(),
  githubTimeoutMs: z.coerce.number().int().min(1000).max(120000).optional(),
  githubRetries: z.coerce.number().int().min(0).max(6).optional(),
  githubRetryBaseMs: z.coerce.number().int().min(50).max(5000).optional(),
  maxFileBytes: z.coerce.number().int().min(4096).max(5000000).optional(),
  maxAuxFiles: z.coerce.number().int().min(1).max(200).optional(),
  maxTotalFiles: z.coerce.number().int().min(1).max(400).optional(),
});

const effectiveScanClawHubOptionsSchema = z.object({
  strict: z.boolean(),
  json: z.boolean(),
  skill: z.string().min(1).optional(),
  version: z.string().min(1).optional(),
  clawhubRegistry: z.string().min(1),
  githubTimeoutMs: z.number().int().min(1000).max(120000),
  githubRetries: z.number().int().min(0).max(6),
  githubRetryBaseMs: z.number().int().min(50).max(5000),
  maxFileBytes: z.number().int().min(4096).max(5000000),
  maxAuxFiles: z.number().int().min(1).max(200),
  maxTotalFiles: z.number().int().min(1).max(400),
});

const DEFAULT_OPTIONS: z.infer<typeof effectiveScanClawHubOptionsSchema> = {
  strict: false,
  json: false,
  skill: undefined,
  version: undefined,
  clawhubRegistry: "https://clawhub.ai",
  githubTimeoutMs: 15000,
  githubRetries: 2,
  githubRetryBaseMs: 300,
  maxFileBytes: 250000,
  maxAuxFiles: 40,
  maxTotalFiles: 120,
};

type CliScanClawHubCommandOptions = z.infer<typeof cliScanClawHubOptionsSchema>;
type ScanClawHubCommandOptions = z.infer<typeof effectiveScanClawHubOptionsSchema>;
type ClawHubModeration = {
  isSuspicious?: boolean;
  isMalwareBlocked?: boolean;
  isRemoved?: boolean;
};

function alignWithClawHubModeration(
  baseDecision: ScoringResult,
  moderation?: ClawHubModeration,
): { decision: ScoringResult; moderationNote?: string } {
  if (!moderation) {
    return { decision: baseDecision };
  }

  if (moderation.isMalwareBlocked) {
    return {
      decision: {
        ...baseDecision,
        riskScore: 100,
        safetyScore: 0,
        level: "CRITICAL",
        reason: "ClawHub moderation marked this skill as malware-blocked.",
      },
      moderationNote: "Aligned with ClawHub moderation: malware-blocked.",
    };
  }

  if (moderation.isSuspicious && baseDecision.level === "SAFE") {
    const adjustedRisk = Math.max(baseDecision.riskScore ?? 0, 30);
    return {
      decision: {
        ...baseDecision,
        riskScore: adjustedRisk,
        safetyScore: 100 - adjustedRisk,
        level: "WARNING",
        reason: "ClawHub moderation marked this skill as suspicious.",
      },
      moderationNote: "Aligned with ClawHub moderation: suspicious.",
    };
  }

  return { decision: baseDecision };
}

function resolveEffectiveScanClawHubOptions(
  cliOptions: CliScanClawHubCommandOptions,
  config: GuardSkillsConfig,
): ScanClawHubCommandOptions {
  const defaults = config.defaults ?? {};
  const resolver = config.resolver ?? {};

  return effectiveScanClawHubOptionsSchema.parse({
    strict: cliOptions.strict ?? defaults.strict ?? DEFAULT_OPTIONS.strict,
    json: cliOptions.json ?? defaults.json ?? DEFAULT_OPTIONS.json,
    skill: cliOptions.skill ?? DEFAULT_OPTIONS.skill,
    version: cliOptions.version ?? DEFAULT_OPTIONS.version,
    clawhubRegistry: cliOptions.clawhubRegistry ?? DEFAULT_OPTIONS.clawhubRegistry,
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

export async function runScanClawHubCommand(identifier: string, rawOptions: unknown): Promise<number> {
  const cliOptions = cliScanClawHubOptionsSchema.parse(rawOptions);
  const loadedConfig = loadGuardSkillsConfig(cliOptions.config);
  const options = resolveEffectiveScanClawHubOptions(cliOptions, loadedConfig.config);

  const resolved = await resolveSkillFromClawHub(identifier, {
    registryBaseUrl: options.clawhubRegistry,
    version: options.version,
    skillNameOverride: options.skill,
    requestTimeoutMs: options.githubTimeoutMs,
    retries: options.githubRetries,
    retryBaseDelayMs: options.githubRetryBaseMs,
    maxFileSizeBytes: options.maxFileBytes,
    maxAuxFiles: options.maxAuxFiles,
    maxTotalFiles: options.maxTotalFiles,
  });

  const scan = scanResolvedSkill(resolved);
  const baseDecision = calculateRiskScore(scan.findings, {
    strict: options.strict,
    trustCredits: 0,
    hasUnverifiableContent: scan.hasUnverifiableContent,
  });
  const moderation = resolved.sourceMetadata?.clawhubModeration;
  const { decision, moderationNote } = alignWithClawHubModeration(baseDecision, moderation);

  const noteParts = ["ClawHub scan complete."];
  if (moderationNote) {
    noteParts.push(moderationNote);
  }
  if (decision.level === "UNSAFE" || decision.level === "CRITICAL" || decision.level === "UNVERIFIABLE") {
    noteParts.push("Blocked-level risk detected.");
  }
  if (loadedConfig.path) {
    noteParts.push(`Config: ${loadedConfig.path}`);
  }

  const report = {
    command: "guardskills scan-clawhub",
    identifier,
    registry: options.clawhubRegistry,
    strict: options.strict,
    configPath: loadedConfig.path ?? undefined,
    decision,
    scanFiles: resolved.files.map((file) => file.path),
    skillDir: resolved.skillDir,
    repo: `${resolved.owner}/${resolved.repo}`,
    skill: resolved.skillName,
    version: options.version,
    commitSha: resolved.commitSha,
    moderation,
    unverifiableReasons: scan.unverifiableReasons,
    note: noteParts.join(" "),
  };

  if (options.json) {
    printJsonClawHubReport(report);
  } else {
    printHumanClawHubReport(report);
  }

  return decision.level === "UNSAFE" || decision.level === "CRITICAL" || decision.level === "UNVERIFIABLE"
    ? 20
    : 0;
}
