/**
 * A2A protocol 1.0: data model, errors and request validation
 *
 * JSON shapes follow the ProtoJSON mapping of specification/a2a.proto
 * (github.com/a2aproject/A2A, tag v1.0.1): camelCase fields, enums as their
 * SCREAMING_SNAKE_CASE names, timestamps as ISO 8601 UTC strings.
 */

import { z } from 'zod'

export const A2A_PROTOCOL_VERSION = '1.0'

// =============================================================================
// Data model
// =============================================================================

export const TASK_STATES = [
  'TASK_STATE_SUBMITTED',
  'TASK_STATE_WORKING',
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_INPUT_REQUIRED',
  'TASK_STATE_REJECTED',
  'TASK_STATE_AUTH_REQUIRED',
] as const
export type TaskState = (typeof TASK_STATES)[number]

export const TERMINAL_STATES: ReadonlySet<TaskState> = new Set([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
])

export interface Part {
  text?: string | undefined
  raw?: string | undefined
  url?: string | undefined
  data?: unknown
  metadata?: Record<string, unknown> | undefined
  filename?: string | undefined
  mediaType?: string | undefined
}

export interface Message {
  messageId: string
  contextId?: string | undefined
  taskId?: string | undefined
  role: 'ROLE_USER' | 'ROLE_AGENT'
  parts: Part[]
  metadata?: Record<string, unknown> | undefined
  extensions?: string[] | undefined
  referenceTaskIds?: string[] | undefined
}

export interface Artifact {
  artifactId: string
  name?: string
  description?: string
  parts: Part[]
  metadata?: Record<string, unknown>
}

export interface TaskStatus {
  state: TaskState
  message?: Message
  timestamp?: string
}

export interface Task {
  id: string
  contextId: string
  status: TaskStatus
  artifacts?: Artifact[]
  history?: Message[]
  metadata?: Record<string, unknown>
}

export interface TaskPushNotificationConfig {
  id: string
  taskId: string
  url: string
  token?: string
  authentication?: { scheme: string }
}

// =============================================================================
// Errors (spec §3.3.2, §5.4, §9.5, §11.6)
// =============================================================================

interface ErrorKind {
  rpc: number
  http: number
  status: string
  /** A2A-specific errors carry a google.rpc.ErrorInfo with this reason */
  reason?: string
}

export const ERROR_KINDS = {
  TASK_NOT_FOUND: {
    rpc: -32001,
    http: 404,
    status: 'NOT_FOUND',
    reason: 'TASK_NOT_FOUND',
  },
  TASK_NOT_CANCELABLE: {
    rpc: -32002,
    http: 400,
    status: 'FAILED_PRECONDITION',
    reason: 'TASK_NOT_CANCELABLE',
  },
  PUSH_NOTIFICATION_NOT_SUPPORTED: {
    rpc: -32003,
    http: 400,
    status: 'FAILED_PRECONDITION',
    reason: 'PUSH_NOTIFICATION_NOT_SUPPORTED',
  },
  UNSUPPORTED_OPERATION: {
    rpc: -32004,
    http: 400,
    status: 'FAILED_PRECONDITION',
    reason: 'UNSUPPORTED_OPERATION',
  },
  CONTENT_TYPE_NOT_SUPPORTED: {
    rpc: -32005,
    http: 400,
    status: 'INVALID_ARGUMENT',
    reason: 'CONTENT_TYPE_NOT_SUPPORTED',
  },
  VERSION_NOT_SUPPORTED: {
    rpc: -32009,
    http: 400,
    status: 'FAILED_PRECONDITION',
    reason: 'VERSION_NOT_SUPPORTED',
  },
  PARSE_ERROR: { rpc: -32700, http: 400, status: 'INVALID_ARGUMENT' },
  INVALID_REQUEST: { rpc: -32600, http: 400, status: 'INVALID_ARGUMENT' },
  METHOD_NOT_FOUND: { rpc: -32601, http: 404, status: 'NOT_FOUND' },
  INVALID_PARAMS: { rpc: -32602, http: 400, status: 'INVALID_ARGUMENT' },
  INTERNAL: { rpc: -32603, http: 500, status: 'INTERNAL' },
  // Authentication / authorization: the spec leaves the JSON-RPC code to the
  // server; these use the implementation-defined server-error range.
  UNAUTHENTICATED: { rpc: -32010, http: 401, status: 'UNAUTHENTICATED' },
  PERMISSION_DENIED: { rpc: -32011, http: 403, status: 'PERMISSION_DENIED' },
  FAILED_PRECONDITION: {
    rpc: -32012,
    http: 409,
    status: 'FAILED_PRECONDITION',
  },
  RESOURCE_EXHAUSTED: { rpc: -32013, http: 429, status: 'RESOURCE_EXHAUSTED' },
} satisfies Record<string, ErrorKind>

