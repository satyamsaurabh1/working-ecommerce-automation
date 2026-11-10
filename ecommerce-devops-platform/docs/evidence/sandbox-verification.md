# Verification evidence — AI development sandbox

**Where this ran:** the AI assistant's Linux sandbox (Ubuntu 24.04, Node 22.23.4) on
2026-11-09, during development. **Not** on the repository owner's Windows machine and
**not** in Docker (the sandbox has no Docker daemon). Each section states what was real
and what was substituted. Outputs below are copied from the actual runs (trimmed only
where marked `…`).

Substitutions used, and why they are equivalent for what was being tested:

| Real deployment | Sandbox substitute | What is still proven |
|---|---|---|
| `mongo:8.0` container, keyfile auth, replica set | native `mongod` 8.3.7 started with the **same** flags (`--replSet rs0 --keyFile … --auth`), users created by the **same** `scripts/mongo/init-users.js` | auth, least-privilege users, transactions, healthcheck logic |
| `nginxinc/nginx-unprivileged:1.28` | native nginx 1.24 running the **same** `nginx.conf` as a non-root user; two lines changed: upstream `127.0.0.1:3000` instead of `app:3000`, and `listen 8443 ssl http2` (1.24 syntax) instead of `http2 on` (1.25+) | redirect, TLS, headers, `/metrics` block, request-id propagation, JSON 503 |
| `prom/prometheus:v3.5.0` | native Prometheus **3.5.0**, the **same** `alerts.yml`, target `127.0.0.1:3000` | scraping, every dashboard query, alert lifecycle |
| `docker exec`/`docker cp` in backup/restore scripts | a test-double `docker` script mapping those calls to the local `mongod` | the PowerShell scripts' own logic: dump, checksum, manifest, restore, verification |

---

## 1. Automated test suite

```
$ npm run test:coverage
PASS tests/integration/orders.test.js
PASS tests/integration/admin.test.js
PASS tests/integration/products.test.js
PASS tests/integration/health.test.js
PASS tests/unit/config.test.js
PASS tests/unit/request-hash.test.js
Test Suites: 6 passed, 6 total
Tests:       60 passed, 60 total
All files  | 96.86 % stmts | 86.07 % branch | 96.73 % funcs | 98.59 % lines
```

The integration suite was re-run 3 more times to check the concurrency tests for flakiness: `52 passed, 52 total` each time.

Highlights: 20 concurrent same-key checkouts → exactly one 201 and nineteen 200s, one
order, stock deducted once; 30 concurrent buyers for 12 units → exactly 12 orders, stock 0.

## 2. Database bootstrap (mirrors the Mongo container's first start)

```
{ ok: 1 }                                         <- root user created
init-users: created ecommerce_app (readWrite on ecommerce) and ecommerce_backup (backup/restore)
healthcheck attempt 1: unhealthy (exit 1)         <- replica set initiated by healthcheck.js
healthcheck attempt 2: HEALTHY                    <- node is writable PRIMARY
```

## 3. Seed (run twice — must be idempotent), health, Test 1 over HTTP

```
{"event":"seed_products","inserted":8,"alreadyPresent":0}
{"event":"seed_admin","username":"admin","created":true}
{"event":"seed_products","inserted":0,"alreadyPresent":8}
{"event":"seed_admin","username":"admin","created":false}

HTTP/1.1 200 OK   X-Request-Id: ac1dee0f-ddfe-4da3-a169-1d473205af43
{"status":"ok","service":"ecommerce-api","version":"1.0.0-sim","uptimeSeconds":2}
{"status":"ready","checks":{"database":"up"}}

Idempotency acceptance test against http://127.0.0.1:3000
PASS  service is ready  (HTTP 200)
      product MN-27-04, stock before = 12
Sending 10 concurrent + 3 sequential checkouts with Idempotency-Key acceptance-6bd8e43b-…
      statuses: 201,200,200,200,200,200,200,200,200,200,200,200,200
PASS  exactly one request created an order (201)
PASS  all other requests were replays (200)
PASS  every response returned the same order id  (6af1b3a937058d981d4c47fc)
PASS  stock deducted exactly once  (12 -> 10)
PASS  same key + different body is rejected (409)
PASS  rejected reuse did not change stock
RESULT: PASS
```

The API connected as `ecommerce_app` (readWrite only) with keyfile auth enabled.

## 4. Through Nginx with TLS

```
## HTTP -> HTTPS redirect
301 -> https://localhost/api/v1/products
## HTTPS + TLS
200 2 tls-ok                         <- HTTP/2 over TLS
## /metrics blocked publicly
404
## Test 1 through nginx/TLS
PASS … stock deducted exactly once  (10 -> 8) … RESULT: PASS
## nginx JSON access log
{"time":"2026-11-09T11:54:16+00:00","request_id":"9588decff1bf1c277f3fbdb2b51c507a","method":"GET","uri":"/api/v1/products/…","status":200,"duration":0.003,"upstream_status":"200",…}
## same request_id found in app log: 1
```

Defect found here and fixed: two `Strict-Transport-Security` headers (Helmet + Nginx).
After `proxy_hide_header Strict-Transport-Security`: exactly 1.

