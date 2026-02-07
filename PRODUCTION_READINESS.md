# PRODUCTION_READINESS

This checklist tracks readiness for a production-grade `guardskills` release.

## Readiness Scale

- `Done`: implemented and verified in this repository
- `In Progress`: partially implemented
- `Pending`: not yet implemented

## P0 Critical (Must-have before production)

1. Deterministic CI gating (`--ci`)  
Status: `Done`

2. Hard safety limits for resolver (timeouts, max file size/count)  
Status: `Done`

3. Stable, documented exit codes  
Status: `Done`

4. Scanner rule coverage for core malware classes  
Status: `In Progress`

5. False-positive controls with fixture regression tests  
Status: `Done`

6. End-to-end integration tests for install handoff paths  
Status: `Done` (command-level integration tests in `tests/add-handoff.test.ts`)

7. Security review of scanner bypass/evasion paths  
Status: `Pending`

## P1 High (Required for broad adoption)

1. Versioned policy/config file (`guardskills.config.json`)  
Status: `Done` (supports defaults, resolver limits, and source/override policy)

2. Rule versioning + changelog + compatibility guarantees  
Status: `Pending`

3. Structured error taxonomy (network/auth/not-found/rate-limit)  
Status: `Done`

4. Robust retry/backoff for transient GitHub API failures  
Status: `Done`

5. Performance and memory profiling on large repositories  
Status: `Pending`

6. Signed release artifacts and provenance (supply chain hardening)  
Status: `Done` (GitHub release workflow publishes with npm provenance)

## P2 Medium (Operational maturity)

1. Telemetry/metrics (opt-in) for false positive and miss rates  
Status: `Pending`

2. Policy presets by risk posture (balanced/strict/paranoid)  
Status: `Pending`

3. Rule documentation auto-generation from source metadata  
Status: `Pending`

4. Security benchmark corpus with periodic calibration  
Status: `In Progress`

## Implemented in this sprint

- `--ci` mode: scan + gate only, no install handoff
- Resolver controls:
  - `--github-timeout-ms`
  - `--github-retries`
  - `--github-retry-base-ms`
  - `--max-file-bytes`
  - `--max-aux-files`
  - `--max-total-files`
- Expanded scanner rules and markdown executable-content filtering
- Fixture tests for safe/warning/malicious/prose-only cases
- Command integration tests for installer handoff and gate behavior
- Structured resolver errors with retry/backoff strategy
- CI + release workflows and SECURITY policy
- Rulebook in `RULES.md`

## Next 3 priorities

1. Add repository integration tests with HTTP fixtures for resolver retries and error classes.
2. Add scanner benchmark corpus and threshold calibration automation.
3. Add policy versioning/migration semantics for long-term compatibility.
