import { execa } from "execa";

export type SkillInstallerProvider = "skills" | "playbooks" | "openskills" | "skillkit";

export async function runProviderInstall(
  provider: SkillInstallerProvider,
  repo: string,
  skill?: string,
): Promise<number> {
  if (provider === "playbooks" && !skill) {
    return 30;
  }

  const args = provider === "skills"
    ? skill
    ? ["skills", "add", repo, "--skill", skill]
    : ["skills", "add", repo]
    : provider === "playbooks"
    ? ["playbooks", "add", "skill", repo, "--skill", skill as string]
    : provider === "skillkit"
    ? skill
      ? ["skillkit", "install", repo, "--skill", skill]
      : ["skillkit", "install", repo]
    : skill
    ? ["openskills", "install", repo, skill]
    : ["openskills", "install", repo];

  try {
    await execa("npx", args, {
      stdio: "inherit",
    });
    return 0;
  } catch (error) {
    if (typeof error === "object" && error !== null && "exitCode" in error) {
      const maybeCode = (error as { exitCode?: number }).exitCode;
      if (typeof maybeCode === "number") {
        return maybeCode;
      }
    }

    return 30;
  }
}

export async function runSkillsInstall(repo: string, skill: string): Promise<number> {
  return runProviderInstall("skills", repo, skill);
}
