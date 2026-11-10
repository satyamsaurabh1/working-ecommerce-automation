# Learning guide

This guide explains every technology in the project: what it is, why it is here, the
commands you need, and how it fails. Read it alongside
[PROJECT_WALKTHROUGH.md](PROJECT_WALKTHROUGH.md), which goes file by file.

**Suggested order:** §1 big picture → run the stack → §2 one technology at a time (try
each "commands" block) → §4 troubleshooting → §5–§6 interview practice.

---

## 1. The big picture: one request's journey

You run `curl.exe -k https://localhost/api/v1/products`:

1. Windows sends the request to port **443**, which Docker Desktop forwards to the
   **Nginx** container (port 8443 inside, because Nginx runs as a non-root user that
   may not bind ports below 1024).
2. Nginx completes the **TLS handshake** with the certificate in `nginx/certs`, creates
   a request id, and forwards plain HTTP to `http://app:3000`. The name `app` is
   resolved by **Docker's built-in DNS** on the `edge` network.
3. The **Express** app logs the request as JSON, validates the input with **Zod**, and
   asks **MongoDB** (`mongo:27017` on the `data` network) for products, connecting as
   the `ecommerce_app` user.
4. The response goes back the same way. The `X-Request-Id` header and the log lines in
   both Nginx and the app share the same id.
5. Separately, every 10 s **Prometheus** fetches `http://app:3000/metrics` over the
   `monitoring` network, and **Grafana** draws charts from Prometheus.

And a code change's journey: `git push` → **GitHub Actions** lints and tests it → builds
a **Docker image** tagged with the version and commit → **Trivy** scans it → a clean
runner starts the whole stack and runs the acceptance tests → the image is pushed to
**GHCR** → you deploy that tag with `deploy.ps1`, and roll back with `rollback.ps1`.

---

## 2. Technologies

### Node.js 22 + Express 5

- **What:** Node runs JavaScript outside a browser; Express is a minimal web framework (routing + middleware).
- **Why here:** your chosen stack; small, readable, widely used for APIs.
- **Key idea, middleware:** each request passes through a chain of functions
  (`helmet → cors → logger → metrics → json parser → router → error handler`). Each can
  modify the request, respond, or call `next()`. Order matters.
- **Express 5 detail:** if an `async` handler throws, Express 5 forwards the error to the
  error handler automatically. That is why controllers have no `try/catch`.
- **Node 22:** an LTS (long-term support) release. Node 20 reached end of life in April
  2026, so it no longer receives security fixes.
- **Commands:** `npm ci` (install exactly the lockfile), `npm run dev` (auto-restart), `npm run lint`, `npm test`.
- **Fails like:** `Cannot find module` (run `npm ci`); `EADDRINUSE` (port taken); unhandled promise rejections (logged).

### MongoDB 8 and Mongoose

- **What:** a document database; Mongoose adds schemas, validation and models in Node.
- **Why a replica set of one?** Multi-document **transactions** require a replica set.
  Checkout changes several product documents and inserts an order; a transaction makes
  that all-or-nothing.
- **Indexes:** a *unique* index on `orders.idempotencyKey` is what makes duplicate
  orders impossible; the database rejects a second insert with error code `11000`.
- **Atomic conditional update:** `findOneAndUpdate({ _id, stock: { $gte: q } }, { $inc: { stock: -q } })`
  checks and decrements in one operation, so two buyers can never both take the last unit.
- **Auth:** keyfile authentication (required when a replica set uses access control); three users with different roles.
- **Commands:**
  ```powershell
  docker exec -it ecommerce-mongo mongosh -u root -p <MONGO_ROOT_PASSWORD> --authenticationDatabase admin
  # inside mongosh:
  rs.status().members[0].stateStr     # PRIMARY
  use ecommerce
  db.products.find({}, {sku:1, stock:1})
  db.orders.getIndexes()
  ```
- **Fails like:** `MongoServerSelectionError` (not reachable), `Authentication failed`
  (password differs from when the volume was created), `NotYetInitialized` (replica set
  not initiated yet — the healthcheck does it).

### Jest, Supertest, mongodb-memory-server

- **Jest:** test runner. **Supertest:** sends HTTP requests straight to the Express app
  object, with no real server or port. **mongodb-memory-server:** downloads and starts
  a real `mongod` (as a replica set) for the tests, then deletes it.
- **Why real MongoDB and not mocks?** Idempotency and stock safety rely on the database
  (unique index, transactions). A mock would not prove them.
