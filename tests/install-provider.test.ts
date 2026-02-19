import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execa: vi.fn(),
}));

vi.mock("execa", () => ({
  execa: mocks.execa,
}));

import { runProviderInstall } from "../src/install/skills.js";

describe("provider installer handoff", () => {
  beforeEach(() => {
    mocks.execa.mockReset();
  });

  it("maps skills provider to npx skills add", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("skills", "owner/repo", "find-skills");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["skills", "add", "owner/repo", "--skill", "find-skills"],
      { stdio: "inherit" },
    );
  });

  it("maps playbooks provider to npx playbooks add skill", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("playbooks", "anthropics/skills", "frontend-design");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["playbooks", "add", "skill", "anthropics/skills", "--skill", "frontend-design"],
      { stdio: "inherit" },
    );
  });

  it("returns runtime error code when playbooks skill is missing", async () => {
    const code = await runProviderInstall("playbooks", "anthropics/skills");

    expect(code).toBe(30);
    expect(mocks.execa).not.toHaveBeenCalled();
  });

  it("maps openskills provider to npx openskills install", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("openskills", "anthropics/skills", "ui-designer");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["openskills", "install", "anthropics/skills", "ui-designer"],
      { stdio: "inherit" },
    );
  });

  it("maps openskills provider without skill to interactive install", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("openskills", "anthropics/skills");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["openskills", "install", "anthropics/skills"],
      { stdio: "inherit" },
    );
  });

  it("maps skillkit provider to npx skillkit install --skill", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("skillkit", "rohitg00/skillkit", "dev-tools");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["skillkit", "install", "rohitg00/skillkit", "--skill", "dev-tools"],
      { stdio: "inherit" },
    );
  });

  it("maps skillkit provider without skill to install source", async () => {
    mocks.execa.mockResolvedValueOnce({});

    const code = await runProviderInstall("skillkit", "rohitg00/skillkit");

    expect(code).toBe(0);
    expect(mocks.execa).toHaveBeenCalledWith(
      "npx",
      ["skillkit", "install", "rohitg00/skillkit"],
      { stdio: "inherit" },
    );
  });
});