App stopped with SIGTERM → logs `shutdown_started SIGTERM`, `db_disconnected`,
`shutdown_complete`; Nginx then answered
`{"error":{"code":"SERVICE_UNAVAILABLE",…}}  HTTP 503`.

## 5. Failure drill (Test 5 logic): MongoDB killed

```
## BEFORE           ready=200
## MONGO KILLED     {"status":"not_ready","checks":{"database":"down"}}  ready=503
                    health=200
                    {"error":{"code":"DATABASE_UNAVAILABLE",…}}  products=503
                    app_mongodb_up 0
## RECOVERED 10s after mongod restart, app NOT restarted: ready=200
                    app_mongodb_up 1   products=200
## APP LOG
11:51:50.886Z info db_connected
11:51:53.865Z warn db_disconnected
11:52:12.019Z info db_connected
11:52:12.020Z info db_reconnected
```

## 6. Prometheus: dashboard queries and alert lifecycle

Every query in `monitoring/grafana/dashboards/ecommerce-api.json` was executed against
Prometheus. After generating traffic, for example:

```
Orders created (1h)                     -> 3.42
Idempotent replays (1h)                 -> 41.07
Request rate by status {"status":"200"} -> 1.64 req/s
Latency p50 / p95 / p99                 -> 0.0086 s / 0.0248 s / 0.0625 s
Checkout outcomes {"reason":"idempotency_key_reused"} -> 0.011/s
5xx error ratio                         -> 0
```

Defect found and fixed: the 5xx-ratio query returned **no data** when there were no 5xx
responses (panel blank, alert unable to evaluate). Fixed with `or vector(0)`.

Alert drill:

```
11:56:29 before: none
11:56:30 MONGODB KILLED
11:57:00 +30s: [('DatabaseUnavailable', 'pending')]
11:57:29 +~70s: [('DatabaseUnavailable', 'firing', active since 11:56:46)]
11:57:30 MONGODB RESTARTED
11:57:45 +15s: firing   ready=200
11:58:00 +30s: none     ready=200            <- alert resolved automatically
```

## 7. Backup → data loss → restore (real PowerShell scripts)

```
$ pwsh ./scripts/backup.ps1
[OK]   Backup complete: ecommerce-20261109-120302.archive.gz (2.2 KB)
     documents: {"adminusers":1,"auditevents":0,"orders":6,"products":8}

## DISASTER: dropping products and orders
left: ["auditevents","adminusers"]
## API now reports: {"data":[],"pagination":{…"total":0…}}

$ pwsh ./scripts/restore.ps1 -Force
[OK]   Checksum verified (821918e28871c1a55eeae72f34dd79ec2f84162939087fa9badbaee3f6fb51fb)
[OK]   mongorestore finished
[OK]   adminusers     expected     1  restored     1
[OK]   auditevents    expected     0  restored     0
[OK]   orders         expected     6  restored     6
[OK]   products       expected     8  restored     8
[OK]   API /ready = 200 after restore
[OK]   RESTORE VERIFIED
## API after restore: {'page': 1, 'limit': 1, 'total': 8, 'pages': 8}

## TAMPER TEST: one byte changed in the archive
Checksum mismatch - backup is corrupt. Expected 8219…51fb, got f8d4…1793   <- restore refused
```

Separately, `mongorestore --drop` was confirmed to work with the **backup** user's
`backup`/`restore` roles (no root needed), and the unique `idempotencyKey_1` index was
restored with the data.

## 8. Static validation of deployment files

| Check | Tool | Result |
|---|---|---|
| `docker-compose.yml` | Docker Compose v2.40.3 `config` | valid; 6 services; missing secret → `required variable MONGO_ROOT_PASSWORD is missing a value` |
| `Dockerfile` | hadolint 2.15.1 | clean |
| `nginx/nginx.conf` | `nginx -t` | syntax ok |
| `prometheus.yml`, `alerts.yml` | promtool 3.5.0 | valid, 4 rules |
| `.github/workflows/ci.yml` | actionlint 1.7.12 | clean |
| Repository secrets + Dockerfile misconfig | Trivy 0.76.0 `fs` | Dockerfile: 0 misconfigurations; no secrets |
| 12 PowerShell scripts | PowerShell 7.6.9 parser | all parse; `init-env`, `.env` helpers, HTTP helpers executed |
| Production npm dependencies | `npm audit --omit=dev` | 0 vulnerabilities |

Defect found and fixed here: the acceptance runner's HTTP-redirect check raised a
non-terminating error that `$ErrorActionPreference = 'Stop'` would have turned fatal.

## Not verified here

- Building and running the actual Docker images (no Docker daemon in the sandbox).
- Trivy **image** vulnerability scan (the vulnerability database download was not reachable).
- Grafana rendering (queries were verified; the UI was not).
- Windows-specific behaviour: Task Scheduler registration, Docker Desktop bind mounts.
- GitHub Actions execution and GHCR publishing.

These are covered by `scripts/run-acceptance.ps1` (owner's machine) and the `e2e` CI job.
