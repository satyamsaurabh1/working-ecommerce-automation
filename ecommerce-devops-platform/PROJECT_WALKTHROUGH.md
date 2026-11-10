# Project walkthrough

Every important file, in a sensible reading order. For each: what it does, what to
notice, and what you could be asked. Concepts are explained in [LEARNING_GUIDE.md](LEARNING_GUIDE.md).

```
src/
  server.js            start-up and graceful shutdown
  app.js               builds the Express app (middleware order)
  config/              env.js (validated config), db.js (connection, schema, readiness)
  routes/index.js      every URL, its validation and its auth
  controllers/         thin HTTP layer
  services/            business logic  <- most important
  models/              Mongoose schemas and indexes
  middleware/          auth, validation, logging/metrics, errors
  validators/          Zod schemas for every input
  utils/               logger, metrics, errors, request hash
  data/                seed catalogue
tests/                 unit + integration (60 tests)
scripts/               seed, health probe, acceptance, ops (PowerShell), mongo/
nginx/ monitoring/ .github/  Dockerfile  docker-compose.yml
```

Layering rule: **routes → controllers → services → models**. Controllers know HTTP and
nothing about MongoDB; services know the business rules and nothing about HTTP.

---

## Application

### `src/server.js`
Loads config (exits on invalid config), creates the logger, connects to MongoDB, starts
listening. Handles `SIGTERM`/`SIGINT`: stop accepting connections, let in-flight requests
finish, close the DB pool, exit. A 10 s timer forces exit if something hangs.
*Ask yourself:* why does `docker stop` not lose in-flight orders? (graceful shutdown + `init: true` forwards the signal).

### `src/app.js`
Middleware order: `helmet` (security headers) → `cors` (allow-list) → request logger →
metrics → JSON body parser (100 kB limit) → routes → 404 → error handler.
`trust proxy = 1`: there is exactly one proxy (Nginx), so the client IP is taken from it —
needed for correct rate limiting. Exported as a function so tests can build the app without a port.

### `src/config/env.js`
A Zod schema for all environment variables with defaults. `JWT_SECRET` must be ≥ 32
characters; `MONGO_URI` must look like a MongoDB URI. Error messages name the variable
but **never print its value**. The config object is frozen.

### `src/config/db.js`
- `bufferCommands: false` — if MongoDB is down, queries fail immediately (→ clean 503) instead of hanging.
- `autoCreate/autoIndex: false` + `ensureSchema()` — collections and indexes are created
  explicitly after connecting (see dev-log problem 3). The unique idempotency index must exist before the first order.
- `isDatabaseReady()` — readiness = connected **and** a `ping` answers within 1 s.
- Connection events (`db_disconnected`, `db_reconnected`) are logged; you saw them in the failure drill.

### `src/routes/index.js`
The whole API on one screen: each route lists its validation and auth. All `/admin/*`
routes pass `requireAuth` **and** `requireRole('admin')`. The login route has its own
rate limiter. `/metrics` is served here but blocked by Nginx.

### `src/validators/schemas.js`
Zod schemas. `z.strictObject` rejects unknown fields, so a client cannot add
`"discount": 100`, and a value like `{"$gt": 0}` fails the `number` check — which blocks
NoSQL operator injection. Quantities: whole numbers 1–100, max 20 lines per order.
Stock updates are a **discriminated union**: `set` needs `quantity`, `adjust` needs a non-zero `delta`; both need a `reason`.

### `src/services/order-service.js`
The core of the domain marks. Read `createOrder` slowly:
1. Hash the body (`request-hash.js`: sorted keys, SHA-256).
2. Fast path: an order with this key exists → return it (or 409 if the hash differs).
3. Merge duplicate product lines.
4. Inside `session.withTransaction(...)`: for each product, the conditional
   `findOneAndUpdate({ _id, active: true, stock: { $gte: q } }, { $inc: { stock: -q } })`.
   `returnDocument: 'before'` gives the pre-update document, which becomes the snapshot
   (`stockAtCheckout`, `unitPrice`). `null` means missing/inactive (404) or insufficient (409)
   — throwing inside the callback **aborts** the transaction, undoing earlier lines.
5. Insert the order in the same transaction.
6. `catch` duplicate-key error `11000` on `idempotencyKey`: a concurrent identical
   request won; return its order.

`withTransaction` also retries automatically on transient write conflicts (two buyers
updating the same product at once). `updateOrderStatus` applies the state machine from
`models/order.js` and restores stock on cancellation, with an audit event, in one transaction.

### `src/services/admin-product-service.js`
`withAudit()` runs a change **and** its audit event in one transaction: there can be no
change without a record. Negative stock adjustments use the same conditional-filter trick
as checkout. Duplicate SKU → 409.

### `src/services/auth-service.js`
bcrypt cost 12. When the username does not exist the password is still compared against
a dummy hash, so both failure cases take the same time and return the same message
(no username enumeration). The JWT has subject, role, issuer, audience and expiry.

### `src/middleware/auth.js`
`requireAuth` accepts only `Bearer` tokens and verifies with `algorithms: ['HS256']`
plus issuer and audience — blocking the classic "alg: none" attack. `requireRole` is
authorization (401 = who are you? 403 = you may not).

### `src/middleware/request-context.js`
pino-http logger. Request id = incoming `X-Request-Id` (from Nginx) if it is safe
(8–64 chars of `A-Za-z0-9_-`), otherwise a new UUID; echoed in the response. Only
method, URL, status and remote address are logged — never bodies. The metrics
middleware labels by **route template** (`/api/v1/products/:id`), not the raw URL, so
the number of time series stays small.

