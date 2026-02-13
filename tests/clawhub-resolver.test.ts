import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";

const mocks = vi.hoisted(() => ({
  resolveSkillFromGitHub: vi.fn(),
}));

vi.mock("../src/resolver/github.js", () => ({
  resolveSkillFromGitHub: mocks.resolveSkillFromGitHub,
}));

import { resolveSkillFromClawHub } from "../src/resolver/clawhub.js";

const originalFetch = global.fetch;

describe("resolveSkillFromClawHub", () => {
  beforeEach(() => {
    mocks.resolveSkillFromGitHub.mockReset();
    global.fetch = vi.fn(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
    }));

    mocks.resolveSkillFromGitHub.mockResolvedValue({
      source: "owner/repo",
      owner: "owner",
      repo: "repo",
      defaultBranch: "main",
      commitSha: "sha123",
      skillName: "scan-skill",
      skillDir: "skills/scan-skill",
      skillFilePath: "skills/scan-skill/SKILL.md",
      files: [{ path: "skills/scan-skill/SKILL.md", content: "# Skill" }],
      unverifiableReasons: [],
    });
  });

  it("resolves via /api/v1/package metadata and maps to github", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          name: "scan-skill",
          repository: "https://github.com/owner/repo",
        },
      }),
    });

    const resolved = await resolveSkillFromClawHub("org/scan-skill");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/package/org%2Fscan-skill",
      expect.objectContaining({ method: "GET" }),
    );
    expect(mocks.resolveSkillFromGitHub).toHaveBeenCalledWith(
      "owner/repo",
      "scan-skill",
      expect.any(Object),
    );
    expect(resolved.source).toBe("clawhub:org/scan-skill");
  });

  it("falls back to /api/package when /api/v1/package returns 404", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: "Not Found",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        json: async () => ({
          github: "owner/repo",
          skill: "scan-skill",
        }),
      });

    await resolveSkillFromClawHub("org/scan-skill");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.resolveSkillFromGitHub).toHaveBeenCalledWith(
      "owner/repo",
      "scan-skill",
      expect.any(Object),
    );
  });

  it("throws if no github source can be inferred", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({ data: { name: "scan-skill" } }),
    });

    await expect(resolveSkillFromClawHub("org/scan-skill")).rejects.toThrow(
      /github source|archive/i,
    );
  });

  it("accepts full ClawHub link input and resolves owner/skill identifier", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        data: {
          repository: "owner/repo",
          skill: "trello",
        },
      }),
    });

    const resolved = await resolveSkillFromClawHub("https://clawhub.ai/steipete/trello");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://clawhub.ai/api/v1/package/steipete%2Ftrello",
      expect.objectContaining({ method: "GET" }),
    );
    expect(resolved.source).toContain("clawhub:steipete/trello");
  });

  it("falls back to ClawHub page HTML when API endpoints are not found", async () => {
    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string | URL) => {
      const asString = String(url);
      if (asString === "https://clawhub.ai/steipete/trello") {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          text: async () => "<html><body>See https://github.com/steipete/trello-skills</body></html>",
        };
      }
      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };
    });

    await resolveSkillFromClawHub("https://clawhub.ai/steipete/trello");

    expect(mocks.resolveSkillFromGitHub).toHaveBeenCalledWith(
      "steipete/trello-skills",
      "trello",
      expect.any(Object),
    );
  });

  it("falls back to archive download when GitHub source is not exposed", async () => {
    const zip = new JSZip();
    zip.file("SKILL.md", "# Trello Skill");
    zip.file("scripts/run.sh", "echo hi");
    const archive = await zip.generateAsync({ type: "nodebuffer" });

    const fetchMock = global.fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockImplementation(async (url: string | URL) => {
      const asString = String(url);

      if (asString.includes("/api/v1/skills/trello")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          json: async () => ({
            skill: { slug: "trello" },
            owner: { handle: "steipete" },
            latestVersion: { version: "1.0.0" },
          }),
        };
      }

      if (asString.includes("auth.clawdhub.com/api/v1/download?slug=trello&version=1.0.0")) {
        return {
          ok: true,
          status: 200,
          statusText: "OK",
          arrayBuffer: async () => archive.buffer.slice(
            archive.byteOffset,
            archive.byteOffset + archive.byteLength,
          ),
        };
      }

      return {
        ok: false,
        status: 404,
        statusText: "Not Found",
      };
    });

    const resolved = await resolveSkillFromClawHub("https://clawhub.ai/steipete/trello");
    expect(mocks.resolveSkillFromGitHub).not.toHaveBeenCalled();
    expect(resolved.source).toContain("clawhub:steipete/trello@1.0.0");
    expect(resolved.files.some((file) => file.path.endsWith("SKILL.md"))).toBe(true);
  });
});

afterEach(() => {
  global.fetch = originalFetch;
});
