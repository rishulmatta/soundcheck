// Secrets-check harness core. Zero dependencies, Node >= 20.
// A check is { id, group, needs: [ENV...], run(env, ctx) -> detail|throws, manual?: string, live?: boolean }.
// Status: pass | fail | skip (missing env) | manual (cannot be verified from here) | inconclusive.
import { createHash, createHmac, createSign } from 'node:crypto'
import net from 'node:net'
import tls from 'node:tls'
import https from 'node:https'
import { spawnSync } from 'node:child_process'

export const fp = (v) => (v ? createHash('sha256').update(String(v)).digest('hex').slice(0, 8) : '-')
export class Inconclusive extends Error {}
export class Manual extends Error {}

export async function http(url, { method = 'GET', headers = {}, body, timeoutMs = 15000 } = {}) {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), timeoutMs)
  try {
    const res = await fetch(url, { method, headers, body, signal: ctl.signal, redirect: 'manual' })
    const text = await res.text()
    let json
    try { json = JSON.parse(text) } catch { /* not json */ }
    return { status: res.status, text, json, headers: res.headers }
  } finally { clearTimeout(t) }
}

export function expect(res, codes, label = '') {
  const ok = (Array.isArray(codes) ? codes : [codes]).includes(res.status)
  if (!ok) throw new Error(`${label}HTTP ${res.status}: ${res.text.slice(0, 160).replace(/\s+/g, ' ')}`)
  return res
}

/** Classify a probe against a service that verifies a shared secret: 401/403 = out of sync. */
export function syncFromStatus(res, okCodes, what) {
  if ([401, 403].includes(res.status)) throw new Error(`${what}: HTTP ${res.status} — the running service does not accept the value in the store (out of sync)`)
  expect(res, okCodes, `${what}: `)
  return `HTTP ${res.status} (secret accepted)`
}

export function signHmacTicket(secret, claims) {
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url')
  return `${payload}.${createHmac('sha256', secret).update(payload).digest('base64url')}`
}

/** Raw WebSocket upgrade; resolves with the HTTP status the server answered (101 = accepted). */
export function wsUpgradeStatus(url, { timeoutMs = 10000 } = {}) {
  const u = new URL(url)
  return new Promise((resolve, reject) => {
    const req = https.request({
      host: u.hostname, port: u.port || 443, path: u.pathname + u.search, method: 'GET',
      headers: { Connection: 'Upgrade', Upgrade: 'websocket', 'Sec-WebSocket-Version': '13', 'Sec-WebSocket-Key': Buffer.from(String(Date.now())).toString('base64') },
      timeout: timeoutMs,
    })
    req.on('upgrade', (res, socket) => { socket.destroy(); resolve(101) })
    req.on('response', (res) => { res.resume(); resolve(res.statusCode) })
    req.on('timeout', () => { req.destroy(new Error('timeout')) })
    req.on('error', reject)
    req.end()
  })
}

/** Redis AUTH + PING over raw RESP (redis:// or rediss://). */
export function redisPing(url, { timeoutMs = 8000 } = {}) {
  const u = new URL(url)
  const user = decodeURIComponent(u.username || 'default'), pass = decodeURIComponent(u.password || '')
  const enc = (...args) => `*${args.length}\r\n` + args.map((a) => `$${Buffer.byteLength(a)}\r\n${a}\r\n`).join('')
  return new Promise((resolve, reject) => {
    const sock = (u.protocol === 'rediss:' ? tls : net).connect({ host: u.hostname, port: Number(u.port || 6379), servername: u.hostname })
    let buf = ''
    const done = (err, val) => { sock.destroy(); err ? reject(err) : resolve(val) }
    sock.setTimeout(timeoutMs, () => done(new Error('timeout')))
    sock.on('error', done)
    sock.on('connect', () => sock.write((pass ? enc('AUTH', user, pass) : '') + enc('PING')))
    sock.on('data', (d) => {
      buf += d.toString()
      if (buf.includes('-NOAUTH') || buf.includes('-WRONGPASS') || buf.includes('-ERR')) return done(new Error(buf.trim().split('\r\n').find((l) => l.startsWith('-'))))
      if (buf.includes('+PONG')) done(null, 'PONG')
    })
  })
}

/** Postgres SELECT 1 via the psql CLI (libpq handles SSL/pooler quirks). */
export function pgSelect1(url) {
  const r = spawnSync('psql', [url, '-Atc', 'select current_user, current_database()'], { encoding: 'utf8', timeout: 20000 })
  if (r.error) throw new Manual('psql not installed — install libpq or check DATABASE_URL by hand')
  if (r.status !== 0) throw new Error(r.stderr.trim().split('\n').pop())
  return r.stdout.trim()
}

/** IMAP LOGIN over TLS (port 993). */
export function imapLogin(host, user, pass, { timeoutMs = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    const sock = tls.connect({ host, port: 993, servername: host })
    let buf = '', sent = false
    const done = (err, val) => { try { sock.write('a2 LOGOUT\r\n') } catch {} sock.destroy(); err ? reject(err) : resolve(val) }
    sock.setTimeout(timeoutMs, () => done(new Error('timeout')))
    sock.on('error', done)
    sock.on('data', (d) => {
      buf += d.toString()
      if (!sent && buf.startsWith('* OK')) { sent = true; sock.write(`a1 LOGIN "${user}" "${pass.replace(/"/g, '\\"')}"\r\n`); buf = ''; return }
      if (/^a1 OK/m.test(buf)) done(null, 'LOGIN OK')
      else if (/^a1 (NO|BAD)/m.test(buf)) done(new Error(buf.match(/^a1 (NO|BAD).*/m)[0]))
    })
  })
}

