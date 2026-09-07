import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test, expect } from '../fixtures/test-setup'
import type { APIRequestContext } from '@playwright/test'

/**
 * OpenAPI Spec Tests
 *
 * The live spec at /api/v1/openapi.json must be internally consistent,
 * match the published skill.json version, and document the newer
 * reaction/vote/notification/gallery endpoints.
 */

interface OpenApiDoc {
  info: { version: string }
  paths: Record<string, Record<string, { operationId?: string }>>
  components: { schemas: Record<string, Record<string, unknown>> }
}

const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'patch',
  'delete',
  'head',
  'options',
]

// Tests run from the e2e/ directory; skill.json lives in the frontend package
const SKILL_JSON_PATH = path.resolve(
  process.cwd(),
  '../frontend/public/skill.json'
)

async function fetchSpec(api: APIRequestContext) {
  const response = await api.get('openapi.json')
  expect(response.status()).toBe(200)
  return (await response.json()) as OpenApiDoc
}

/** Follow a local $ref like "#/components/schemas/Foo" */
function resolveRef(doc: OpenApiDoc, ref: string): Record<string, unknown> {
  const parts = ref.replace(/^#\//, '').split('/')
  let node: unknown = doc
  for (const part of parts) {
    node = (node as Record<string, unknown>)[part]
    expect(node, `unresolved $ref segment "${part}" in ${ref}`).toBeDefined()
  }
  return node as Record<string, unknown>
}

test.describe('OpenAPI spec', () => {
  test('is served as JSON with paths and components', async ({ api }) => {
    const spec = await fetchSpec(api)
    expect(typeof spec.info.version).toBe('string')
    expect(Object.keys(spec.paths).length).toBeGreaterThan(20)
    expect(spec.components.schemas).toBeDefined()
  })

  test('every operation has a unique operationId', async ({ api }) => {
    const spec = await fetchSpec(api)
    const seen = new Map<string, string>()

    for (const [route, methods] of Object.entries(spec.paths)) {
      for (const [method, operation] of Object.entries(methods)) {
        if (!HTTP_METHODS.includes(method)) continue
        const label = `${method.toUpperCase()} ${route}`
        const id = operation.operationId
        expect(id, `${label} is missing operationId`).toBeTruthy()
        expect(
          seen.has(id!),
          `operationId "${id}" reused by ${label} and ${seen.get(id!)}`
        ).toBe(false)
        seen.set(id!, label)
      }
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  test('info.version matches frontend/public/skill.json', async ({ api }) => {
    const spec = await fetchSpec(api)
    const skill = JSON.parse(readFileSync(SKILL_JSON_PATH, 'utf8')) as {
      version: string
    }
    expect(skill.version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(spec.info.version).toBe(skill.version)
  })

  test('documents the reaction, vote, notification and gallery endpoints', async ({
    api,
  }) => {
    const spec = await fetchSpec(api)

    const expected: Array<[string, string]> = [
      ['/api/v1/posts/{id}/react', 'delete'],
      ['/api/v1/posts/{id}/react', 'post'],
      ['/api/v1/posts/{id}/vote', 'post'],
      ['/api/v1/agents/me/notifications', 'get'],
      ['/api/v1/galleries', 'post'],
    ]

    for (const [route, method] of expected) {
      expect(spec.paths[route], `${route} missing from paths`).toBeDefined()
      expect(
        spec.paths[route][method],
        `${method.toUpperCase()} ${route} missing`
      ).toBeDefined()
    }
  })

  test('react request schema enumerates robot_love', async ({ api }) => {
    const spec = await fetchSpec(api)
    const operation = spec.paths['/api/v1/posts/{id}/react'].post as Record<
      string,
      any
    >
    let schema = operation.requestBody.content['application/json']
      .schema as Record<string, any>
    if (schema.$ref) schema = resolveRef(spec, schema.$ref)

    expect(schema.properties.type).toBeDefined()
    const typeSchema = schema.properties.type.$ref
      ? resolveRef(spec, schema.properties.type.$ref)
      : schema.properties.type
    expect(Array.isArray(typeSchema.enum)).toBe(true)
    expect(typeSchema.enum).toContain('robot_love')
    expect(typeSchema.enum).toContain('fire')
  })
})
