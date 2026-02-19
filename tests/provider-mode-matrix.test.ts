import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ScoringResult } from "../src/scoring/types.js";

const mocks = vi.hoisted(() => ({
  runProviderInstall: vi.fn(),
  scanResolvedSkill: vi.fn(),
  calculateRiskScore: vi.fn(),
  execa: vi.fn(),
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

vi.mock("execa", () => ({
  execa: mocks.execa,
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

describe("provider/source/mode matrix", () => {
  let localRoot: string;

  beforeEach(() => {
    localRoot = fs.mkdtempSync(path.join(os.tmpdir(), "guardskills-provider-matrix-"));
    writeSkill(localRoot, "alpha-skill");
    writeSkill(localRoot, "beta-skill");

    mocks.runProviderInstall.mockReset();
    mocks.scanResolvedSkill.mockReset();
    mocks.calculateRiskScore.mockReset();
    mocks.execa.mockReset();

    mocks.runProviderInstall.mockResolvedValue(0);
    mocks.scanResolvedSkill.mockReturnValue({
      findings: [],
      hasUnverifiableContent: false,
      unverifiableReasons: [],
    });
    mocks.calculateRiskScore.mockReturnValue(makeDecision("SAFE"));

    // Mock git clone path for GitHub-like sources in interactive flow.
    mocks.execa.mockImplementation(async (command: string, args?: string[]) => {
      if (command === "git" && Array.isArray(args) && args[0] === "clone") {
        const targetDir = args[4];
        if (!targetDir) {
          throw new Error("Missing clone target");
        }
        fs.mkdirSync(targetDir, { recursive: true });
        writeSkill(targetDir, "gh-skill");
      }
      return {} as never;
    });
  });

  afterEach(() => {
    fs.rmSync(localRoot, { recursive: true, force: true });
  });

  it("supports skills provider in non-interactive single-skill mode", async () => {
    const code = await runInteractiveInstallCommand("skills", localRoot, "alpha-skill", {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skills", localRoot, "alpha-skill");
  });

  it("supports skills provider in interactive mode", async () => {
    const code = await runInteractiveInstallCommand("skills", localRoot, undefined, {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skills", localRoot, undefined);
  });

  it("supports openskills provider in non-interactive single-skill mode", async () => {
    const code = await runInteractiveInstallCommand("openskills", localRoot, "beta-skill", {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("openskills", localRoot, "beta-skill");
  });

  it("supports openskills provider in interactive mode", async () => {
    const code = await runInteractiveInstallCommand("openskills", localRoot, undefined, {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("openskills", localRoot, undefined);
  });

  it("supports skillkit provider in non-interactive single-skill mode", async () => {
    const code = await runInteractiveInstallCommand("skillkit", localRoot, "alpha-skill", {});

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skillkit", localRoot, "alpha-skill");
  });

  it("supports GitHub source inputs via clone flow", async () => {
    const code = await runInteractiveInstallCommand("skills", "owner/repo", undefined, {});

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "git",
      ["clone", "--depth", "1", "https://github.com/owner/repo.git", expect.any(String)],
      { timeout: 15000 },
    );
    expect(mocks.runProviderInstall).toHaveBeenCalledWith("skills", "owner/repo", undefined);
  });

  it("skips install in non-interactive mode when --ci is enabled", async () => {
    const code = await runInteractiveInstallCommand("skills", localRoot, "alpha-skill", { ci: true });

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });

  it("skips install in interactive mode when --dry-run is enabled", async () => {
    const code = await runInteractiveInstallCommand("openskills", localRoot, undefined, {
      dryRun: true,
    });

    expect(code).toBe(0);
    expect(mocks.runProviderInstall).not.toHaveBeenCalled();
  });
});
