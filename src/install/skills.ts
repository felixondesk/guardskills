import { execa } from "execa";

export async function runSkillsInstall(repo: string, skill: string): Promise<number> {
  try {
    await execa("npx", ["skills", "add", repo, "--skill", skill], {
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