- **Unit vs integration:** `tests/unit` tests pure functions; `tests/integration` tests
  HTTP → service → database. Acceptance tests (`scripts/acceptance`, `run-acceptance.ps1`) test the deployed system.
- **Note:** tests start Node with `--experimental-vm-modules` — see `docs/dev-log.md`, problem 2.

### Docker and the Dockerfile

- **Image:** a read-only template (OS files + Node + our code). **Container:** a running
  instance of an image. **Layer:** each Dockerfile instruction adds a cached layer.
- **Multi-stage build:** stage `deps` installs packages with npm; stage `runtime` copies
  only the result and **removes npm**, so the final image has no package manager.
- **Layer caching:** `package*.json` is copied before the source, so code changes do not
  re-download dependencies.
- **Non-root:** `USER 1000:1000`. If an attacker breaks into the app, they are not root
  inside the container.
- **HEALTHCHECK:** Docker runs `node scripts/healthcheck.js` every 10 s; three failures mark the container `unhealthy`.
- **Commands:**
  ```powershell
  docker build -t ecommerce-api:dev .
  docker image ls ecommerce-api
  docker history ecommerce-api:dev                         # layers and sizes
  docker run --rm ecommerce-api:dev id                     # uid=1000(node)
  docker inspect --format '{{.Config.User}}' ecommerce-api:dev
  ```

### Docker Compose

- **What:** describes several containers, their networks, volumes and start order in one YAML file.
- **`depends_on` with conditions:** `service_healthy` waits for a health check,
  `service_completed_successfully` waits for a one-shot job (our `seed`) to exit 0.
- **Networks:** containers on the same network reach each other by **service name**.
  `internal: true` (our `data` network) means no route to the host or internet.
- **Volumes:** named volumes (`mongo-data`) survive `docker compose down`; only `down -v` deletes them.
- **Interpolation:** `${JWT_SECRET:?set in .env}` stops Compose with an error if the variable is missing — fail fast instead of an empty password.
- **Commands:** `docker compose config` (shows the final resolved file), `ps`, `logs -f app`, `exec app sh`, `up -d --no-deps app`.

### Nginx (reverse proxy) and HTTPS/TLS

- **Reverse proxy:** clients talk only to Nginx; Nginx forwards to the app. One public
  entry point for TLS, headers, rate limits and access control.
- **TLS:** encrypts traffic and proves the server's identity with a certificate. We use
  a **self-signed** certificate (browsers warn because no trusted authority signed it)
  or **mkcert**, which installs a local authority on your PC so the browser trusts it.
- **In our config:** HTTP→HTTPS redirect, TLS 1.2/1.3 only, HSTS, `/metrics` returns
  404, login limited to 5/min per IP, JSON access logs, and a JSON 503 when the app is down.
- **`resolver 127.0.0.11` + `set $upstream`:** Nginx looks up `app` at request time, so it
  starts (and answers 503) even if the app is down, instead of crashing.
- **Commands:** `docker compose exec nginx nginx -t` (test config), `docker compose exec nginx nginx -s reload`, `curl.exe -kv https://localhost/health` (see the TLS handshake).

### GitHub Actions (CI/CD)

- **CI (continuous integration):** every push is automatically built and tested.
  **CD (continuous delivery):** every passing build produces a deployable, versioned artifact.
- **Workflow → jobs → steps.** Jobs run on fresh virtual machines ("runners"); `needs:` orders them; artifacts pass files between them.
- **Our pipeline:** quality → build (image + Trivy) → e2e (whole stack, acceptance tests) → publish (GHCR).
- **Security:** actions pinned to commit SHAs; `permissions: contents: read` by default;
  only `publish` gets `packages: write`; GHCR login uses the built-in, short-lived `GITHUB_TOKEN`.
- **Versioning:** `package.json` version + short commit SHA, e.g. `1.0.0-3f2a9c1`. A git tag `v1.0.0` must match `package.json`.

### Trivy

- **What:** a free scanner for known vulnerabilities (CVEs) in OS packages and libraries,
  secrets accidentally committed, and insecure Dockerfile settings.
- **`--ignore-unfixed`:** only fail on problems that have a fix available — otherwise a
  base image with an unfixable CVE would block every build.
- **Pinned version:** Trivy's own release channels were targeted by a supply-chain
  attack in 2026; pinning a known version and updating deliberately is the safe practice.
- **Command:** `pwsh ./scripts/security-scan.ps1 -Image ecommerce-api:local`.

### Prometheus, Grafana, structured logs

