import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  resolveSkillFromGitHub: vi.fn(),
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
  runProviderInstall: vi.fn(),
  printHumanReport: vi.fn(),
  printJsonReport: vi.fn(),
}));

vi.mock("../src/resolver/github.js", () => ({
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

vi.mock("../src/lib/output.js", () => ({
  printHumanReport: mocks.printHumanReport,
  printJsonReport: mocks.printJsonReport,
}));

import { runAddCommand } from "../src/commands/add.js";

const originalCwd = process.cwd();

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

describe("runAddCommand install handoff", () => {
  beforeEach(() => {
    process.chdir(originalCwd);

    mocks.resolveSkillFromGitHub.mockReset();
    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();
    mocks.runProviderInstall.mockReset();
    mocks.printHumanReport.mockReset();
    mocks.printJsonReport.mockReset();

    mocks.resolveSkillFromGitHub.mockResolvedValue({
      source: "fixture",
      owner: "fixture",
      repo: "fixture",
      defaultBranch: "main",
      commitSha: "fixture-sha",
      skillName: "test-skill",
      skillDir: "skills/test-skill",
      skillFilePath: "skills/test-skill/SKILL.md",
      files: [{ path: "skills/test-skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
    });

    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });

    mocks.runProviderInstall.mockResolvedValue(0);
    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));
  });

  it("calls installer for SAFE when not dry-run and not ci", async () => {
    const code = await runAddCommand("owner/repo", { skill: "test-skill" });
    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledTimes(1);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skills", "owner/repo", "test-skill");
  });

  it("does not call installer in ci mode", async () => {
    const code = await runAddCommand("owner/repo", { skill: "test-skill", ci: true });
    expect(code).toBe(0);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });

  it("requires --yes for WARNING", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("WARNING"));

    const code = await runAddCommand("owner/repo", { skill: "test-skill" });
    expect(code).toBe(10);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });

  it("allows WARNING with --yes", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("WARNING"));

    const code = await runAddCommand("owner/repo", { skill: "test-skill", yes: true });
    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledTimes(1);
  });

  it("blocks UNSAFE unless --force", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("UNSAFE"));

    const blocked = await runAddCommand("owner/repo", { skill: "test-skill" });
    expect(blocked).toBe(20);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();

    const forced = await runAddCommand("owner/repo", { skill: "test-skill", force: true });
    expect(forced).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledTimes(1);
  });

  it("blocks UNVERIFIABLE unless override", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("UNVERIFIABLE"));

    const blocked = await runAddCommand("owner/repo", { skill: "test-skill" });
    expect(blocked).toBe(20);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();

    const overridden = await runAddCommand("owner/repo", {
      skill: "test-skill",
      allowUnverifiable: true,
    });
    expect(overridden).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledTimes(1);
  });

  it("applies defaults from guardskills.config.json", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-add-config-"));
    const configPath = path.join(tmpDir, "guardskills.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ defaults: { ci: true } }), "utf8");

    process.chdir(tmpDir);
    const code = await runAddCommand("owner/repo", { skill: "test-skill" });

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });

  it("enforces policy that blocks --force", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-add-policy-"));
    const configPath = path.join(tmpDir, "guardskills.config.json");
    fs.writeFileSync(configPath, JSON.stringify({ policy: { allowForce: false } }), "utf8");

    process.chdir(tmpDir);
    mocks.calculateRiskScore.mockReturnValue(makeDecision("UNSAFE"));

    await expect(runAddCommand("owner/repo", { skill: "test-skill", force: true })).rejects.toThrow(
      /allowForce=false/i,
    );
  });

  it("uses provider override for playbooks install handoff", async () => {
    const code = await runAddCommand(
      "owner/repo",
      { skill: "test-skill" },
      { provider: "playbooks", commandName: "guardskills playbooks add skill" },
    );

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("playbooks", "owner/repo", "test-skill");
    expect(mocks.printHumanReport).toHaveBeenCalledWith(
      expect.objectContaining({ command: "guardskills playbooks add skill" }),
    );
  });
});