/** Google service-account JSON -> OAuth2 access token (RS256 JWT bearer grant). */
export async function gcpAccessToken(saJson, scope = 'https://www.googleapis.com/auth/cloud-platform') {
  const sa = typeof saJson === 'string' ? JSON.parse(saJson) : saJson
  const now = Math.floor(Date.now() / 1000)
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope, aud: sa.token_uri, iat: now, exp: now + 300 })}`
  const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url')
  const res = await http(sa.token_uri, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${unsigned}.${sig}` })
  expect(res, 200, 'token: ')
  return { token: res.json.access_token, email: sa.client_email, keyId: sa.private_key_id }
}

/** AWS SigV4 GET (used for Cloudflare R2's S3 API). */
export async function s3Get({ endpoint, region = 'auto', accessKeyId, secretAccessKey, path = '/', query = '' }) {
  const u = new URL(endpoint)
  const amz = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = amz.slice(0, 8)
  const h = (k, d) => createHmac('sha256', k).update(d).digest()
  const hex = (d) => createHash('sha256').update(d).digest('hex')
  const canonical = ['GET', path, query, `host:${u.host}\nx-amz-content-sha256:${hex('')}\nx-amz-date:${amz}\n`, 'host;x-amz-content-sha256;x-amz-date', hex('')].join('\n')
  const scope = `${date}/${region}/s3/aws4_request`
  const sts = `AWS4-HMAC-SHA256\n${amz}\n${scope}\n${hex(canonical)}`
  const kSign = h(h(h(h(`AWS4${secretAccessKey}`, date), region), 's3'), 'aws4_request')
  const sig = createHmac('sha256', kSign).update(sts).digest('hex')
  return http(`${u.origin}${path}${query ? `?${query}` : ''}`, { headers: { 'x-amz-date': amz, 'x-amz-content-sha256': hex(''), Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${sig}` } })
}

export function cli(cmd, args, { timeout = 60000 } = {}) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', timeout })
  if (r.error) throw new Manual(`${cmd} not installed`)
  return { status: r.status, stdout: r.stdout, stderr: r.stderr }
}

// ---------- runner ----------
export async function runChecks(checks, env, { only, group, live = false, concurrency = 8 } = {}) {
  const selected = checks.filter((c) => (!only || c.id.includes(only)) && (!group || c.group === group) && (live || !c.live))
  const results = []
  let i = 0
  const worker = async () => {
    while (i < selected.length) {
      const c = selected[i++]
      const t0 = Date.now()
      const r = { id: c.id, group: c.group, status: 'pass', detail: '', ms: 0 }
      const missing = (c.needs ?? []).filter((k) => !env[k])
      if (missing.length) { r.status = 'skip'; r.detail = `not set: ${missing.join(', ')}` }
      else if (c.manual && !c.run) { r.status = 'manual'; r.detail = c.manual }
      else {
        try { r.detail = (await c.run(env, { live })) ?? 'ok' } catch (e) {
          r.status = e instanceof Manual ? 'manual' : e instanceof Inconclusive ? 'inconclusive' : 'fail'
          r.detail = e.message
        }
      }
      r.ms = Date.now() - t0
      results.push(r)
    }
  }
  await Promise.all(Array.from({ length: concurrency }, worker))
  return results.sort((a, b) => selected.findIndex((c) => c.id === a.id) - selected.findIndex((c) => c.id === b.id))
}

export function report(results, { json } = {}) {
  const icon = { pass: '✅', fail: '❌', skip: '⏭️ ', manual: '📝', inconclusive: '❔' }
  let lastGroup
  for (const r of results) {
    if (r.group !== lastGroup) { console.log(`\n## ${r.group}`); lastGroup = r.group }
    console.log(`${icon[r.status]} ${r.id.padEnd(34)} ${String(r.ms).padStart(5)}ms  ${r.detail}`)
  }
  const n = (s) => results.filter((r) => r.status === s).length
  console.log(`\n${n('pass')} pass, ${n('fail')} FAIL, ${n('inconclusive')} inconclusive, ${n('manual')} manual, ${n('skip')} skipped`)
  if (json) { import('node:fs').then((fs) => fs.writeFileSync(json, JSON.stringify({ at: new Date().toISOString(), results }, null, 2))) }
  return n('fail') === 0
}

export function parseArgs(argv) {
  const o = { source: 'env' }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--only') o.only = argv[++i]
    else if (a === '--group') o.group = argv[++i]
    else if (a === '--live') o.live = true
    else if (a === '--json') o.json = argv[++i]
    else if (a === '--env-file') { o.source = 'file'; o.file = argv[++i] }
    else if (a === '--railway') o.source = 'railway'
    else if (a === 'fingerprints') o.fingerprints = true
    else if (a === '--help' || a === '-h') o.help = true
  }
  return o
}

export function loadEnvFile(path) {
  const out = {}
  for (const line of require('node:fs').readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/)
    if (!m) continue
    let v = m[2].trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    out[m[1]] = v
  }
  return out
}
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)

/** Pull a Railway service's resolved variables (needs the railway CLI logged in). */
export function railwayVars({ project, environment = 'production', service }) {
  const r = cli('railway', ['variable', 'list', '-p', project, '-e', environment, '-s', service, '--json'])
  if (r.status !== 0) throw new Error(`railway variable list ${service}: ${r.stderr.trim()}`)
  return JSON.parse(r.stdout)
}
