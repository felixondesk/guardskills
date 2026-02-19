import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  listSkillNamesFromGitHub: vi.fn(),
  resolveSkillFromGitHub: vi.fn(),
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
  runProviderInstall: vi.fn(),
}));

vi.mock("../src/resolver/github.js", () => ({
  listSkillNamesFromGitHub: mocks.listSkillNamesFromGitHub,
  resolveSkillFromGitHub: mocks.resolveSkillFromGitHub,
}));

vi.mock("../src/scanner/scan.js", () => ({
  scanResolvedSkill: mocks.scanResolvedSkill,
}));

vi.mock("../src/scoring/engine.js", () => ({
  calculateRiskScore: mocks.calculateRiskScore,
}));

vi.mock("../src/install/skills.js", () => ({
  runProviderInstall: mocks.runProviderInstall,
}));

import { runAddAllSkillsCommand } from "../src/commands/add.js";

function makeDecision(level: ScoringResult["level"]): ScoringResult {
  const riskScore = level === "UNVERIFIABLE" ? null : level === "CRITICAL" ? 100 : 20;
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

describe("runAddAllSkillsCommand", () => {
  beforeEach(() => {
    mocks.listSkillNamesFromGitHub.mockReset();
    mocks.resolveSkillFromGitHub.mockReset();
    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();
    mocks.runProviderInstall.mockReset();

    mocks.listSkillNamesFromGitHub.mockResolvedValue(["a-skill", "b-skill"]);
    mocks.resolveSkillFromGitHub.mockResolvedValue({
      source: "fixture",
      owner: "fixture",
      repo: "fixture",
      defaultBranch: "main",
      commitSha: "fixture-sha",
      skillName: "a-skill",
      skillDir: "skills/a-skill",
      skillFilePath: "skills/a-skill/SKILL.md",
      files: [{ path: "skills/a-skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
    });
    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });
    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));
    mocks.runProviderInstall.mockResolvedValue(0);
  });

  it("installs openskills interactively when all scans are safe", async () => {
    const code = await runAddAllSkillsCommand("owner/repo", {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("openskills", "owner/repo");
  });

  it("blocks on warning unless --yes", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("WARNING"));

    const blocked = await runAddAllSkillsCommand("owner/repo", {});
    expect(blocked).toBe(10);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();

    const allowed = await runAddAllSkillsCommand("owner/repo", { yes: true });
    expect(allowed).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("openskills", "owner/repo");
  });
});
