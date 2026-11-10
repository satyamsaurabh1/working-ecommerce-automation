# Technical interview preparation

Concept definitions and ten scenario answers are in [LEARNING_GUIDE.md §5–§6](../LEARNING_GUIDE.md#5-definitions-to-know).
This guide covers how to prepare, design-defence questions, and live-debugging practice.

## Be honest about how it was built

You will be asked what you built. A strong, honest answer: *"I used an AI assistant to
generate the first version. Then I ran it myself, broke it on purpose, read every file,
and made these changes myself: …"* Fill in the dots with real work from your
`docs/dev-log.md`. Never claim you wrote code you did not. Evaluators usually test
understanding by asking you to change something live; preparation beats any claim.

## Seven-day plan

| Day | Goal | Proof you are ready |
|---|---|---|
| 1 | Run it: fresh clone → `init-env` → `generate-certs` → `docker compose up -d --build`; run `run-acceptance.ps1` | Your own evidence log in `docs/evidence/` |
| 2 | Read `src/` in the walkthrough order | Explain `createOrder` line by line without notes |
| 3 | Docker and Compose | Draw the networks from memory; explain each `depends_on` condition and each hardening option |
| 4 | Push to GitHub, get CI green | Explain each job; find the image digest in the summary |
| 5 | Monitoring and failure | Run `failure-drill.ps1`; write one PromQL query yourself |
| 6 | Backup, restore, rollback | Do both kinds of rollback by hand, without scripts |
| 7 | Practice | Do the five exercises in `PROJECT_WALKTHROUGH.md` and the drills below; record the demo video |

## Your two-minute project pitch (outline)

1. Problem: a small product/order API whose real goal is reliable delivery and operation.
2. Correctness: idempotent, transactional checkout — no duplicate orders, no negative stock, proven under concurrency.
3. Delivery: versioned immutable images; CI lints, tests, scans and runs the whole stack before publishing.
4. Operation: HTTPS proxy, least-privilege networks and users, metrics and alerts, verified backups, one-command rollback.
5. Limits and next steps: single node, single replica → three-node replica set, rolling deploys, off-host backups.

## Design-defence questions

Prepare a reason **and** a trade-off for each.

1. Why MongoDB transactions? What do they cost? *(Replica set needed; slightly slower writes; retries on conflicts.)*
2. Why return 200 (not 201 or 409) for an idempotent replay? *(The client gets the same result as the first call; 409 is reserved for a key reused with a different body.)*
3. Where does the idempotency key come from and how long is it valid? *(Client-generated UUID; here it never expires — a TTL index would be the production choice.)*
4. Why `/health` and `/ready` separately? What would go wrong with one endpoint?
5. Why is MongoDB on an internal network? How do backups reach it then?
6. Why three database users? What can the app user **not** do?
7. Why PowerShell scripts instead of Bash? *(Same scripts on Windows and CI.)*
8. Why pin actions by SHA and Trivy by version? What is the maintenance cost?
9. Why save the image as a CI artifact instead of rebuilding in each job?
10. Why `--ignore-unfixed` in Trivy? What is the risk?
11. Why are prices integers?
12. What happens to in-flight requests during `docker compose stop`?
13. What is your RPO and RTO, and how would you improve them?
14. Why no Kubernetes?
15. If two admins edit the same product at the same moment, what happens? *(Last write wins on the changed fields; both are audited. Optimistic concurrency with a version field would prevent lost updates.)*

## Live-debugging drills

Have a friend break one thing without telling you (or pick one at random). Diagnose it
with the runbook method: observe → narrow → read the exact error → fix → verify.

| # | How to break it | What you should find |
|---|---|---|
| 1 | Delete `JWT_SECRET` from `.env`, `docker compose up -d app` | Compose refuses: `required variable JWT_SECRET is missing` |
| 2 | Set `JWT_SECRET=short` | App restart loop; log `Invalid configuration -> JWT_SECRET: must be at least 32 characters` |
| 3 | `docker compose stop mongo` | `/ready` 503, `DatabaseUnavailable` alert, app recovers after `start` |
| 4 | Change `proxy_pass $upstream` to a wrong port, `nginx -s reload` | JSON 503 from Nginx while the app is healthy → the proxy is the problem |
| 5 | Delete `nginx/certs/*`, restart nginx | Nginx exits; log: cannot load certificate |
| 6 | Change `MONGO_APP_PASSWORD` in `.env` after first start | `Authentication failed` — users were created with the old password on first start |
| 7 | Remove `stock: { $gte: quantity }` in `order-service.js`, `npm test` | Negative-stock concurrency test fails — explain why |
| 8 | Remove `unique: true` from `idempotencyKey`, `npm test` | Concurrent idempotency test can create duplicates |
| 9 | Add a lint error and push | CI `quality` job fails; nothing is built or published |
| 10 | Deploy `make-broken-release.ps1` output | `deploy.ps1` rolls back automatically |

## Commands to know by heart

```powershell
docker compose ps
docker compose logs --tail 50 -f app
docker compose up -d --no-deps app
docker compose exec nginx nginx -t
docker inspect --format '{{json .State.Health}}' ecommerce-mongo
docker exec -it ecommerce-mongo mongosh -u root -p <password> --authenticationDatabase admin
curl.exe -k https://localhost/ready
pwsh ./scripts/backup.ps1 ; pwsh ./scripts/restore.ps1
pwsh ./scripts/rollback.ps1
npm test
```
