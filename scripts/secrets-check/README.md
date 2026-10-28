# secrets-check — validation harness for Soundcheck's production secrets

Run after any secret rotation or deploy. Proves (1) each key is accepted by its issuer and
(2) the running Railway service and the Vercel web app agree with the store.

    pnpm secrets:check -- --railway            # values from Railway (services soundcheck + Redis)
    pnpm secrets:check -- --env-file .env       # a local env file
    pnpm secrets:check -- --railway --live      # also generates one real plan (Anthropic + Qloo spend)
    pnpm secrets:check -- fingerprints --railway --compare .env

Secrets and where they live:

| Secret | Store | Proof |
|---|---|---|
| ANTHROPIC_API_KEY | Railway `soundcheck` | `provider.anthropic`, health `model: true`, `live.generate-plan` |
| QLOO_API_KEY | Railway `soundcheck` | `provider.qloo`, health `qloo: live` |
| REDIS_URL → Redis `REDIS_PASSWORD` | Railway `Redis` (soundcheck references it) | health `kv.status: ok` after redeploying `soundcheck` |
| SOUNDCHECK_ADMIN_TOKEN | Railway `soundcheck` (and whoever runs the seed/flush scripts) | `deployed.railway.admin-token` |

The Vercel project holds no secrets: it proxies to the Railway backend (`SOUNDCHECK_BACKEND_URL`).
After rotating `REDIS_PASSWORD`: redeploy `Redis`, then `soundcheck`, then run this. Exit code 1 on any failure.
Zero dependencies; Node ≥ 20; `railway` CLI only for `--railway`.
