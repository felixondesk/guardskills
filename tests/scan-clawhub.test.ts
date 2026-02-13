import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  resolveSkillFromClawHub: vi.fn(),
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
  printHumanClawHubReport: vi.fn(),
  printJsonClawHubReport: vi.fn(),
}));

vi.mock("../src/resolver/clawhub.js", () => ({
  resolveSkillFromClawHub: mocks.resolveSkillFromClawHub,
}));

vi.mock("../src/scanner/scan.js", () => ({
  scanResolvedSkill: mocks.scanResolvedSkill,
}));

vi.mock("../src/scoring/engine.js", () => ({
  calculateRiskScore: mocks.calculateRiskScore,
}));

vi.mock("../src/lib/output.js", () => ({
  printHumanClawHubReport: mocks.printHumanClawHubReport,
  printJsonClawHubReport: mocks.printJsonClawHubReport,
}));

import { runScanClawHubCommand } from "../src/commands/scan-clawhub.js";

function makeDecision(level: ScoringResult["level"]): ScoringResult {
  const riskScore = level === "UNVERIFIABLE" ? null : level === "CRITICAL" ? 100 : 0;
  const safetyScore = riskScore === null ? null : 100 - riskScore;
  return {
    level,
    riskScore,
    safetyScore,
    findings: [],
    chainMatches: [],
    breakdown: {
      findingsSubtotal: 0,
      chainBonus: 0,
      trustCredits: 0,
    },
  };
}

describe("runScanClawHubCommand", () => {
  beforeEach(() => {
    mocks.resolveSkillFromClawHub.mockReset();
    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();
    mocks.printHumanClawHubReport.mockReset();
    mocks.printJsonClawHubReport.mockReset();

    mocks.resolveSkillFromClawHub.mockResolvedValue({
      source: "clawhub:test/skill",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      skillName: "skill",
      skillDir: "skills/skill",
      skillFilePath: "skills/skill/SKILL.md",
      files: [{ path: "skills/skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
    });

    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });

    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));
  });

  it("returns 0 and prints human report for SAFE", async () => {
    const code = await runScanClawHubCommand("test/skill", {});
    expect(code).toBe(0);
    expect(mocks.printHumanClawHubReport).toHaveBeenCalledTimes(1);
    expect(mocks.printJsonClawHubReport).not.toHaveBeenCalled();
  });

  it("returns 20 for blocked levels", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("CRITICAL"));
    const code = await runScanClawHubCommand("test/skill", {});
    expect(code).toBe(20);
  });

  it("prints json report when --json is enabled", async () => {
    const code = await runScanClawHubCommand("test/skill", { json: true });
    expect(code).toBe(0);
    expect(mocks.printJsonClawHubReport).toHaveBeenCalledTimes(1);
    expect(mocks.printHumanClawHubReport).not.toHaveBeenCalled();
  });

  it("raises SAFE to WARNING when ClawHub marks skill as suspicious", async () => {
    mocks.resolveSkillFromClawHub.mockResolvedValue({
      source: "clawhub:test/skill",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      skillName: "skill",
      skillDir: "skills/skill",
      skillFilePath: "skills/skill/SKILL.md",
      files: [{ path: "skills/skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
      sourceMetadata: {
        clawhubModeration: { isSuspicious: true },
      },
    });

    const code = await runScanClawHubCommand("test/skill", { json: true });
    expect(code).toBe(0);
    expect(mocks.printJsonClawHubReport).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ level: "WARNING" }),
      }),
    );
  });

  it("forces CRITICAL when ClawHub marks skill as malware-blocked", async () => {
    mocks.resolveSkillFromClawHub.mockResolvedValue({
      source: "clawhub:test/skill",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "abc123",
      skillName: "skill",
      skillDir: "skills/skill",
      skillFilePath: "skills/skill/SKILL.md",
      files: [{ path: "skills/skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
      sourceMetadata: {
        clawhubModeration: { isMalwareBlocked: true },
      },
    });

    const code = await runScanClawHubCommand("test/skill", { json: true });
    expect(code).toBe(20);
    expect(mocks.printJsonClawHubReport).toHaveBeenCalledWith(
      expect.objectContaining({
        decision: expect.objectContaining({ level: "CRITICAL" }),
      }),
    );
  });
});
