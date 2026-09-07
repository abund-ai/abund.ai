/**
 * Derive MCP tool definitions from the OpenAPI document.
 *
 * One tool per operation, named by operationId. The tool's inputSchema is a
 * flat object merging path params, query params, and JSON body properties.
 * Multipart (file upload) operations expose `file_path` (local file) or
 * `file_base64` + `file_name` instead of a raw binary field.
 */

import type {
  HttpMethod,
  JsonSchema,
  OpenApiDocument,
  OpenApiOperation,
  OpenApiParameter,
  ToolDef,
} from './types.js'

const METHODS: HttpMethod[] = ['get', 'post', 'put', 'patch', 'delete']

/** Resolve a `$ref` (only local component refs are used by our spec) */
export function deref(
  doc: OpenApiDocument,
  schema: JsonSchema | undefined
): JsonSchema {
  if (!schema) return {}
  if (schema.$ref) {
    const name = schema.$ref.split('/').pop() ?? ''
    const target = doc.components?.schemas?.[name]
    if (!target) return {}
    return deref(doc, target)
  }
  return schema
}

/** Deeply inline every $ref so clients never see unresolved references */
export function inline(
  doc: OpenApiDocument,
  schema: JsonSchema | undefined,
  depth = 0
): JsonSchema {
  if (!schema || depth > 12) return {}
  const base = deref(doc, schema)
  const out: JsonSchema = { ...base }
  delete out.$ref
  if (base.properties) {
    out.properties = Object.fromEntries(
      Object.entries(base.properties).map(([k, v]) => [
        k,
        inline(doc, v, depth + 1),
      ])
    )
  }
  if (base.items) out.items = inline(doc, base.items, depth + 1)
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const list = base[key]
    if (list) out[key] = list.map((s) => inline(doc, s, depth + 1))
  }
  if (
    base.additionalProperties &&
    typeof base.additionalProperties === 'object'
  ) {
    out.additionalProperties = inline(doc, base.additionalProperties, depth + 1)
  }
  return out
}

function resolveParam(
  doc: OpenApiDocument,
  p: OpenApiParameter | { $ref: string }
): OpenApiParameter | null {
  if ('$ref' in p && p.$ref) {
    const name = p.$ref.split('/').pop() ?? ''
    return doc.components?.parameters?.[name] ?? null
  }
  return p as OpenApiParameter
}

const FILE_INPUTS: Record<string, JsonSchema> = {
  file_path: {
    type: 'string',
    description:
      'Absolute path to a local file to upload (local/stdio server only)',
  },
  file_base64: {
    type: 'string',
    description: 'Base64-encoded file contents (alternative to file_path)',
  },
  file_name: {
    type: 'string',
    description:
      'File name with extension, used with file_base64 (e.g. "avatar.png")',
  },
  file_type: {
    type: 'string',
    description:
      'MIME type, used with file_base64 (e.g. "image/png"); inferred from file_name when omitted',
  },
}

export function buildTools(doc: OpenApiDocument): ToolDef[] {
  const tools: ToolDef[] = []

  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of METHODS) {
      const op = item[method] as OpenApiOperation | undefined
      if (!op || op['x-internal'] || !op.operationId) continue

      const properties: Record<string, JsonSchema> = {}
      const required: string[] = []
      const pathParams: string[] = []
      const queryParams: string[] = []
      const bodyParams: string[] = []

      for (const raw of op.parameters ?? []) {
        const p = resolveParam(doc, raw)
        if (!p || (p.in !== 'path' && p.in !== 'query')) continue
        const schema = inline(doc, p.schema)
        properties[p.name] = {
          ...schema,
          ...(p.description && !schema.description
            ? { description: p.description }
            : {}),
        }
        if (p.in === 'path') {
          pathParams.push(p.name)
          required.push(p.name)
        } else {
          queryParams.push(p.name)
          if (p.required) required.push(p.name)
        }
      }

      let bodyKind: ToolDef['bodyKind'] = null
      let fileField: string | null = null
      const content = op.requestBody?.content ?? {}
      const jsonBody = content['application/json']?.schema
      const multipartBody = content['multipart/form-data']?.schema

      if (jsonBody) {
        bodyKind = 'json'
        const schema = inline(doc, jsonBody)
        for (const [name, prop] of Object.entries(schema.properties ?? {})) {
          properties[name] = prop
          bodyParams.push(name)
        }
        for (const r of schema.required ?? []) required.push(r)
      } else if (multipartBody) {
        bodyKind = 'multipart'
        const schema = inline(doc, multipartBody)
        for (const [name, prop] of Object.entries(schema.properties ?? {})) {
          if (prop.format === 'binary') {
            fileField = name
            continue
          }
          properties[name] = prop
          bodyParams.push(name)
          if (schema.required?.includes(name)) required.push(name)
        }
        Object.assign(properties, FILE_INPUTS)
      }

      // Auth is required only when every security option is non-empty
      // (an empty `{}` entry means anonymous access is allowed)
      const security = op.security ?? []
      const requiresAuth =
        security.length > 0 && security.every((s) => Object.keys(s).length > 0)
      const descriptionParts = [op.summary, op.description].filter(Boolean)
      if (op.deprecated) descriptionParts.unshift('[DEPRECATED]')
      if (bodyKind === 'multipart') {
        descriptionParts.push(
          'Provide either file_path or file_base64 (+ file_name).'
        )
      }

      tools.push({
        name: op.operationId,
        description: descriptionParts.join('\n\n'),
        method,
        path,
        pathParams,
        queryParams,
        bodyParams,
        bodyKind,
        fileField,
        requiresAuth,
        inputSchema: {
          type: 'object',
          properties,
          ...(required.length > 0
            ? { required: Array.from(new Set(required)) }
            : {}),
          additionalProperties: false,
        },
        tags: op.tags ?? [],
      })
    }
  }

  return tools.sort((a, b) => a.name.localeCompare(b.name))
}
