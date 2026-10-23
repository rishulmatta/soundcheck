// Soundcheck production secrets (Railway service `soundcheck` + Vercel web `soundcheck`).
import { http, expect, syncFromStatus, redisPing, Inconclusive } from './lib.mjs'

const railway = (e) => `https://${e.RAILWAY_PUBLIC_DOMAIN ?? 'soundcheck-production-0c8e.up.railway.app'}`
const vercel = (e) => (e.SOUNDCHECK_WEB_URL ?? 'https://soundcheck-amber-two.vercel.app').replace(/\/$/, '')

export const checks = [
  // provider: the key is accepted by its issuer
  { id: 'provider.anthropic', group: 'provider', needs: ['ANTHROPIC_API_KEY'], run: async (e) => { const r = expect(await http('https://api.anthropic.com/v1/models?limit=1', { headers: { 'x-api-key': e.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' } }), 200); return `models ok (${r.json?.data?.[0]?.id ?? '?'})` } },
  { id: 'provider.qloo', group: 'provider', needs: ['QLOO_API_KEY'], run: async (e) => { const base = (e.QLOO_BASE_URL ?? 'https://hackathon.api.qloo.com').replace(/\/$/, ''); const r = await http(`${base}/search?query=jazz&take=1`, { headers: { 'X-Api-Key': e.QLOO_API_KEY } }); if ([401, 403].includes(r.status)) throw new Error(`Qloo rejected the key (HTTP ${r.status})`); expect(r, 200); return `search ok (${base})` } },
  { id: 'provider.redis', group: 'provider', needs: ['REDIS_URL'], run: async (e) => { const url = e.REDIS_PUBLIC_URL ?? e.REDIS_URL; if (/railway\.internal/.test(url)) throw new Inconclusive('Railway-internal Redis; deployed.railway.health proves it from inside'); return redisPing(url) } },

  // deployed: the running services agree with the store
  { id: 'deployed.railway.health', group: 'deployed', run: async (e) => { const r = expect(await http(`${railway(e)}/api/health`), 200); const h = r.json; if (!h.ok || h.kv?.status !== 'ok' || h.qloo !== 'live' || !h.model) throw new Error(JSON.stringify(h)); return `kv ${h.kv.kind} ok, qloo ${h.qloo}, anthropic key present, seeded ${Object.values(h.seeded).filter(Boolean).length}/${Object.keys(h.seeded).length}` } },
  { id: 'deployed.railway.admin-token', group: 'deployed', needs: ['SOUNDCHECK_ADMIN_TOKEN'], run: async (e) => {
      const url = `${railway(e)}/api/plan/secrets-check-probe` // a plan id that never exists; deleting it is a no-op
      const wrong = await http(url, { method: 'DELETE', headers: { Authorization: 'Bearer secrets-check-wrong-token' } })
      if (wrong.status === 404) throw new Inconclusive('service answers 404 to a wrong token: SOUNDCHECK_ADMIN_TOKEN is not configured on the running service (or it was redeployed without it)')
      if (wrong.status !== 401) throw new Error(`unexpected ${wrong.status} for a wrong token`)
      return syncFromStatus(await http(url, { method: 'DELETE', headers: { Authorization: `Bearer ${e.SOUNDCHECK_ADMIN_TOKEN}` } }), [200, 404], 'admin DELETE') } },
  { id: 'deployed.vercel.health', group: 'deployed', run: async (e) => { const r = expect(await http(`${vercel(e)}/api/health`), 200); return `web up (${r.json.kv ? 'has its own kv' : 'proxying to backend'})` } },
  { id: 'deployed.vercel.backend-proxy', group: 'deployed', run: async (e) => { const r = expect(await http(`${vercel(e)}/api/plan/demo-musician`), 200); return `web → Railway backend serves the seeded plan (${r.json?.brief?.name ?? r.json?.id ?? 'ok'})` } },

  // live: costs money / mutates
  { id: 'live.generate-plan', group: 'live', live: true, run: async (e) => { const r = await http(`${railway(e)}/api/plan`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brief: 'secrets-check: a short jazz set for a 40-seat room' }), timeoutMs: 120000 }); if (r.status === 429) throw new Inconclusive('plan concurrency/start cap reached'); expect(r, [200, 201, 202]); return `plan generated (Anthropic + Qloo end to end), id ${r.json?.id ?? '?'}` } },
]