- **Metrics** (numbers over time) answer "how much / how fast / how often".
  **Logs** (events) answer "what exactly happened to this request".
- **Prometheus** *pulls* metrics: every 10 s it fetches `/metrics`. Metric types:
  **counter** (only goes up: `http_requests_total`), **gauge** (up and down:
  `app_mongodb_up`), **histogram** (buckets for latency percentiles).
- **PromQL examples:** `rate(http_requests_total[1m])` = requests per second;
  `histogram_quantile(0.95, …)` = p95 latency.
- **Alert rules** have a `for:` hold time: the condition must last (e.g. 30 s) before the
  alert fires, which avoids noise from blips. States: inactive → pending → firing.
- **Grafana:** dashboards and the Prometheus data source are **provisioned from files**, so they exist on first start.
- **Golden signals:** traffic, errors, latency, saturation — the dashboard has a panel for each.
- **Structured logs (pino):** one JSON object per line with `level`, `time`, `service`,
  `version`, `req.id`. Easy to filter. Secrets are redacted.

### Backups: mongodump / mongorestore

- **mongodump** exports the database while it runs (logical backup); **mongorestore** imports it.
- Our backup adds a **SHA-256 checksum** (detects a corrupted or altered file) and a
  **manifest** of document counts (lets restore *prove* it worked).
- **RPO** (Recovery Point Objective): how much data you may lose — up to 24 h with daily backups.
  **RTO** (Recovery Time Objective): how long recovery takes — minutes here.
- **A backup you have never restored is not a backup.** The acceptance test restores one.

### PowerShell 7

- Cross-platform shell. All ops scripts use it so the **same** scripts run on Windows and
  on the Linux CI runner. Windows ships with Windows PowerShell 5.1; install 7 with
  `winget install Microsoft.PowerShell` and run scripts with `pwsh`.
- `$ErrorActionPreference = 'Stop'` makes errors stop the script; native programs such
  as `docker` do not raise PowerShell errors, so `Invoke-Native` checks `$LASTEXITCODE`.

---

## 3. How the components communicate

| From | To | Address | Network | Protocol / auth |
|---|---|---|---|---|
| You | Nginx | `https://localhost` (443 → 8443) | host port | HTTPS |
| Nginx | App | `http://app:3000` | edge | HTTP (inside Docker) |
| App, seed | MongoDB | `mongo:27017` | data (internal) | MongoDB wire protocol, user `ecommerce_app` |
| Prometheus | App | `http://app:3000/metrics` | monitoring | HTTP pull |
| Grafana | Prometheus | `http://prometheus:9090` | monitoring | HTTP |
| You | Grafana / Prometheus | `localhost:3001` / `localhost:9090` | host (127.0.0.1 only) | HTTP |
| Scripts | MongoDB | `docker exec ecommerce-mongo …` | — | backup user from the container's env |

---

## 4. Troubleshooting method

Use the same steps every time, and say them out loud in a live debugging round:

1. **Observe:** `docker compose ps` — what is not healthy? Any restart loops?
2. **Narrow down:** follow the request path: Nginx → app → MongoDB. `/health` checks the app process, `/ready` adds the DB.
3. **Read the exact error:** `docker compose logs --tail 50 <service>`.
4. **Form one hypothesis**, change one thing, re-test.
5. **Verify** with `/ready`, the dashboard and the acceptance script; **write down** the cause.

| Symptom | Most likely cause | First command |
|---|---|---|
| `curl: (7) Failed to connect` | Nginx not running or port conflict | `docker compose ps nginx` |
| 503 `SERVICE_UNAVAILABLE` (from Nginx) | App container down/restarting | `docker compose logs app` |
| 503 `DATABASE_UNAVAILABLE` (from app) | MongoDB down | `docker compose ps mongo` |
| App restarting in a loop | Bad config or bad release | `docker compose logs app \| Select-Object -First 5` |
| 401 on admin routes | Missing/expired token | log in again |
| 409 `INSUFFICIENT_STOCK` | Working as intended | check product stock |

---

## 5. Definitions to know

