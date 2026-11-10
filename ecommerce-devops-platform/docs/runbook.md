# Operations runbook

Commands are for PowerShell 7 in the repository root. Use `curl.exe` (not `curl`) on Windows.

## Contents

- [Start, stop, restart](#start-stop-restart)
- [Health model](#health-model)
- [First response checklist](#first-response-checklist)
- Alerts: [API down](#api-down) · [Database down](#database-down) · [High error rate](#high-error-rate) · [Slow requests](#slow-requests)
- [Backup and restore](#backup-and-restore) · [Backup schedule](#backup-schedule)
- [Deploy and roll back](#deploy-and-roll-back)
- [Security scanning](#security-scanning)
- [Troubleshooting reference](#troubleshooting-reference)

---

## Start, stop, restart

| Goal | Command |
|---|---|
| First start on a new machine | `pwsh ./scripts/init-env.ps1; pwsh ./scripts/generate-certs.ps1; docker compose up -d --build` |
| Status and health | `docker compose ps` |
| Stop (keep containers and data) | `docker compose stop` |
| Start again | `docker compose start` |
| Restart one service | `docker compose restart app` |
| Rebuild after code changes | `docker compose up -d --build app` |
| Remove containers, keep data | `docker compose down` |
| Remove everything incl. data | `docker compose down -v` ⚠ destructive |

Startup order is enforced by health checks: `mongo` (healthy = writable primary) →
`seed` (must exit 0) → `app` (healthy) → `nginx`. First start takes about 60 s because
the replica set is initiated.

## Health model

| Signal | Meaning | Who uses it |
|---|---|---|
| `GET /health` = 200 | Process alive and serving. Does **not** check MongoDB, so a DB outage does not make Docker treat the app as broken | Docker `HEALTHCHECK` |
| `GET /ready` = 200 / 503 | Can serve real traffic (MongoDB answers a ping in < 1 s) | Humans, deploy script, acceptance tests |
| `up{job="ecommerce-api"}` | Prometheus can scrape the app | `ApiDown` alert |
| `app_mongodb_up` | App's own view of its DB connection | `DatabaseUnavailable` alert |
| Mongo container health | Replica set initiated and this node is PRIMARY | Compose `depends_on` |

## First response checklist

1. `docker compose ps` — which container is not `running (healthy)`? Note restart counts.
2. `curl.exe -k https://localhost/ready` — 200, 503 (DB problem) or 502/503 from Nginx (app problem)?
3. http://localhost:9090/alerts — what is firing, and since when?
4. Logs of the suspect service: `docker compose logs --tail 100 <service>`.
5. Fix using the matching section below; confirm with `/ready` and the Grafana dashboard.
6. Write down what happened (time, cause, fix) in `docs/dev-log.md`.

Useful log filters:

```powershell
docker compose logs app --since 10m | Select-String '"level":"(error|warn)"'
docker compose logs app | Select-String '<request-id>'          # one request end-to-end
docker compose logs nginx | Select-String '"status":5'
```

Every response carries `X-Request-Id`; the same id appears in the Nginx access log and
the app log, so a user-reported error can be traced end-to-end.

---

## API down

**Alert:** `ApiDown` (Prometheus cannot scrape the app for 30 s). **Symptom:** Nginx returns
`503 SERVICE_UNAVAILABLE`.

```powershell
docker compose ps app
docker compose logs --tail 50 app
```

| Log shows | Cause | Fix |
|---|---|---|
| `Invalid configuration -> JWT_SECRET: …` | Missing/invalid environment variable | Fix `.env`, then `docker compose up -d app` |
| `startup failed` + `MongoServerSelectionError` | DB not reachable at startup | See [Database down](#database-down); the app restarts automatically (`restart: unless-stopped`) |
| `Authentication failed` | `.env` passwords differ from the users created when the volume was first initialised | Restore the original `.env`, or (data loss!) `docker compose down -v` and start fresh |
| Container exits immediately after a deploy | Bad release | `pwsh ./scripts/rollback.ps1` |

## Database down

**Alert:** `DatabaseUnavailable` (`app_mongodb_up == 0` for 30 s). **Symptom:** `/ready` = 503,
data endpoints return `503 DATABASE_UNAVAILABLE`, `/health` still 200.

```powershell
docker compose ps mongo
docker compose logs --tail 50 mongo
docker compose start mongo                                       # if stopped
docker inspect --format '{{json .State.Health}}' ecommerce-mongo  # healthcheck history
```

The app reconnects by itself once MongoDB is back (observed: about 10 s); do **not**
restart the app. Rehearse with `pwsh ./scripts/failure-drill.ps1`.

If MongoDB will not start: check free disk space (`docker system df`), then the log for
`WiredTiger` errors. If data files are damaged, restore the latest backup into a fresh
volume (see below).

## High error rate

**Alert:** `HighServerErrorRate` (> 5 % of responses are 5xx for 2 min).

1. Grafana → "Request rate by status" and "5xx error ratio": which status, since when?
2. `docker compose logs app --since 15m | Select-String '"level":"error"'` — read the `err` object.
3. If it started with a deploy: `pwsh ./scripts/rollback.ps1`.
4. If it is `DATABASE_UNAVAILABLE`: follow [Database down](#database-down).

## Slow requests

**Alert:** `SlowRequests` (p95 > 1 s for 5 min).

1. Grafana → latency panel and "Event loop lag": event-loop lag means CPU-bound work in Node; otherwise suspect the DB.
2. `docker stats` — CPU/memory of `ecommerce-app` and `ecommerce-mongo`.
3. Slow DB operations: `docker compose logs mongo | Select-String 'Slow query'`.

---

## Backup and restore

| Action | Command |
|---|---|
| Back up now | `pwsh ./scripts/backup.ps1` |
| Restore latest (asks to confirm) | `pwsh ./scripts/restore.ps1` |
| Restore a specific file | `pwsh ./scripts/restore.ps1 -BackupFile backups/ecommerce-20261109-020000.archive.gz` |

A backup produces three files in `./backups/`: the gzip archive, a `.sha256` checksum
and a `.manifest.json` with document counts. `restore.ps1` refuses a backup whose
checksum does not match, restores with `--drop`, then compares every collection's count
with the manifest and checks `/ready`.

The dump runs **online** (no downtime) as `ecommerce_backup`, which has only the
`backup`/`restore` roles. Credentials never leave the container: the scripts reference
`$MONGO_BACKUP_PASSWORD` inside `sh -c '…'` so it is expanded by the container's shell.

**Recovery objectives (local setup):** RPO ≤ 24 h with the daily schedule (run
`backup.ps1` before risky changes); RTO a few minutes for this data size.

**Full rebuild from a backup** (e.g. corrupted volume, new machine):

```powershell
docker compose down -v                    # only if the old data is unusable
docker compose up -d --build              # fresh, seeded database
pwsh ./scripts/restore.ps1 -BackupFile <file> -Force
```

Keep the original `.env` with the backups: the restored admin password hash only
matches the old `ADMIN_PASSWORD`.

## Backup schedule

```powershell
pwsh ./scripts/register-backup-task.ps1                 # daily 02:00, 7-day retention
Start-ScheduledTask -TaskName ecommerce-mongodb-backup  # run once now to test
Get-Content backups/backup-task.log -Tail 20
pwsh ./scripts/register-backup-task.ps1 -Unregister     # remove
```

The task runs as the current user (no admin rights needed) and only if Docker Desktop
is running. Production would also copy backups off the machine (object storage) and
test a restore regularly; here `run-acceptance.ps1` performs the restore test.

---

## Deploy and roll back

See [rollback.md](rollback.md). Short form:

```powershell
pwsh ./scripts/deploy.ps1 -Tag 1.0.1 -Build    # auto-rolls back if 1.0.1 is not healthy
pwsh ./scripts/rollback.ps1                    # back to the previous tag
```

## Security scanning

```powershell
docker compose build app
pwsh ./scripts/security-scan.ps1 -Image ecommerce-api:local
npm audit --omit=dev
```

The same Trivy version runs in CI. For a finding: if a fixed version exists, update the
base image (`docker compose build --pull app`) or the dependency; if not, record it in
`docs/dev-log.md` with its risk assessment (CI ignores unfixed findings by design).

---

## Troubleshooting reference

| Problem | Diagnosis | Fix |
|---|---|---|
| `bind: address already in use` on 80/443 | `Get-NetTCPConnection -LocalPort 443 -State Listen` | Stop the other program or set `HTTP_PORT=8080`, `HTTPS_PORT=8443` in `.env` |
| `required variable … is missing a value` | `.env` missing or incomplete | `pwsh ./scripts/init-env.ps1` |
| Nginx exits: `cannot load certificate` | `nginx/certs` empty | `pwsh ./scripts/generate-certs.ps1` |
| `mongo` unhealthy for minutes | `docker inspect --format '{{json .State.Health}}' ecommerce-mongo` | Usually first-start initiation; if `Authentication failed`, see API down table |
| `app` waits forever | `docker compose logs seed` | Seed must exit 0; read its JSON error |
| Browser certificate warning | Self-signed cert | Expected; or `generate-certs.ps1 -UseMkcert -Force` |
| Scripts: "running scripts is disabled" | Execution policy | Run them as `pwsh ./scripts/x.ps1`, or `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned` |
| `.sh`/JS errors like `\r: command not found` | CRLF line endings | `.gitattributes` enforces LF; re-clone or `git add --renormalize .` |
| `npm test` fails downloading MongoDB | First run downloads a mongod binary | Needs internet once; it is cached afterwards |