### `src/middleware/error-handler.js`
Maps known errors to status codes (AppError, invalid JSON 400, body too large 413,
DB unavailable 503). Everything else is logged in full and returned as a generic 500
with the request id — no stack traces to clients.

### `src/models/*.js`
Schemas and indexes; see [architecture.md](docs/architecture.md#data-model). `price` and
`stock` must be integers; `stock` has `min: 0` as a second line of defence.

### `src/utils/metrics.js`
Dedicated Prometheus registry: default process metrics (prefixed `ecommerce_`), HTTP
counter + latency histogram, business counters (orders created, idempotent replays,
rejections by reason) and the `app_mongodb_up` gauge, computed at scrape time.

---

## Tests

| File | Covers |
|---|---|
| `tests/helpers/global-setup.js` | Starts one real `mongod` replica set for the run |
| `tests/helpers/test-app.js` | Per-file database, app instance, token helper, cleanup between tests |
| `tests/integration/orders.test.js` | Snapshot, totals, atomic rollback, validation, **Test 1** (sequential + 20 concurrent same key), 30 buyers for 12 units, status API |
| `tests/integration/admin.test.js` | Login, bcrypt storage, rate limit, 401/403 cases, audited updates, negative-stock guard, order state machine, cancel restocks |
| `tests/integration/products.test.js` | List, search (incl. regex injection), filters, pagination, 400/404 |
| `tests/integration/health.test.js` | Health/ready/metrics, headers, CORS, **DB disconnect → 503 → recovery** |
| `tests/unit/*.test.js` | Config validation, request hashing |

`scripts/acceptance/idempotency-check.js` is the same idea as Test 1 but against the
**deployed** stack through Nginx; `run-acceptance.ps1` uses it.

---

## Containers and deployment

### `Dockerfile`
Two stages. `deps`: `npm ci --omit=dev --ignore-scripts` (exact versions, no dev tools,
no install scripts). `runtime`: `apk upgrade` (OS patches), npm removed, only `src/`,
the seed and the health probe copied, owned by `node`, `USER 1000:1000`, `HEALTHCHECK`
using Node itself (no curl needed). OCI labels record version and git SHA.

### `docker-compose.yml`
Read the header comment first (networks). Things to be able to explain:
- `mongo`'s `command` generates a keyfile then hands over to the official entrypoint,
  which creates the root user, runs `init-users.js` **on the first start only**, and drops root.
- `mongo`'s healthcheck runs `scripts/mongo/healthcheck.js`: initiates the replica set
  on first run, then is healthy only as a writable PRIMARY. `$$VAR` is expanded inside the container.
- `seed` → `app` → `nginx` start order through `depends_on` conditions.
- `app` hardening: `read_only`, `tmpfs /tmp`, `cap_drop: ALL`, `no-new-privileges`, `init`.
- `${VAR:?…}` makes missing secrets a startup error.
- Prometheus/Grafana bound to `127.0.0.1`; log rotation (`max-size 10m`) on every service.

### `nginx/nginx.conf`
Port 8080: health endpoint + redirect. Port 8443: TLS, headers, `proxy_hide_header` for
the app's HSTS, `/metrics` 404, login `limit_req`, proxy with request id, JSON error
page for 502/503/504, JSON access log.

### `scripts/mongo/`
`init-users.js` (app user `readWrite` on one DB, backup user `backup`+`restore`),
`healthcheck.js`, `count-docs.js` (used by backup/restore verification).

---

## CI/CD — `.github/workflows/ci.yml`
Four jobs; read the header comment. Notable details: SHA-pinned actions, read-only
default token, the tag/version consistency check, the non-root image check, Trivy's two
scans, the image passed between jobs as an artifact (so e2e tests **exactly** the
scanned image), the e2e job using the same PowerShell scripts as you, and GHCR push
only from `main`/tags.

## Monitoring — `monitoring/`
`prometheus/prometheus.yml` (scrape targets), `prometheus/alerts.yml` (4 rules with
runbook links), `grafana/provisioning/*` (data source + dashboard loader),
`grafana/dashboards/ecommerce-api.json` (12 panels).

## Operations scripts — `scripts/*.ps1`

| Script | Purpose |
|---|---|
| `lib/common.psm1` | Shared helpers: `.env` read/write, HTTP status checks, waits, `Invoke-Native`, `Invoke-MongoScript` |
| `init-env.ps1` | `.env` with random hex secrets; will not overwrite |
| `generate-certs.ps1` | Self-signed cert via a throwaway container, or `-UseMkcert` |
| `backup.ps1` / `restore.ps1` | Verified backup and restore (checksum + manifest) |
| `register-backup-task.ps1` | Daily Windows scheduled task |
| `deploy.ps1` / `rollback.ps1` | Tag-based deploy with health gate and automatic rollback |
| `make-broken-release.ps1` | Demo-only broken image for the rollback drill |
| `failure-drill.ps1` | Test 5: stop MongoDB, show detection, recover |
| `security-scan.ps1` | Trivy image + repository scan |
| `run-acceptance.ps1` | Tests 1, 4, 5, 6 with an evidence transcript |

## Exercises to prove you understand it

1. Add a `brand` field to products: model, validator, seed, a test. Run `npm test`.
2. Add a Prometheus gauge counting products with stock below 5, and a Grafana panel for it.
3. Break `nginx.conf` on purpose, run `docker compose exec nginx nginx -t`, read the error, fix it.
4. Remove the `stock: { $gte: q }` condition and watch which test fails — then explain why.
5. Bump the version to 1.0.1, deploy it with `deploy.ps1`, roll back with `rollback.ps1`.