| Term | One-sentence definition |
|---|---|
| Idempotency | Doing the same request several times has the same effect as doing it once. |
| Idempotency key | A client-chosen unique id sent with a request so the server can recognise retries. |
| Transaction (ACID) | A group of operations that commit together or not at all (Atomic, Consistent, Isolated, Durable). |
| Race condition | A bug where the result depends on the timing of concurrent operations. |
| Replica set | A group of mongod processes holding the same data; one PRIMARY accepts writes. |
| Container vs VM | A container shares the host kernel and isolates processes; a VM runs its own kernel. |
| Image layer | A cached filesystem change produced by one Dockerfile instruction. |
| Multi-stage build | Several `FROM` stages in one Dockerfile; only the last ships, keeping it small. |
| Reverse proxy | A server that receives client requests and forwards them to backend servers. |
| TLS termination | Decrypting HTTPS at the proxy and forwarding plain HTTP internally. |
| Liveness vs readiness | Liveness: is the process alive? Readiness: can it serve traffic now? |
| CI / CD | Automatically build and test every change / always have a deployable, versioned artifact. |
| Immutable artifact | A build output that is never changed after creation; new code means a new version. |
| Rollback | Returning to a previous known-good version. |
| RPO / RTO | Maximum acceptable data loss / maximum acceptable recovery time. |
| Least privilege | Give each user/process only the permissions it needs. |
| Defence in depth | Several independent security layers, so one failure is not fatal. |
| CVE | A publicly catalogued security vulnerability. |
| Supply-chain attack | Compromising software through a dependency, build tool or action rather than directly. |
| JWT | A signed token carrying claims (user, role, expiry) that the server can verify without a session store. |
| bcrypt | A deliberately slow password-hashing function with a built-in salt. |
| CORS | Browser rule controlling which websites may call an API from JavaScript. |
| SLI / SLO | A measured service indicator (e.g. p95 latency) / the target for it. |
| p95 latency | 95 % of requests are faster than this value. |
| Structured logging | Logs as machine-readable fields (JSON) rather than free text. |

---

## 6. Scenario questions with suggested answers

Answer in your own words; these are outlines.

**Q1. A customer double-clicks "Pay". What happens?**
Both requests carry the same `Idempotency-Key`. The first creates the order (201). The
second either finds the existing order and returns it (200), or, if it arrived at the
same instant, its insert fails on the unique index; its transaction is rolled back and
it returns the winner's order. Stock is deducted once. Tests cover 20 concurrent duplicates.

**Q2. Why not check stock first and then save the new value?**
Between the read and the write another request can read the same stock; both pass the
check and stock goes negative. The conditional `$inc` does the check and the update
atomically in the database.

**Q3. MongoDB crashes in production. Walk me through it.**
Within about 30 s `DatabaseUnavailable` fires; `/ready` returns 503; data endpoints return
a clean 503; `/health` stays 200 so Docker does not restart the app. I check `docker compose
ps mongo` and its logs, start it (or restore a backup if data is damaged). The app
reconnects by itself — no restart needed. I verify `/ready`, the dashboard, and record the incident.

**Q4. A release is broken. What do you do?**
`deploy.ps1` already rolls back automatically if the new version is not healthy within
the timeout. If the problem shows up later, `rollback.ps1` redeploys the previous
immutable image tag — only the app container changes, the data is untouched. Then I
investigate the bad version from its logs.

**Q5. Someone deleted products by mistake. Is that a rollback?**
That is a **data** problem, so: take a fresh backup of the current state, then
`restore.ps1` the last good backup, which verifies the checksum and document counts.
Orders placed after that backup would be lost, so I would consider restoring into a
separate database and copying only the missing products.

**Q6. How are secrets handled?**
They are generated per machine into `.env`, which git ignores. Compose refuses to start
if one is missing. They reach containers as environment variables, logs redact them,
backup commands read them inside the container, and CI uses the built-in GitHub token.
In production I would use a secret manager (e.g. Vault, cloud secrets, Docker secrets).

**Q7. Why is the image non-root and read-only, and what else hardens it?**
If the app is compromised, the attacker has no root, cannot write to the filesystem,
has no Linux capabilities, and has no package manager to install tools. MongoDB is not
reachable from outside Docker at all.

**Q8. The CI build fails on Trivy. What now?**
Read the report artifact: package, CVE, fixed version. Usually rebuild with a patched
base image (`--pull`) or update the dependency. If no fix exists yet, it does not fail
(`--ignore-unfixed`); I would document the risk.

**Q9. How do you know the backups work?**
Each backup has a checksum and a manifest; the restore script verifies both and checks
`/ready`. The acceptance test deletes data and restores it. A one-byte change to an
archive was shown to be rejected.

**Q10. How would you make this highly available?**
A three-member replica set on separate hosts, several stateless app replicas behind the
proxy, rolling deploys, off-host backups and a real alert channel — on a managed
platform in production.