export type A2AErrorKind = keyof typeof ERROR_KINDS

export class A2AError extends Error {
  constructor(
    public readonly kind: A2AErrorKind,
    message: string,
    public readonly metadata: Record<string, string> = {},
    public readonly fieldViolations: Array<{
      field: string
      description: string
    }> = []
  ) {
    super(message)
    this.name = 'A2AError'
  }

  get http(): number {
    return ERROR_KINDS[this.kind].http
  }

  /** error.data (JSON-RPC) / error.details (HTTP): google.rpc objects */
  details(): Array<Record<string, unknown>> {
    const out: Array<Record<string, unknown>> = []
    const kind: ErrorKind = ERROR_KINDS[this.kind]
    const reason = kind.reason ?? this.kind
    out.push({
      '@type': 'type.googleapis.com/google.rpc.ErrorInfo',
      reason,
      domain: kind.reason ? 'a2a-protocol.org' : 'abund.ai',
      metadata: { ...this.metadata, timestamp: new Date().toISOString() },
    })
    if (this.fieldViolations.length > 0) {
      out.push({
        '@type': 'type.googleapis.com/google.rpc.BadRequest',
        fieldViolations: this.fieldViolations,
      })
    }
    return out
  }

  toJsonRpc(): { code: number; message: string; data: unknown[] } {
    return {
      code: ERROR_KINDS[this.kind].rpc,
      message: this.message,
      data: this.details(),
    }
  }

  toHttp(): {
    error: {
      code: number
      status: string
      message: string
      details: unknown[]
    }
  } {
    const kind = ERROR_KINDS[this.kind]
    return {
      error: {
        code: kind.http,
        status: kind.status,
        message: this.message,
        details: this.details(),
      },
    }
  }
}

/** Turn a zod failure into INVALID_PARAMS with a field violation per issue */
export function invalidParams(error: z.ZodError, prefix = ''): A2AError {
  const violations = error.issues.slice(0, 20).map((issue) => ({
    field: [prefix, ...issue.path.map(String)].filter(Boolean).join('.'),
    description: issue.message,
  }))
  const first = violations[0]
  return new A2AError(
    'INVALID_PARAMS',
    first
      ? `Invalid parameters: ${first.field || '(root)'}: ${first.description}`
      : 'Invalid parameters',
    {},
    violations
  )
}

// =============================================================================
// Request validation
// =============================================================================

const MAX_TEXT = 20000
const MAX_DATA_BYTES = 64 * 1024

const metadataSchema = z.record(z.unknown())

export const PartSchema = z
  .object({
    text: z.string().max(MAX_TEXT).optional(),
    raw: z.string().optional(),
    url: z.string().url().max(2048).optional(),
    data: z.unknown().optional(),
    metadata: metadataSchema.optional(),
    filename: z.string().max(255).optional(),
    mediaType: z.string().max(255).optional(),
  })
  .passthrough()
  .superRefine((part, ctx) => {
    const set = (['text', 'raw', 'url', 'data'] as const).filter(
      (k) => part[k] !== undefined
    )
    if (set.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'A part has exactly one of text, raw, url or data',
      })
    }
    if (
      part.data !== undefined &&
      JSON.stringify(part.data).length > MAX_DATA_BYTES
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['data'],
        message: `data parts are limited to ${String(MAX_DATA_BYTES)} bytes`,
      })
    }
  })

export const MessageSchema = z
  .object({
    messageId: z.string().min(1).max(200),
    contextId: z.string().min(1).max(200).optional(),
    taskId: z.string().min(1).max(200).optional(),
    role: z.literal('ROLE_USER', {
      errorMap: () => ({ message: 'Messages you send have role ROLE_USER' }),
    }),
    parts: z.array(PartSchema).min(1).max(20),
    metadata: metadataSchema.optional(),
    extensions: z.array(z.string()).optional(),
    referenceTaskIds: z.array(z.string()).optional(),
  })
  .passthrough()

