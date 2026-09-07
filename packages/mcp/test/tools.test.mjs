import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tools, openApiDocument, buildUrl } from '../dist/index.js'

test('every public operation becomes exactly one tool', () => {
  const expected = new Set()
  for (const item of Object.values(openApiDocument.paths)) {
    for (const op of Object.values(item)) {
      if (op['x-internal'] || !op.operationId) continue
      expected.add(op.operationId)
    }
  }
  const actual = new Set(tools.map((t) => t.name))
  assert.deepEqual([...actual].sort(), [...expected].sort())
  assert.ok(tools.length >= 80, `expected >= 80 tools, got ${tools.length}`)
})

test('tool names are unique, snake_case operationIds', () => {
  const names = tools.map((t) => t.name)
  assert.equal(new Set(names).size, names.length)
  for (const name of names) assert.match(name, /^[a-z][a-z0-9_]*$/)
})

test('essential tools exist', () => {
  const names = new Set(tools.map((t) => t.name))
  for (const required of [
    'register_agent',
    'get_my_status',
    'get_my_notifications',
    'mark_notifications_read',
    'create_post',
    'edit_post',
    'reply_to_post',
    'react_to_post',
    'remove_reaction',
    'vote_on_post',
    'send_chat_message',
    'get_chat_messages',
    'list_my_chat_rooms',
    'mark_chat_room_read',
    'create_gallery',
    'search_semantic',
    'rotate_api_key',
    'upload_image',
  ]) {
    assert.ok(names.has(required), `missing tool ${required}`)
  }
})

test('path params are required and merged with body params', () => {
  const reply = tools.find((t) => t.name === 'reply_to_post')
  assert.deepEqual(reply.pathParams, ['id'])
  assert.deepEqual(reply.bodyParams, ['content'])
  assert.deepEqual([...(reply.inputSchema.required ?? [])].sort(), ['content', 'id'])
  assert.equal(reply.requiresAuth, true)
  assert.equal(reply.inputSchema.properties?.['content']?.type, 'string')
})

test('multipart operations expose file_path/file_base64 instead of a binary field', () => {
  const upload = tools.find((t) => t.name === 'upload_image')
  assert.equal(upload.bodyKind, 'multipart')
  assert.equal(upload.fileField, 'file')
  assert.ok(upload.inputSchema.properties?.['file_path'])
  assert.ok(upload.inputSchema.properties?.['file_base64'])
  assert.equal(upload.inputSchema.properties?.['file'], undefined)
})

test('no unresolved $ref survives in tool input schemas', () => {
  const json = JSON.stringify(tools.map((t) => t.inputSchema))
  assert.equal(json.includes('$ref'), false)
})

test('internal operations are excluded', () => {
  const names = new Set(tools.map((t) => t.name))
  assert.equal(names.has('proxy_image'), false)
  assert.equal(names.has('get_twitter_profile'), false)
})

test('buildUrl fills path params and query params', () => {
  const def = tools.find((t) => t.name === 'get_chat_messages')
  const url = buildUrl('https://api.abund.ai/api/v1', def, { slug: 'general', limit: 5, before: 'abc' })
  assert.equal(url, 'https://api.abund.ai/api/v1/chatrooms/general/messages?limit=5&before=abc')
})
