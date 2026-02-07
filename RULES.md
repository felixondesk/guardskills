# RULES

This document is the tuning reference for scanner behavior and scoring.

## Scoring Map

- Severity points:
  - `CRITICAL = 50`
  - `HIGH = 25`
  - `MEDIUM = 12`
  - `LOW = 5`
  - `INFO = 0`
- Confidence multipliers:
  - `high = 1.0`
  - `medium = 0.7`
  - `low = 0.4`
- Risk formula:
  - `risk = clamp(sum(base_points * confidence) + chain_bonus - trust_credits, 0, 100)`
- Trust credits:
  - allowed only when no `HIGH`/`CRITICAL`
  - capped at `20`

## Decision Levels

- Standard mode:
  - `0-29 SAFE`
  - `30-59 WARNING`
  - `60-79 UNSAFE`
  - `80-100 CRITICAL`
- Strict mode:
  - `0-19 SAFE`
  - `20-39 WARNING`
  - `40-59 UNSAFE`
  - `60-100 CRITICAL`
- `UNVERIFIABLE` is separate (not scored), default block unless `--allow-unverifiable`.

## Hard-Block Policy

A finding triggers hard block only when all are true:

- severity is `CRITICAL`
- confidence is `high`
- type is one of:
  - `CREDENTIAL_EXFIL`
  - `DESTRUCTIVE_OP`
  - `REMOTE_CODE_EXEC`
  - `PRIV_ESCALATION`

## Scanner Rule Matrix

| Rule ID | Type | Severity | Confidence | Primary intent | False-positive notes |
|---|---|---:|---:|---|---|
| `R001_CREDENTIAL_EXFIL` | `CREDENTIAL_EXFIL` | `CRITICAL` | `high` | Detect credential read followed by outbound transfer | Requires read + network sequence, not standalone mention |
| `R002_RCE_PIPE` | `REMOTE_CODE_EXEC` | `CRITICAL` | `high` | Detect `download | interpreter` patterns | Anchored to shell-style pipeline |
| `R003_DESTRUCTIVE_FS` | `DESTRUCTIVE_OP` | `CRITICAL` | `high` | Detect destructive wipe/delete commands | Looks for dangerous targets (`/`, home, root-like paths) |
| `R004_PRIV_ESC` | `PRIV_ESCALATION` | `CRITICAL` | `high` | Detect risky `sudo` command execution | Focuses on high-risk command verbs |
| `R005_SECRET_READ` | `SECRET_READ` | `HIGH` | `medium` | Detect secret/token source access | Alone does not hard-block |
| `R006_NETWORK_POST` | `NETWORK_POST` | `MEDIUM` | `medium` | Detect outbound requests with explicit payload/body | Requires payload/body indicators |
| `R007_DECODE_EXEC` | `DECODE_EXEC` | `HIGH` | `medium` | Detect decode/deobfuscation with execution sink | Requires both decode and sink |
| `R008_ENV_ACCESS` | `ENV_ACCESS` | `LOW` | `low` | Detect env reads | Low weight by design |
| `R009_FILE_STAGE` | `FILE_STAGE` | `LOW` | `low` | Detect temp/staging writes | Low weight by design |
| `R010_DYNAMIC_EXEC` | `REMOTE_CODE_EXEC` | `HIGH` | `medium` | Detect dynamic execution primitives | Not hard-block unless promoted to critical/high-confidence |
| `R011_IEX_DOWNLOAD` | `REMOTE_CODE_EXEC` | `CRITICAL` | `high` | Detect PowerShell download-and-execute | Strong signature for malicious behavior |
| `R012_DOWNLOAD_THEN_EXEC` | `REMOTE_CODE_EXEC` | `HIGH` | `medium` | Detect downloaded artifact executed without verification | Medium confidence because some installers are legitimate |
| `R013_ENCODED_EXFIL` | `NETWORK_POST` | `HIGH` | `medium` | Detect encoded data sent externally | Requires encoded transform + network |
| `R014_ARCHIVE_FETCH_EXEC` | `REMOTE_CODE_EXEC` | `HIGH` | `medium` | Detect archive download/extract then execute flow | Can match legitimate bootstrap scripts; not hard-block by itself |
| `R015_CHMOD_THEN_EXEC` | `REMOTE_CODE_EXEC` | `HIGH` | `medium` | Detect chmod +x followed by execution | Requires local execution sequence, still may appear in installers |
| `R016_SPLIT_TOKEN_RCE` | `REMOTE_CODE_EXEC` | `CRITICAL` | `high` | Detect obfuscated split-token download-exec signatures | Targets evasion via token splitting/non-word separators |

## Attack Chain Matrix

| Chain ID | Required finding types | Bonus | Intent |
|---|---|---:|---|
| `CHAIN_SECRET_EXFIL` | `SECRET_READ` + `NETWORK_POST` | `+25` | Credential/data exfil flow |
| `CHAIN_DECODE_EXEC` | `DECODE_EXEC` + `REMOTE_CODE_EXEC` | `+30` | Obfuscated payload execution |
| `CHAIN_ENV_STAGE_EXFIL` | `ENV_ACCESS` + `FILE_STAGE` + `NETWORK_POST` | `+20` | Staged environment exfiltration |

## False-Positive Controls

- Markdown is scanned as executable content only:
  - fenced code blocks
  - inline code snippets that look command-like
  - command-style lines (`$`, `PS>`, `>`, list-item command lines)
- Prose-only markdown text is ignored for high-risk matching.

## Test Fixtures

Current fixture suite in `tests/scanner-scoring.test.ts`:

- `tests/fixtures/safe`: expected `SAFE`
- `tests/fixtures/prose-only`: expected `SAFE` (FP guard)
- `tests/fixtures/warning`: expected `WARNING` with secret+network chain
- `tests/fixtures/malicious`: expected `CRITICAL` hard block

## Tuning Workflow

1. Add/update a rule in `src/scanner/scan.ts`.
2. Add fixture content that should trigger (and one that should not).
3. Assert expected level and chain behavior in `tests/scanner-scoring.test.ts`.
4. Run:
   - `npm run typecheck`
   - `npm test`
   - `npm run build`
   - `npm run audit:prod`
5. If false positives increase, narrow pattern context or lower confidence/severity.
