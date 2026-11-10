# Self-assessment against the company rubric

Prepared by the AI assistant on 2026-11-09 from the evidence in
[evidence/sandbox-verification.md](evidence/sandbox-verification.md). **Update this
after running the stack on Windows and in GitHub Actions.**

Scoring rule used: marks are given only for what has been **executed**. Where the
implementation exists but has only been validated statically or in an equivalent
non-Docker environment, the "pending" marks are listed separately. These are estimates,
not the company's marks.

| Criterion | Max | Evidenced now | Pending owner's runs | Main evidence | What is still missing |
|---|---|---|---|---|---|
| Containerization & Reproducibility | 20 | 11 | +8 | Multi-stage non-root Dockerfile (hadolint clean, Trivy misconfig 0); Compose valid with health-gated ordering; lockfile + `npm ci`; seed idempotent; Mongo bootstrap reproduced natively | A real `docker compose up --build` from a clean clone (Test 2); image size and digest |
| CI/CD Automation | 20 | 9 | +10 | Workflow lint-clean (actionlint); every step's command run locally (lint, audit, 60 tests); SHA-pinned actions; version/sha tagging; Trivy gate; e2e job design | An actual green GitHub Actions run (Test 3), GHCR digest |
| Deployment, Networking & Security | 15 | 11 | +3 | Nginx config executed: redirect, TLS/HTTP2, HSTS (duplicate fixed), `/metrics` blocked, JSON 503; keyfile auth + 3 least-privilege users exercised; auth/validation/rate-limit tests; prod `npm audit` 0 | Networks and container hardening running under Docker; Trivy image CVE result |
| Observability & Troubleshooting | 15 | 12 | +2 | JSON logs with request-id correlation across Nginx and app; every dashboard query returns data; alert pending → firing → resolved observed; runbook | Grafana UI screenshot from the real stack; Test 4/5 on Docker |
| Backup, Restore & Rollback | 15 | 10 | +4 | Real `backup.ps1`/`restore.ps1` executed against authenticated MongoDB: data loss → verified restore, tamper rejected; backup user least-privilege confirmed | Same on Docker; `deploy.ps1` automatic-rollback run (needs Docker); Task Scheduler registration |
| Reliability & Documentation | 10 | 8 | +1 | Graceful shutdown and auto-reconnect observed; README, runbook, rollback, architecture, walkthrough, learning guide, dev log with honest disclosure | Owner's own log entries and evidence files |
| Domain API Correctness | 5 | 5 | — | 60 tests incl. 20 concurrent same-key checkouts and 30 buyers for 12 units; snapshots; audit events; state machine | — |
| **Total** | **100** | **66** | **+28** | | |

**Reading this:** 66/100 is what can be *proven* today without Docker or CI. If the
owner's `run-acceptance.ps1 -IncludeRollback` and the CI pipeline pass, the evidence
would support roughly 90–94. The remaining points are deliberate limitations (single
node, no notifications, no off-host backups) and the owner's demonstrated understanding,
which documents cannot supply.

## Acceptance tests

| Test | Status | Evidence / next step |
|---|---|---|
| 1. Idempotent checkout | **COMPLETED** (sandbox: unit, live HTTP and through Nginx/TLS) | sandbox evidence §1, §3, §4 · re-run via `run-acceptance.ps1` |
| 2. Clean build and start | **NOT YET RUN on Docker** — config validated | owner: fresh clone + README quick start; CI `e2e` job |
| 3. CI runs checks, tests, versioned image | **BLOCKED** — needs push | owner: push, attach run link + digest |
| 4. Health/readiness and logs | **PARTIALLY COMPLETED** (native processes) | `run-acceptance.ps1` |
| 5. Break a service, detect, recover | **PARTIALLY COMPLETED** (native; alert lifecycle observed) | `failure-drill.ps1` |
| 6. Backup restore or rollback | **PARTIALLY COMPLETED** (restore executed with real scripts; Docker CLI simulated) | `run-acceptance.ps1 -IncludeRollback` |