const AuthenticationInfoSchema = z.object({
  scheme: z.string().min(1).max(40),
  credentials: z.string().max(4096).optional(),
})

export const PushConfigInputSchema = z
  .object({
    tenant: z.string().optional(),
    id: z.string().max(200).optional(),
    taskId: z.string().max(200).optional(),
    url: z.string().url().max(2048),
    token: z.string().max(1024).optional(),
    authentication: AuthenticationInfoSchema.optional(),
  })
  .passthrough()
export type PushConfigInput = z.infer<typeof PushConfigInputSchema>

export const SendMessageRequestSchema = z
  .object({
    tenant: z.string().optional(),
    message: MessageSchema,
    configuration: z
      .object({
        acceptedOutputModes: z.array(z.string().max(255)).max(20).optional(),
        taskPushNotificationConfig: PushConfigInputSchema.optional(),
        historyLength: z.number().int().min(0).optional(),
        returnImmediately: z.boolean().optional(),
      })
      .passthrough()
      .optional(),
    metadata: metadataSchema.optional(),
  })
  .passthrough()
export type SendMessageRequest = z.infer<typeof SendMessageRequestSchema>

export const GetTaskRequestSchema = z
  .object({
    tenant: z.string().optional(),
    id: z.string().min(1).max(200),
    historyLength: z.coerce.number().int().min(0).optional(),
  })
  .passthrough()

export const ListTasksRequestSchema = z
  .object({
    tenant: z.string().optional(),
    contextId: z.string().max(200).optional(),
    status: z.enum(TASK_STATES).optional(),
    pageSize: z.coerce.number().int().min(1).max(100).optional(),
    pageToken: z.string().max(500).optional(),
    historyLength: z.coerce.number().int().min(0).optional(),
    statusTimestampAfter: z.string().datetime({ offset: true }).optional(),
    includeArtifacts: z
      .union([z.boolean(), z.enum(['true', 'false'])])
      .transform((v) => v === true || v === 'true')
      .optional(),
  })
  .passthrough()
export type ListTasksRequest = z.infer<typeof ListTasksRequestSchema>

export const CancelTaskRequestSchema = z
  .object({
    tenant: z.string().optional(),
    id: z.string().min(1).max(200),
    metadata: metadataSchema.optional(),
  })
  .passthrough()

export const PushConfigRefSchema = z
  .object({
    tenant: z.string().optional(),
    taskId: z.string().min(1).max(200),
    id: z.string().min(1).max(200),
  })
  .passthrough()

export const ListPushConfigsRequestSchema = z
  .object({
    tenant: z.string().optional(),
    taskId: z.string().min(1).max(200),
    pageSize: z.coerce.number().int().min(0).max(100).optional(),
    pageToken: z.string().max(500).optional(),
  })
  .passthrough()

/** Parse params with a schema, or throw INVALID_PARAMS */
export function parseParams<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown
): T {
  const parsed = schema.safeParse(value ?? {})
  if (!parsed.success) throw invalidParams(parsed.error)
  return parsed.data
}

// =============================================================================
// Helpers
// =============================================================================

/** SQLite datetime('now') text → ISO 8601 UTC */
export function isoTimestamp(sqlite: string): string {
  if (sqlite.includes('T')) return new Date(sqlite).toISOString()
  return new Date(sqlite.replace(' ', 'T') + 'Z').toISOString()
}

/** ISO 8601 → SQLite datetime('now') text, for comparisons */
export function sqliteTimestamp(iso: string): string {
  return new Date(iso).toISOString().slice(0, 19).replace('T', ' ')
}

export function agentMessage(
  taskId: string,
  contextId: string,
  key: string,
  parts: Part[]
): Message {
  return {
    messageId: `${taskId}:${key}`,
    taskId,
    contextId,
    role: 'ROLE_AGENT',
    parts,
  }
}

/**
 * Does the client accept this media type? No acceptedOutputModes means
 * anything goes; wildcards (`*\/*`, `text/*`) match.
 */
export function accepts(
  modes: string[] | undefined,
  mediaType: string
): boolean {
  if (!modes || modes.length === 0) return true
  const [type] = mediaType.split('/')
  return modes.some((m) => {
    const mode = m.split(';')[0]?.trim().toLowerCase() ?? ''
    return mode === '*/*' || mode === mediaType || mode === `${type ?? ''}/*`
  })
}
