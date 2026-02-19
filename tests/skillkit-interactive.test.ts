import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  runProviderInstall: vi.fn(),
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
}));

vi.mock("../src/install/skills.js", () => ({
  runProviderInstall: mocks.runProviderInstall,
}));

vi.mock("../src/scanner/scan.js", () => ({
  scanResolvedSkill: mocks.scanResolvedSkill,
}));

vi.mock("../src/scoring/engine.js", () => ({
  calculateRiskScore: mocks.calculateRiskScore,
}));

import { runInteractiveInstallCommand } from "../src/commands/openskills-install.js";

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

function writeSkill(root: string, skillName: string): void {
  const skillDir = path.join(root, skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skillName}\n`, "utf8");
}

describe("runInteractiveInstallCommand (skillkit)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-skillkit-interactive-"));
    writeSkill(tmpDir, "alpha-skill");
    writeSkill(tmpDir, "beta-skill");

    mocks.runProviderInstall.mockReset();
    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();

    mocks.runProviderInstall.mockResolvedValue(0);
    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });
    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("installs a specific skill via skillkit when SAFE", async () => {
    const code = await runInteractiveInstallCommand("skillkit", tmpDir, "alpha-skill", {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skillkit", tmpDir, "alpha-skill");
  });

  it("blocks WARNING without --yes in interactive mode", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("WARNING"));

    const code = await runInteractiveInstallCommand("skillkit", tmpDir, undefined, {});

    expect(code).toBe(10);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });

  it("installs interactively with --yes when WARNING", async () => {
    mocks.calculateRiskScore.mockReturnValue(makeDecision("WARNING"));

    const code = await runInteractiveInstallCommand("skillkit", tmpDir, undefined, { yes: true });

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skillkit", tmpDir, undefined);
  });
});
