import type { Finding, FindingType, Severity } from "../types/finding.js";
import type { ChainMatch, ScoreOptions, ScoringResult } from "./types.js";

const SEVERITY_POINTS: Record<Severity, number> = {
  CRITICAL: 50,
  HIGH: 25,
  MEDIUM: 12,
  LOW: 5,
  INFO: 0,
};

const CONFIDENCE_MULTIPLIER = {
  high: 1.0,
  medium: 0.7,
  low: 0.4,
} as const;

const HARD_BLOCK_TYPES = new Set<FindingType>([
  "CREDENTIAL_EXFIL",
  "DESTRUCTIVE_OP",
  "REMOTE_CODE_EXEC",
  "PRIV_ESCALATION",
]);

const ATTACK_CHAINS: Array<{
  id: string;
  description: string;
  pattern: FindingType[];
  bonus: number;
}> = [
  {
    id: "CHAIN_SECRET_EXFIL",
    description: "Secret read combined with network post",
    pattern: ["SECRET_READ", "NETWORK_POST"],
    bonus: 25,
  },
  {
    id: "CHAIN_DECODE_EXEC",
    description: "Decode/deobfuscation followed by execution",
    pattern: ["DECODE_EXEC", "REMOTE_CODE_EXEC"],
    bonus: 30,
  },
  {
    id: "CHAIN_ENV_STAGE_EXFIL",
    description: "Env access + staging + network post",
    pattern: ["ENV_ACCESS", "FILE_STAGE", "NETWORK_POST"],
    bonus: 20,
  },
];

function clampRisk(score: number): number {
  return Math.max(0, Math.min(100, score));
}

function detectChains(findings: Finding[]): ChainMatch[] {
  return ATTACK_CHAINS.filter((chain) =>
    chain.pattern.every((kind) => findings.some((finding) => finding.type === kind)),
  ).map(({ id, description, bonus }) => ({ id, description, bonus }));
}

function decideLevel(riskScore: number, strict = false): ScoringResult["level"] {
  if (!strict) {
    if (riskScore <= 29) return "SAFE";
    if (riskScore <= 59) return "WARNING";
    if (riskScore <= 79) return "UNSAFE";
    return "CRITICAL";
  }

  if (riskScore <= 19) return "SAFE";
  if (riskScore <= 39) return "WARNING";
  if (riskScore <= 59) return "UNSAFE";
  return "CRITICAL";
}

export function calculateRiskScore(findings: Finding[], options: ScoreOptions = {}): ScoringResult {
  if (options.hasUnverifiableContent) {
    return {
      riskScore: null,
      safetyScore: null,
      level: "UNVERIFIABLE",
      findings,
      chainMatches: [],
      breakdown: {
        findingsSubtotal: 0,
        chainBonus: 0,
        trustCredits: 0,
      },
      reason: "Critical content could not be analyzed safely.",
    };
  }

  const hardBlock = findings.some(
    (finding) =>
      finding.severity === "CRITICAL" &&
      finding.confidence === "high" &&
      HARD_BLOCK_TYPES.has(finding.type),
  );

  if (hardBlock) {
    return {
      riskScore: 100,
      safetyScore: 0,
      level: "CRITICAL",
      findings,
      chainMatches: [],
      breakdown: {
        findingsSubtotal: 100,
        chainBonus: 0,
        trustCredits: 0,
      },
      reason: "Hard-block rule triggered by high-confidence critical behavior.",
    };
  }

  const findingsSubtotal = findings.reduce((sum, finding) => {
    const points = SEVERITY_POINTS[finding.severity];
    const multiplier = CONFIDENCE_MULTIPLIER[finding.confidence];
    return sum + points * multiplier;
  }, 0);

  const chainMatches = detectChains(findings);
  const chainBonus = chainMatches.reduce((sum, chain) => sum + chain.bonus, 0);

  const hasHighOrCritical = findings.some(
    (finding) => finding.severity === "HIGH" || finding.severity === "CRITICAL",
  );
  const requestedTrust = Math.max(0, options.trustCredits ?? 0);
  const trustCredits = hasHighOrCritical ? 0 : Math.min(requestedTrust, 20);

  const riskScore = clampRisk(findingsSubtotal + chainBonus - trustCredits);

  return {
    riskScore,
    safetyScore: 100 - riskScore,
    level: decideLevel(riskScore, options.strict),
    findings,
    chainMatches,
    breakdown: {
      findingsSubtotal,
      chainBonus,
      trustCredits,
    },
  };
}
