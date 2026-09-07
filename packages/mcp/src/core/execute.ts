/**
 * Execute a tool by issuing the matching HTTP request to the Abund.ai API.
 */

import type { ToolDef } from './types.js'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>
export type ReadFileLike = (path: string) => Promise<Uint8Array>

export interface ExecuteOptions {
  fetch: FetchLike
  /** e.g. https://api.abund.ai/api/v1 (the /api/v1 prefix is stripped from paths) */
  baseUrl: string
  apiKey?: string | undefined
  /** Only available on the local (stdio) server — enables file_path uploads */
  readFile?: ReadFileLike | undefined
  userAgent?: string | undefined
}

export interface ExecuteResult {
  status: number
  ok: boolean
  body: unknown
  contentType: string | null
}

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  webm: 'audio/webm',
  m4a: 'audio/mp4',
  mp4: 'audio/mp4',
  aac: 'audio/aac',
  flac: 'audio/flac',
}

function mimeFor(name: string, explicit?: unknown): string {
  if (typeof explicit === 'string' && explicit) return explicit
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  return MIME_BY_EXT[ext] ?? 'application/octet-stream'
}

/** Build the request URL: origin from baseUrl, path from the OpenAPI template */
export function buildUrl(
  baseUrl: string,
  def: ToolDef,
  args: Record<string, unknown>
): string {
  const origin = new URL(baseUrl).origin
  let path = def.path
  for (const name of def.pathParams) {
    path = path.replace(
      `{${name}}`,
      encodeURIComponent(String(args[name] ?? ''))
    )
  }
  const url = new URL(path, origin)
  for (const name of def.queryParams) {
    const value = args[name]
    if (value === undefined || value === null || value === '') continue
    url.searchParams.set(name, String(value))
  }
  return url.toString()
}

export async function executeTool(
  def: ToolDef,
  rawArgs: Record<string, unknown> | undefined,
  options: ExecuteOptions
): Promise<ExecuteResult> {
  const args = rawArgs ?? {}
  const missing = def.pathParams.filter(
    (p) => args[p] === undefined || args[p] === ''
  )
  if (missing.length > 0) {
    return {
      status: 400,
      ok: false,
      contentType: 'application/json',
      body: {
        success: false,
        error: `Missing required argument(s): ${missing.join(', ')}`,
      },
    }
  }

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'User-Agent': options.userAgent ?? 'abundai-mcp',
  }
  if (options.apiKey) headers['Authorization'] = `Bearer ${options.apiKey}`

  let body: BodyInit | undefined

  if (def.bodyKind === 'json') {
    const payload: Record<string, unknown> = {}
    for (const name of def.bodyParams) {
      if (args[name] !== undefined) payload[name] = args[name]
    }
    headers['Content-Type'] = 'application/json'
    body = JSON.stringify(payload)
  } else if (def.bodyKind === 'multipart') {
    const form = new FormData()
    for (const name of def.bodyParams) {
      if (args[name] !== undefined) form.set(name, String(args[name]))
    }
    const filePath = args['file_path']
    const fileBase64 = args['file_base64']
    let bytes: Uint8Array | null = null
    let fileName =
      typeof args['file_name'] === 'string' ? args['file_name'] : 'upload'

    if (typeof filePath === 'string' && filePath) {
      if (!options.readFile) {
        return {
          status: 400,
          ok: false,
          contentType: 'application/json',
          body: {
            success: false,
            error: 'file_path is not supported on the hosted MCP server',
            hint: 'Use file_base64 + file_name instead, or run the local server (npx abundai-mcp)',
          },
        }
      }
      bytes = await options.readFile(filePath)
      if (typeof args['file_name'] !== 'string')
        fileName = filePath.split(/[\\/]/).pop() ?? 'upload'
    } else if (typeof fileBase64 === 'string' && fileBase64) {
      const clean = fileBase64.replace(/^data:[^;]+;base64,/, '')
      bytes = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0))
    }

    if (!bytes) {
      return {
        status: 400,
        ok: false,
        contentType: 'application/json',
        body: {
          success: false,
          error: 'Provide file_path or file_base64 for this upload',
        },
      }
    }

    const blob = new Blob([bytes as BlobPart], {
      type: mimeFor(fileName, args['file_type']),
    })
    form.set(def.fileField ?? 'file', blob, fileName)
    body = form
  }

  const response = await options.fetch(buildUrl(options.baseUrl, def, args), {
    method: def.method.toUpperCase(),
    headers,
    ...(body !== undefined ? { body } : {}),
  })

  const contentType = response.headers.get('content-type')
  let parsed: unknown
  const text = await response.text()
  if (contentType?.includes('application/json')) {
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = text
    }
  } else {
    parsed = text
  }

  return { status: response.status, ok: response.ok, body: parsed, contentType }
}
