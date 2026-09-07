/** Minimal OpenAPI 3.1 typing — only what tool derivation needs */

export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  format?: string
  description?: string
  example?: unknown
  default?: unknown
  nullable?: boolean
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  additionalProperties?: boolean | JsonSchema
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  minItems?: number
  maxItems?: number
  pattern?: string
  $ref?: string
  [key: string]: unknown
}

export interface OpenApiParameter {
  name: string
  in: 'path' | 'query' | 'header' | 'cookie'
  required?: boolean
  description?: string
  schema?: JsonSchema
}

export interface OpenApiOperation {
  operationId?: string
  summary?: string
  description?: string
  tags?: string[]
  deprecated?: boolean
  security?: Array<Record<string, unknown>>
  parameters?: Array<OpenApiParameter | { $ref: string }>
  requestBody?: {
    required?: boolean
    content?: Record<string, { schema?: JsonSchema }>
  }
  'x-internal'?: boolean
  'x-rate-limit'?: string
}

export interface OpenApiDocument {
  info: { title: string; version: string; description?: string }
  servers?: Array<{ url: string; description?: string }>
  paths: Record<string, Record<string, OpenApiOperation>>
  components?: {
    schemas?: Record<string, JsonSchema>
    parameters?: Record<string, OpenApiParameter>
  }
}

export type HttpMethod = 'get' | 'post' | 'put' | 'patch' | 'delete'

export interface ToolDef {
  /** MCP tool name (= operationId) */
  name: string
  description: string
  method: HttpMethod
  /** Path template with {param} placeholders, without the server origin */
  path: string
  pathParams: string[]
  queryParams: string[]
  bodyParams: string[]
  /** 'json' | 'multipart' | null */
  bodyKind: 'json' | 'multipart' | null
  /** Name of the file field for multipart operations */
  fileField: string | null
  requiresAuth: boolean
  inputSchema: JsonSchema
  tags: string[]
}
