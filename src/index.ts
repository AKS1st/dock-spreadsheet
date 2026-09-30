import { open } from 'node:fs/promises'
import { extname, isAbsolute, resolve } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'

export const name = 'dock-spreadsheet'
export const inject = ['webServer', 'webRuntime']
export const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_REQUEST_BYTES = 8192
const EXTENSIONS = new Set(['.xlsx', '.xls', '.ods', '.csv', '.tsv'])

interface Context {
  webServer: { register(options: { kind: 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }): () => void }
  webRuntime: { trustedHosts: readonly string[] }
  effect(fn: () => void | (() => void), label?: string): void
}

export class ReadError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message) }
}

function trusted(req: IncomingMessage, trustedHosts: readonly string[]): boolean {
  const host = req.headers.host
  if (!host || req.headers['sec-fetch-site'] === 'cross-site') return false
  let target: URL
  try { target = new URL(`http://${host}`) } catch { return false }
  const octets = target.hostname.split('.')
  const loopback = target.hostname === 'localhost' || target.hostname === '[::1]'
    || (octets.length === 4 && octets[0] === '127'
      && octets.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255))
  const allowed = trustedHosts.some((entry) => {
    try {
      const configured = new URL(`http://${entry}`)
      return configured.host === target.host || (!configured.port && configured.hostname === target.hostname)
    } catch { return false }
  })
  if (!loopback && !allowed) return false
  if (typeof req.headers.origin === 'string') {
    try { if (new URL(req.headers.origin).host !== target.host) return false } catch { return false }
  }
  return true
}

function fail(res: ServerResponse, status: number, code: string, message: string): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify({ ok: false, error: { code, message } }))
}

async function requestPath(req: IncomingMessage): Promise<string> {
  let body = ''
  for await (const chunk of req) {
    body += Buffer.from(chunk).toString('utf8')
    if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) throw new ReadError(413, 'too-large', 'request too large')
  }
  let path: unknown
  try { path = (JSON.parse(body) as { path?: unknown }).path } catch { throw new ReadError(400, 'bad-request', 'invalid JSON request') }
  if (typeof path !== 'string' || !isAbsolute(path) || !EXTENSIONS.has(extname(path).toLowerCase())) {
    throw new ReadError(400, 'bad-request', 'absolute spreadsheet path required')
  }
  return resolve(path)
}

export async function readSpreadsheet(path: string): Promise<Buffer> {
  const file = await open(path, 'r')
  try {
    const info = await file.stat()
    if (!info.isFile()) throw new ReadError(400, 'bad-request', 'not a regular file')
    if (info.size > MAX_FILE_BYTES) throw new ReadError(413, 'too-large', 'spreadsheet exceeds 20 MiB limit')
    const bytes = await file.readFile()
    if (bytes.length > MAX_FILE_BYTES) throw new ReadError(413, 'too-large', 'spreadsheet exceeds 20 MiB limit')
    return bytes
  } finally { await file.close() }
}

export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'prefix', path: '/dock-spreadsheet',
    handler: async (req, res) => {
      if (!trusted(req, ctx.webRuntime.trustedHosts)) return fail(res, 403, 'forbidden', 'forbidden')
      if (req.method !== 'POST' || new URL(req.url ?? '/', 'http://dsh.internal').pathname !== '/dock-spreadsheet/read') {
        return fail(res, 404, 'not-found', 'unknown route')
      }
      try {
        const path = await requestPath(req)
        const bytes = await readSpreadsheet(path)
        res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
        res.end(bytes)
      } catch (cause) {
        if (cause instanceof ReadError) fail(res, cause.status, cause.code, cause.message)
        else fail(res, 400, 'fs-error', cause instanceof Error ? cause.message : 'read failed')
      }
    },
  }), 'dock-spreadsheet: read route')
}
