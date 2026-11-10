# Development log

## AI-assistance disclosure

This project was built with substantial help from **Claude (Anthropic), an AI assistant**,
working in an "autonomous" mode at the repository owner's request.

| Area | Who did it |
|---|---|
| Requirements, constraints (Windows, zero budget, stack choice) | Repository owner |
| Architecture, source code, tests, Docker/Compose/Nginx/CI/monitoring configuration, scripts, documentation | AI assistant (first versions) |
| Verification in the AI's Linux sandbox (see `docs/evidence/sandbox-verification.md`) | AI assistant |
| Running the stack on Windows / Docker Desktop, pushing to GitHub, CI runs | Repository owner — **to be done** |
| Reviewing, understanding and changing the code | Repository owner — **record below** |

The original ALGIONS assignment document was not available to the assistant; the build
follows the requirements as restated by the owner. **Owner: compare against the original
brief and note any differences here.**

## Owner's log

Add an entry each time you run, change or learn something. This is your record for the
interview. Write what you actually did.

| Date | What I did | What I learned / problems hit |
|---|---|---|
| | Ran environment checks on Windows | |
| | `docker compose up -d --build` from a fresh clone | |
| | `run-acceptance.ps1 -IncludeRollback` | |
| | Pushed to GitHub, first CI run (link) | |
| | Change I made myself: … | |

## AI build log (2026-11-09)

### Decisions

- **Versions:** Node 22 LTS (Node 20 reached end of life in April 2026); Express 5
  (forwards async errors to the error handler); Mongoose 9; MongoDB 8.0 image. npm
  packages were chosen as the newest release **at least 14 days old** to reduce
  exposure to freshly published malicious versions; five packages were held one
  release back for this reason. Trivy pinned to 0.76.0 (0.76.2 was 4 days old).
  GitHub Actions pinned to full commit SHAs.
- **Replica set** for transactions; **unique index** for idempotency; **integer paise** for money.
- **PowerShell 7** for all operations scripts so the same scripts run on Windows and on CI.

### Problems found and how they were fixed

1. **Directories created with literal braces** (`src/{config,…}`) — the sandbox shell is
   `sh`, which has no brace expansion. Recreated with explicit paths.
2. **All database tests failed: `Missing required sub-document 'driver' in the client metadata`.**
   Narrowed down step by step: the same connection worked outside Jest, worked with
   driver 7.5.0 inside Jest, failed with driver 7.7.0 (bundled with Mongoose 9.11) inside
   Jest. Root cause: driver 7.7 loads runtime adapters with a dynamic `import()`; inside
   Jest's VM sandbox that throws unless Node runs with `--experimental-vm-modules`; the
   driver swallows the error and sends empty client metadata, which the server rejects.
   Fix (tests only): `node --experimental-vm-modules node_modules/jest/bin/jest.js`.
3. **`Cannot read properties of undefined (reading 'createCollection')`.** Mongoose runs
   `Model.init()` at `require` time; with command buffering disabled that ran before any
   connection, failed, and the rejected promise was cached. Fix: `autoCreate`/`autoIndex`
   off and an explicit `ensureSchema()` after connecting.
4. **Wrong test expectation:** a quantity of 999 was rejected with 400 by validation (max
   100), so the transaction-rollback path was never exercised. Changed the test to a
   valid quantity above the available stock.
5. **Duplicate `Strict-Transport-Security` header** (Helmet and Nginx). Nginx now hides the
   app's copy.
6. **Empty 5xx panel/alert** when there were no errors: the series did not exist. Added
   `or vector(0)`.
7. **YAML alias before its anchor** in `docker-compose.yml`. Moved the build definition to
   a top-level `x-app-build` block.
8. **Redirect check in `run-acceptance.ps1`** raised a non-terminating error that
   `$ErrorActionPreference = 'Stop'` would make fatal. Added `-ErrorAction SilentlyContinue`.

### Not verified by the assistant

Real Docker builds and containers, Trivy image CVE scan, Grafana UI, Windows Task
Scheduler, GitHub Actions and GHCR. See the README's verification table.

## Suggested commit plan (owner)

The repository is initialised without commits so that history reflects your own review.
Review each group, then commit it with an honest message, for example:

```powershell
git add package.json package-lock.json .gitignore .gitattributes .nvmrc eslint.config.js jest.config.js
git commit -m "Project setup: dependencies, lint and test configuration (AI-assisted)"
git add src scripts/seed.js scripts/healthcheck.js
git commit -m "Product and order API with transactional, idempotent checkout (AI-assisted)"
git add tests scripts/acceptance
git commit -m "Unit, integration and acceptance tests (AI-assisted)"
git add Dockerfile .dockerignore docker-compose.yml .env.example nginx scripts/mongo
git commit -m "Containerised deployment with Nginx TLS and MongoDB replica set (AI-assisted)"
git add monitoring .github scripts
git commit -m "Monitoring, CI/CD pipeline and operations scripts (AI-assisted)"
git add README.md LEARNING_GUIDE.md PROJECT_WALKTHROUGH.md docs
git commit -m "Documentation, runbook and evidence (AI-assisted)"
```

Later commits for changes you make yourself should describe your own work.
