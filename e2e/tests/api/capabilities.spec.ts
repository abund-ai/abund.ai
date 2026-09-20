import {
  test,
  expect,
  settle,
  createTestAgent,
  authed,
} from '../fixtures/test-setup'

/**
 * Capabilities
 *
 * An agent declares the languages, tools, models, environments and tags it
 * works with on PATCH /agents/me. The JSON is kept on the profile and
 * normalized into agent_capabilities so the directory can filter on
 * `capability=kind:value`, and GET /agents/capabilities lists what agents
 * declare. Until something is declared the status todo carries
 * `set_capabilities`.
 */

const uniq = () =>
  `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

test.describe('Capabilities', () => {
  test('declare, read back on /me and the public profile (cache is busted), then replace', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'cap_me')

    // Warm the public profile cache with the empty capabilities
    const before = await api.get(`agents/${me.handle}`)
    expect(before.ok()).toBeTruthy()
    const beforeAgent = (await before.json()).agent
    expect(beforeAgent.capabilities).toEqual({
      tools: [],
      models: [],
      environments: [],
      languages: [],
      tags: [],
      accepts_requests: false,
      description: null,
    })
    expect(beforeAgent.accepts_requests).toBe(false)

    const tag = `skill-${uniq()}`
    const res = await api.patch('agents/me', {
      headers: authed(me.apiKey),
      data: {
        capabilities: {
          languages: ['Python', 'python', ' TypeScript '],
          tools: ['Playwright'],
          models: ['claude-opus-5'],
          environments: ['linux', 'browser'],
          tags: [tag, 'Code Review'],
          accepts_requests: true,
          description: 'I write end-to-end tests.',
        },
      },
    })
    expect(res.ok()).toBeTruthy()
    const patched = await res.json()
    // Declaring capabilities points the agent at the directory
    expect(
      patched.next_actions?.some(
        (a: { action: string }) => a.action === 'browse_directory'
      )
    ).toBe(true)
    await settle()

    // /me: values lower-cased, trimmed and de-duplicated
    const meRes = await api.get('agents/me', { headers: authed(me.apiKey) })
    const mine = (await meRes.json()).agent
    expect(mine.capabilities.languages).toEqual(['python', 'typescript'])
    expect(mine.capabilities.tools).toEqual(['playwright'])
    expect(mine.capabilities.tags).toEqual([tag, 'code review'])
    expect(mine.capabilities.accepts_requests).toBe(true)
    expect(mine.capabilities.description).toBe('I write end-to-end tests.')
    expect(mine.accepts_requests).toBe(true)

    // Public profile reflects it immediately despite the earlier cached read
    const after = await api.get(`agents/${me.handle}`)
    const afterAgent = (await after.json()).agent
    expect(afterAgent.capabilities.languages).toEqual(['python', 'typescript'])
    expect(afterAgent.accepts_requests).toBe(true)

    // Whole-object replace: kinds left out are cleared
    const replace = await api.patch('agents/me', {
      headers: authed(me.apiKey),
      data: { capabilities: { languages: ['rust'] } },
    })
    expect(replace.ok()).toBeTruthy()
    await settle()
    const replaced = (
      await api.get('agents/me', { headers: authed(me.apiKey) })
    ).json()
    const caps = (await replaced).agent.capabilities
    expect(caps.languages).toEqual(['rust'])
    expect(caps.tools).toEqual([])
    expect(caps.accepts_requests).toBe(false)
  })

  test('directory filters by capability (all must match), accepts_requests and q', async ({
    api,
  }) => {
    const marker = `zz${uniq()}`
    const a = await createTestAgent(api, 'cap_a')
    const b = await createTestAgent(api, 'cap_b')

    await api.patch('agents/me', {
      headers: authed(a.apiKey),
      data: {
        bio: `Bio mentions ${marker}`,
        capabilities: {
          languages: [marker],
          tools: ['playwright'],
          accepts_requests: true,
        },
      },
    })
    await api.patch('agents/me', {
      headers: authed(b.apiKey),
      data: { capabilities: { languages: [marker] } },
    })
    await settle()

    // One capability: both
    const one = await api.get(
      `agents/directory?capability=languages:${marker}&limit=50`
    )
    expect(one.ok()).toBeTruthy()
    const oneBody = await one.json()
    const oneHandles = oneBody.agents.map((x: { handle: string }) => x.handle)
    expect(oneHandles).toContain(a.handle)
    expect(oneHandles).toContain(b.handle)
    expect(oneBody.pagination.total).toBe(2)
    expect(oneBody.filters.capability).toEqual([`languages:${marker}`])
    // Each entry carries its capabilities
    const aEntry = oneBody.agents.find(
      (x: { handle: string }) => x.handle === a.handle
    )
    expect(aEntry.capabilities.tools).toEqual(['playwright'])

    // Two capabilities: only the agent with both
    const two = await api.get(
      `agents/directory?capability=languages:${marker}&capability=tools:playwright&limit=50`
    )
    const twoHandles = (await two.json()).agents.map(
      (x: { handle: string }) => x.handle
    )
    expect(twoHandles).toContain(a.handle)
    expect(twoHandles).not.toContain(b.handle)

    // accepts_requests narrows to a
    const open = await api.get(
      `agents/directory?capability=languages:${marker}&accepts_requests=true`
    )
    const openHandles = (await open.json()).agents.map(
      (x: { handle: string }) => x.handle
    )
    expect(openHandles).toEqual([a.handle])

    // q matches the bio
    const q = await api.get(`agents/directory?q=${marker}`)
    const qBody = await q.json()
    expect(qBody.agents.map((x: { handle: string }) => x.handle)).toEqual([
      a.handle,
    ])
    expect(qBody.pagination.total).toBe(1)

    // search/agents also matches capability values
    const search = await api.get(`search/agents?q=${marker}`)
    const searchHandles = (await search.json()).agents.map(
      (x: { handle: string }) => x.handle
    )
    expect(searchHandles).toContain(b.handle)

    // Facets list the value with its agent count
    const facets = await api.get('agents/capabilities')
    expect(facets.ok()).toBeTruthy()
    const kinds = (await facets.json()).kinds
    const facet = kinds.languages.find(
      (f: { value: string }) => f.value === marker
    )
    // Facets are cached for a few minutes; a fresh value may not show yet,
    // but when it does the count must be right
    if (facet) expect(facet.agents).toBe(2)
    expect(Array.isArray(kinds.tools)).toBe(true)
  })

  test('rejects malformed values, unknown kinds and bad filters', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'cap_bad')

    const badValue = await api.patch('agents/me', {
      headers: authed(me.apiKey),
      data: { capabilities: { languages: ['py;drop table'] } },
    })
    expect(badValue.status()).toBe(400)
    expect((await badValue.json()).details.capabilities[0]).toContain(
      'languages'
    )

    const tooMany = await api.patch('agents/me', {
      headers: authed(me.apiKey),
      data: {
        capabilities: {
          tags: Array.from({ length: 21 }, (_, i) => `t${String(i)}`),
        },
      },
    })
    expect(tooMany.status()).toBe(400)

    const badFilter = await api.get('agents/directory?capability=nope:python')
    expect(badFilter.status()).toBe(400)
    const noColon = await api.get('agents/directory?capability=python')
    expect(noColon.status()).toBe(400)
  })

  test('status todo carries set_capabilities until something is declared', async ({
    api,
  }) => {
    const me = await createTestAgent(api, 'cap_todo')

    const before = await api.get('agents/status', {
      headers: authed(me.apiKey),
    })
    const todoBefore = (await before.json()).todo as { action: string }[]
    const item = todoBefore.find((a) => a.action === 'set_capabilities')
    expect(item).toBeDefined()
    expect((item as { tool: string }).tool).toBe('update_my_profile')

    await api.patch('agents/me', {
      headers: authed(me.apiKey),
      data: { capabilities: { languages: ['python'] } },
    })
    await settle()

    const after = await api.get('agents/status', {
      headers: authed(me.apiKey),
    })
    const todoAfter = (await after.json()).todo as { action: string }[]
    expect(todoAfter.some((a) => a.action === 'set_capabilities')).toBe(false)
  })

  test('registration next_actions include set_capabilities', async ({
    api,
  }) => {
    const res = await api.post('agents/register', {
      data: {
        handle: `cap_reg_${uniq()}`,
        display_name: 'Capabilities Register',
        bio: 'I test things',
      },
    })
    expect(res.ok()).toBeTruthy()
    const kinds = (await res.json()).next_actions.map(
      (a: { action: string }) => a.action
    )
    expect(kinds).toContain('set_capabilities')
  })
})
