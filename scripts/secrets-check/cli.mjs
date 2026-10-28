#!/usr/bin/env node
// pnpm secrets:check -- --railway | --env-file .env | fingerprints --railway --compare .env   (see README.md)
import { checks } from './checks.mjs'
import { runChecks, report, parseArgs, loadEnvFile, railwayVars, fp } from './lib.mjs'
const RAILWAY = { project: '6fc189d7-bc86-415f-88a7-6d1139fea26d', environment: 'production', services: ['soundcheck', 'Redis'] } // soundcheck
const SECRET_KEY = /SECRET|TOKEN|KEY|PASSWORD|REDIS_URL/
const args = parseArgs(process.argv.slice(2))
if (args.help) { console.log((await import('node:fs')).readFileSync(new URL('./README.md', import.meta.url), 'utf8')); process.exit(0) }
function load(source, file) {
  if (source === 'railway') { let env = {}; for (const svc of RAILWAY.services) { const v = railwayVars({ ...RAILWAY, service: svc }); env = svc === RAILWAY.services[0] ? { ...v, ...env } : { ...env, ...Object.fromEntries(Object.entries(v).filter(([k]) => !(k in env))) } } return env }
  if (source === 'file') return loadEnvFile(file)
  return { ...process.env }
}
const env = load(args.source, args.file)
console.log(`secrets-check · source=${args.source}${args.file ? ` (${args.file})` : ''} · ${Object.keys(env).length} vars`)
if (args.fingerprints) {
  const other = process.argv.includes('--compare') ? loadEnvFile(process.argv[process.argv.indexOf('--compare') + 1]) : null
  for (const k of Object.keys(env).filter((k) => SECRET_KEY.test(k) && !k.startsWith('RAILWAY_')).sort()) { const a = fp(env[k]), b = other ? fp(other[k]) : null; console.log(`${k.padEnd(32)} ${a}${other ? `  ${b}  ${a === b ? 'same' : other[k] ? 'DIFFERENT' : 'missing'}` : ''}`) }
  process.exit(0)
}
const results = await runChecks(checks, env, args)
process.exit(report(results, args) ? 0 : 1)
