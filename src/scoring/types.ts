import type { Finding } from "../types/finding.js";

export type DecisionLevel =
  | "SAFE"
  | "WARNING"
  | "UNSAFE"
  | "CRITICAL"
  | "UNVERIFIABLE";

export interface ChainMatch {
  id: string;
  description: string;
  bonus: number;
}

export interface ScoreBreakdown {
  findingsSubtotal: number;
  chainBonus: number;
  trustCredits: number;
}

export interface ScoringResult {
  riskScore: number | null;
  safetyScore: number | null;
  level: DecisionLevel;
  findings: Finding[];
  chainMatches: ChainMatch[];
  breakdown: ScoreBreakdown;
  reason?: string;
}

export interface ScoreOptions {
  strict?: boolean;
  trustCredits?: number;
  hasUnverifiableContent?: boolean;
}
