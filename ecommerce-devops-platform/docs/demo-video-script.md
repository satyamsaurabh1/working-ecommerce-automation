# Demo video script (about 4½ minutes)

**Before recording:** stack running and healthy (`docker compose ps`), Grafana open on the
"E-Commerce API – Service Overview" dashboard (time range 15 min), Prometheus `/alerts`
open in a tab, a large terminal font, and a fresh backup taken. Run each command once
beforehand so images are cached. Speak in your own words; the lines below are a guide.

Show only real output. If something fails while recording, keep it in and show how you
diagnose it — that is a strong demonstration in itself.

| Time | Show on screen | Say |
|---|---|---|
| **0:00–0:25** | README architecture diagram | "This is a Product and Order API for the Algions DevOps assessment. Clients only reach Nginx over HTTPS; the Node API and a MongoDB replica set sit on private Docker networks; Prometheus and Grafana monitor it; GitHub Actions builds, scans and tests every change." |
| **0:25–0:55** | `docker compose ps` · `curl.exe -k https://localhost/health` · `curl.exe -k https://localhost/ready` · `curl.exe -I http://localhost/health` | "Six services, all healthy. `/health` says the process is alive; `/ready` also checks the database. Plain HTTP is redirected to HTTPS." |
| **0:55–1:45** | `node scripts/acceptance/idempotency-check.js` (with `$env:INSECURE_TLS='1'`) | "Test 1. Thirteen checkouts with the same Idempotency-Key, ten of them at the same moment. Exactly one 201, twelve replays, one order id, stock deducted once — and reusing the key with a different body is rejected. A unique index, an atomic conditional stock update and a transaction guarantee this." |
| **1:45–2:10** | `docker compose logs --tail 5 app` · Grafana dashboard | "Logs are structured JSON with a request id that also appears in the Nginx log. The dashboard shows traffic, errors, latency, and the orders and idempotent replays we just created." |
| **2:10–3:05** | `pwsh ./scripts/failure-drill.ps1` · then Prometheus `/alerts` | "Test 5. I stop MongoDB. Readiness drops to 503, the API answers with a clean 503 rather than hanging, and after 30 seconds the DatabaseUnavailable alert fires. When MongoDB is back the API reconnects by itself — I never restart it — and the alert resolves." |
| **3:05–3:50** | `pwsh ./scripts/backup.ps1` → drop data (or `run-acceptance.ps1 -SkipFailureDrill` section 6a) → `pwsh ./scripts/restore.ps1 -Force` | "Test 6. A backup with a checksum and a manifest of document counts. I simulate data loss — the catalogue is empty — then restore. The script verifies the checksum, restores, and proves every collection count matches." |
| **3:50–4:15** | `pwsh ./scripts/make-broken-release.ps1 -From <tag> -Tag broken` · `pwsh ./scripts/deploy.ps1 -Tag broken -TimeoutSec 40` | "Application rollback. I deploy a release that crashes on startup. It never becomes healthy, so the deploy script automatically switches back to the previous image tag. The data is not touched." |
| **4:15–4:40** | GitHub → Actions → a green run (jobs + summary with image tag and digest) | "Test 3. Every push runs lint, 60 tests, the image build with version and commit tags, Trivy scans, and then this whole stack on a clean runner with the acceptance tests, before publishing to GHCR." |
| **4:40–4:50** | README "Known limitations" | "Limits I'm aware of: a single database node and a single app replica — the next step would be a three-node replica set and rolling deploys." |

**Checklist after recording:** the GitHub run and digest shown are real; no `.env`
contents, tokens or passwords appear on screen (do not `cat .env`); the video is 3–5 minutes.
