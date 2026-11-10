# Rollback procedures

There are two independent kinds of rollback. Choose by **what** went wrong.

| Problem | Roll back | Data affected? | Tool |
|---|---|---|---|
| A new release is broken (crashes, errors, slow) | **Application**: run the previous image | No | `deploy.ps1` (automatic), `rollback.ps1` (manual) |
| Data is wrong or lost (bad admin edit, accidental delete, corruption) | **Data**: restore a backup | Yes — changes after the backup are lost | `restore.ps1` |

Never restore data to fix a code problem: you would throw away good orders.

## Why application rollback is safe and fast

- Every build is an **immutable, versioned image**: `ecommerce-api:<version>` and
  `<version>-<git-sha>` (CI also pushes them to GHCR). An old version still exists
  exactly as it was tested.
- Compose reads the tag from `APP_IMAGE_TAG` in `.env`, so switching versions changes
  one line and recreates **only** the `app` container (`--no-deps`): MongoDB, Nginx and
  the data are untouched.
- Every successful deploy is appended to `.deploy-history` (UTC time, tag), which
  `rollback.ps1` reads to find the previous version.
- This release has no schema migrations, so old and new code read the same data. If a
  future release changes the data shape, it must be backward compatible (expand →
  migrate → contract) or rollback must include a data step.

## 1. Deploy with automatic rollback

```powershell
pwsh ./scripts/deploy.ps1 -Tag 1.0.1 -Build
```

1. Builds `ecommerce-api:1.0.1` from the current commit (or pulls it if `-Build` is omitted).
2. Sets `APP_IMAGE_TAG=1.0.1`, runs `docker compose up -d --no-deps --no-build app`.
3. Waits for the container health check **and** `/ready` = 200 through Nginx.
4. Success → records the deploy. Failure → prints the last log lines, switches back to
   the previous tag, waits for health again and exits with code 1.

Downtime: a few seconds while the single app container is replaced.

## 2. Manual rollback

```powershell
pwsh ./scripts/rollback.ps1              # previous tag from .deploy-history
pwsh ./scripts/rollback.ps1 -Tag 1.0.0   # a specific tag
```

Without the scripts (the same steps by hand):

```powershell
docker image ls ecommerce-api                        # which versions exist locally?
# edit .env: APP_IMAGE_TAG=1.0.0
docker compose up -d --no-deps --no-build app
docker compose ps app                                # wait for (healthy)
curl.exe -k https://localhost/health                 # "version" shows the running tag
```

From the registry (after CI has published):

```powershell
# .env: APP_IMAGE=ghcr.io/<owner>/ecommerce-api   APP_IMAGE_TAG=1.0.0-<sha>
pwsh ./scripts/deploy.ps1 -Tag 1.0.0-<sha>          # pulls if not present
```

## 3. Demonstrating rollback (assessment Test 6)

```powershell
pwsh ./scripts/deploy.ps1 -Tag 1.0.0 -Build                         # known-good release
pwsh ./scripts/make-broken-release.ps1 -From 1.0.0 -Tag 1.1.0-broken # simulated bad release
pwsh ./scripts/deploy.ps1 -Tag 1.1.0-broken -TimeoutSec 40           # fails -> automatic rollback
curl.exe -k https://localhost/health                                 # version is 1.0.0 again
```

`make-broken-release.ps1` builds a derived image whose start command exits
immediately, like a release with a fatal startup bug. `run-acceptance.ps1
-IncludeRollback` runs exactly this sequence and records it.

## 4. Data rollback

See [runbook.md → Backup and restore](runbook.md#backup-and-restore).

```powershell
pwsh ./scripts/backup.ps1                       # ALWAYS take a fresh backup first
pwsh ./scripts/restore.ps1 -BackupFile backups/<file>.archive.gz
```

After any rollback: confirm `/ready` = 200, check Grafana for errors, and record the
incident (time, version, cause, action) in `docs/dev-log.md`.
