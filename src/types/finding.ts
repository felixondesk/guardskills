export type Severity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" | "INFO";

export type Confidence = "high" | "medium" | "low";

export type FindingType =
  | "CREDENTIAL_EXFIL"
  | "DESTRUCTIVE_OP"
  | "REMOTE_CODE_EXEC"
  | "PRIV_ESCALATION"
  | "SECRET_READ"
  | "NETWORK_POST"
  | "DECODE_EXEC"
  | "ENV_ACCESS"
  | "FILE_STAGE"
  | "OTHER";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  type: FindingType;
  file?: string;
  message?: string;
}
