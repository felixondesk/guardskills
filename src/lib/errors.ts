export type GuardSkillsErrorCode =
  | "INVALID_REPO_INPUT"
  | "INVALID_CONFIG"
  | "POLICY_VIOLATION"
  | "SKILL_NOT_FOUND"
  | "GITHUB_NOT_FOUND"
  | "GITHUB_AUTH"
  | "GITHUB_RATE_LIMIT"
  | "GITHUB_TIMEOUT"
  | "GITHUB_TRANSIENT"
  | "GITHUB_UNKNOWN";

export class GuardSkillsError extends Error {
  readonly code: GuardSkillsErrorCode;
  readonly retryable: boolean;
  readonly status?: number;

  constructor(
    code: GuardSkillsErrorCode,
    message: string,
    options: {
      retryable?: boolean;
      status?: number;
      cause?: unknown;
    } = {},
  ) {
    super(message);
    this.name = "GuardSkillsError";
    this.code = code;
    this.retryable = options.retryable ?? false;
    this.status = options.status;

    if (options.cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = options.cause;
    }
  }
}

export function isGuardSkillsError(error: unknown): error is GuardSkillsError {
  return error instanceof GuardSkillsError;
}