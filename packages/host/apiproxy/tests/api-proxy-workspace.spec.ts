import { existsSync, mkdirSync, mkdtempSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents, Inbox } from '@deepseek-ai/dsh-agent'
import type { Agent, AgentFactory } from '@deepseek-ai/dsh-agent'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import type { Session } from '@deepseek-ai/dsh-session'
import Storage from '@deepseek-ai/dsh-storage'
import { DomainFacility } from '@deepseek-ai/dsh-storage-domain'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import { DirectoryPickerError } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import type { HostFrame, WorkspaceId } from '@deepseek-ai/dsh-host-apiproxy/api'
import type { RpcRequest, RpcResponse } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '@deepseek-ai/dsh-host-apiproxy'
import { MemoryStorageBackend } from '../../../storage/storage-domain/tests/helpers/memory-backend.ts'

let nextRpc = 1

function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`workspace-${String(nextRpc++)}`), payload }
}

function expectOk<T>(response: RpcResponse<T>): T {
  expect(response.result.ok).toBe(true)
  if (!response.result.ok) throw new Error('unreachable')
  return response.result.value
}

async function nextHostFrame(
  stream: AsyncIterator<RpcRequest<HostFrame>>,
): Promise<RpcRequest<HostFrame>> {
  const next = await stream.next()
  if (next.done === true) throw new Error('Host stream ended before the expected increment')
  return next.value
}

function stubAgent(session: Session): Agent {
  return {
    id: session.id,
    options: {},
    session,
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx: new Context(),
    send: () => {},
    followup: () => {},
    steer: () => ({ outcome: Promise.resolve({ status: 'rejected' as const }) }),
    inject: () => {},
    cancel() {},
    runMaintenance: job => job(new AbortController().signal),
    whenIdle: () => Promise.resolve(),
  }
}

/** Compose the API over real Session, Agent, Storage, Domain, and Workspace services. */
async function harness(
  root = realpathSync.native(mkdtempSync(join(tmpdir(), 'dsh-apiproxy-workspace-'))),
  picker: DirectoryPickerCapability = { kind: 'native', pick: async () => null },
  extras: {
    openPath?: (path: string, signal: AbortSignal) => Promise<void>
    canOpenPath?: () => boolean
  } = {},
) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(Storage)
  ctx.storage.backend.register('memory', new MemoryStorageBackend())
  const storageDomain = new DomainFacility(ctx, { backend: 'memory', routes: {} })
  ctx.storage.mount('domain', storageDomain)
  ctx.provide('storageDomain', storageDomain)
  ctx.provide('sessionPersistence', { list: () => Promise.resolve([]) } as never)
  await ctx.plugin(WorkspaceRegistry)

  const factory: AgentFactory = {
    async createAgent(_ownerCtx, options) {
      const session = ctx.sessions.create(
        options.sessionId,
        options.meta === undefined ? {} : { meta: options.meta },
      )
      const agent = stubAgent(session)
      const unregister = ctx.agents.register(agent)
      return {
        agent,
        dispose: () => {
          unregister()
          return Promise.resolve()
        },
      }
    },
    async resume() {
      throw new Error('test harness has no persisted sessions')
    },
  }
  ctx.agents.setFactory(factory)
  // Structural picker fake: the gateway only reads capability(); a stable
  // object per harness mirrors the seam's stability contract.
  ctx.provide('directoryPicker', { capability: () => picker } as never)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'test', model: 'test-model' }),
    cwd: root,
    ...extras.openPath === undefined ? {} : { openPath: extras.openPath },
    ...extras.canOpenPath === undefined ? {} : { canOpenPath: extras.canOpenPath },
  })
  return { api, ctx, storageDomain, root }
}

/** Stage one directory under the harness root for path adoption. */
function stageDir(root: string, name: string): string {
  const path = join(root, name)
  mkdirSync(path)
  return path
}

describe('host.pickDirectory', () => {
  it('maps a non-Error chooser rejection to an internal response', async () => {
    const pick = vi.fn<Extract<DirectoryPickerCapability, { kind: 'native' }>['pick']>().mockRejectedValue('synthetic chooser failure')
    const { api, ctx } = await harness(undefined, { kind: 'native', pick })
    try {
      expect((await api.host.pickDirectory(request({}), new AbortController().signal)).result)
        .toMatchObject({ ok: false, error: { code: 'internal', message: 'directory picker failed: synthetic chooser failure' } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('returns a selected path or explicit cancellation from the native capability', async () => {
    const selected = await harness(undefined, { kind: 'native', pick: async () => '/tmp/project' })
    expect((await selected.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: '/tmp/project' } })

    const cancelled = await harness(undefined, { kind: 'native', pick: async () => null })
    expect((await cancelled.api.host.pickDirectory(request({}), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { path: null } })
  })

  it('propagates abort into the native capability as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, {
      kind: 'native',
      pick: signal => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.pickDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('folds a non-abort native-chooser failure into an internal error', async () => {
    const { api } = await harness(undefined, { kind: 'native', pick: async () => { throw new Error('no chooser installed') } })
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('refuses the native RPC under a browse composition', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const response = await api.host.pickDirectory(request({}), new AbortController().signal)
    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'directory-picker-unavailable', details: { capability: 'browse' } },
    })
  })
})

/** Canned browse capability: one listing, one created path, typed failures on demand. */
const BROWSE_STUB: DirectoryPickerCapability = {
  kind: 'browse',
  list: async (path) => {
    if (path === '/denied') throw new DirectoryPickerError('directory-unreadable', '/denied', 'cannot list /denied')
    const target = path ?? '/home/user'
    return {
      path: target,
      home: '/home/user',
      crumbs: [{ name: '/', path: '/', hidden: false }],
      entries: [{ name: 'projects', path: `${target}/projects`, hidden: false }],
      truncated: false,
    }
  },
  createDirectory: async (path, name) => {
    if (name === 'taken') throw new DirectoryPickerError('directory-exists', `${path}/${name}`, 'already exists')
    if (name === 'unwritable') throw new Error('disk detached')
    return `${path}/${name}`
  },
}

describe('host.listDirectory / host.createDirectory', () => {
  it('maps a non-Error browse rejection without exposing a native chooser', async () => {
    const list = vi.fn<Extract<DirectoryPickerCapability, { kind: 'browse' }>['list']>().mockRejectedValue('synthetic listing failure')
    const { api, ctx } = await harness(undefined, { ...BROWSE_STUB, list })
    try {
      expect((await api.host.listDirectory(request({ path: '/synthetic' }), new AbortController().signal)).result)
        .toMatchObject({ ok: false, error: { code: 'internal', message: 'synthetic listing failure' } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('serves listings and creation through the browse capability, defaulting to home', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    const home = await api.host.listDirectory(request({}), new AbortController().signal)
    expect(home.result).toMatchObject({ ok: true, value: { path: '/home/user', home: '/home/user' } })
    const listed = await api.host.listDirectory(request({ path: '/home/user/projects' }), new AbortController().signal)
    expect(listed.result).toMatchObject({ ok: true, value: { path: '/home/user/projects' } })
    const created = await api.host.createDirectory(request({ path: '/home/user', name: 'fresh' }))
    expect(created.result).toEqual({ ok: true, value: { path: '/home/user/fresh' } })
  })

  it('maps typed picker failures onto the wire error codes and folds unknown throws to internal', async () => {
    const { api } = await harness(undefined, BROWSE_STUB)
    expect((await api.host.listDirectory(request({ path: '/denied' }), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-unreadable', details: { path: '/denied' } },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'taken' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-exists' },
    })
    expect((await api.host.createDirectory(request({ path: '/home/user', name: 'unwritable' }))).result).toMatchObject({
      ok: false, error: { code: 'internal' },
    })
  })

  it('reports an aborted listing as cancelled, like the other signal-following RPCs', async () => {
    const { api } = await harness(undefined, {
      kind: 'browse',
      list: (_path, signal) => new Promise((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(new Error('scan aborted')) }, { once: true })
      }),
      createDirectory: async () => '/never',
    })
    const abort = new AbortController()
    const pending = api.host.listDirectory(request({}), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })

  it('refuses the browse RPCs under a native composition', async () => {
    const { api } = await harness()
    expect((await api.host.listDirectory(request({}), new AbortController().signal)).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
    expect((await api.host.createDirectory(request({ path: '/x', name: 'y' }))).result).toMatchObject({
      ok: false, error: { code: 'directory-picker-unavailable', details: { capability: 'native' } },
    })
  })
})

describe('host.openPath', () => {
  it.each([new Error('synthetic opener failure'), 'synthetic opener rejection'])(
    'reports an opener failure without treating it as cancellation (%s)', async (failure) => {
      const openPath = vi.fn<(path: string, signal: AbortSignal) => Promise<void>>().mockRejectedValue(failure)
      const { api, ctx } = await harness(undefined, undefined, { openPath })
      try {
        expect((await api.host.openPath(request({ path: '/synthetic/report.txt' }), new AbortController().signal)).result)
          .toMatchObject({ ok: false, error: {
            code: 'internal', message: `path open failed: ${failure instanceof Error ? failure.message : failure}`,
          } })
      } finally {
        await ctx.fiber.dispose()
      }
    },
  )

  it('describes whether this deployment can reach a user-visible native desktop', async () => {
    const visible = await harness(undefined, undefined, { canOpenPath: () => true })
    const headless = await harness(undefined, undefined, { canOpenPath: () => false })
    expect(expectOk(await visible.api.host.describe(request({}))).canOpenPath).toBe(true)
    expect(expectOk(await headless.api.host.describe(request({}))).canOpenPath).toBe(false)
  })

  it('opens through the injected native boundary', async () => {
    const opened: string[] = []
    const { api } = await harness(undefined, undefined, {
      openPath: async (path) => { opened.push(path) },
    })
    expect((await api.host.openPath(request({ path: '/tmp/a.txt' }), new AbortController().signal)).result)
      .toEqual({ ok: true, value: { opened: true } })
    expect(opened).toEqual(['/tmp/a.txt'])
  })

  it('propagates abort into the native boundary as a cancelled RPC error', async () => {
    const { api } = await harness(undefined, undefined, {
      openPath: (_path, signal) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { reject(new Error('aborted')) }, { once: true })
      }),
    })
    const abort = new AbortController()
    const pending = api.host.openPath(request({ path: '/tmp/a.txt' }), abort.signal)
    abort.abort()
    expect((await pending).result).toMatchObject({ ok: false, error: { code: 'cancelled' } })
  })
})

describe('workspace.create', () => {
  it('serializes concurrent creates of one path into a single registration', async () => {
    const { api, root } = await harness()
    const target = stageDir(root, 'alpha')
    const responses = await Promise.all([
      api.workspace.create(request({ path: target })),
      api.workspace.create(request({ path: target })),
    ])
    const values = responses.map(response => expectOk(response))
    const created = values.find(value => value.created)
    const resolved = values.find(value => !value.created)

    expect(created).toMatchObject({ workspace: { path: target, title: 'alpha' } })
    expect(resolved?.workspace.workspaceId).toBe(created?.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items).toHaveLength(1)
  })

  it('adopts only existing directories', async () => {
    const { api, root } = await harness()
    const existing = stageDir(root, 'existing')
    const first = expectOk(await api.workspace.create(request({ path: existing })))
    const repeated = expectOk(await api.workspace.create(request({ path: existing })))
    expect(first).toMatchObject({ created: true, workspace: { path: existing, title: 'existing' } })
    expect(repeated).toMatchObject({ created: false, workspace: { workspaceId: first.workspace.workspaceId } })

    expectOk(await api.workspace.rename(request({
      workspaceId: first.workspace.workspaceId,
      title: 'renamed-existing',
    })))
    const reopened = expectOk(await api.workspace.create(request({ path: existing })))
    expect(reopened.workspace.title).toBe('renamed-existing')

    const missing = join(root, 'missing')
    const missingResult = await api.workspace.create(request({ path: missing }))
    expect(missingResult.result).toMatchObject({ ok: false, error: { code: 'workspace-invalid-path' } })
    expect(existsSync(missing)).toBe(false)
  })

  it('adopts different paths that derive the same Workspace title', async () => {
    const { api, root } = await harness()
    const first = join(root, 'one', 'project')
    const second = join(root, 'two', 'project')
    mkdirSync(first, { recursive: true })
    mkdirSync(second, { recursive: true })
    const firstResult = expectOk(await api.workspace.create(request({ path: first })))
    const secondResult = expectOk(await api.workspace.create(request({ path: second })))
    expect(firstResult).toMatchObject({
      created: true,
      workspace: { path: first, title: 'project' },
    })
    expect(secondResult).toMatchObject({
      created: true,
      workspace: { path: second, title: 'project' },
    })
    expect(secondResult.workspace.workspaceId).not.toBe(firstResult.workspace.workspaceId)
    expect(expectOk(await api.workspace.list(request({}))).items.map(workspace => workspace.path))
      .toEqual([second, first])
  })
})

describe('workspace rename and session order', () => {
  it('distinguishes unexpected storage failures from invalid path, order and archive identities', async () => {
    const { api, ctx, root } = await harness()
    try {
      vi.spyOn(ctx.workspaceRegistry, 'create').mockRejectedValueOnce('synthetic registry failure')
      const failedPath = stageDir(root, 'failed-registry')
      expect((await api.workspace.create(request({ path: failedPath }))).result).toMatchObject({
        ok: false, error: { code: 'workspace-invalid-path', message: `cannot create a workspace at "${failedPath}": synthetic registry failure` },
      })
      const created = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
      const failure = new Error('synthetic storage failure')
      vi.spyOn(ctx.workspaceRegistry, 'insertBefore').mockRejectedValueOnce(failure)
      await expect(api.workspace.insertBefore(request({ workspaceId: created.workspaceId }))).rejects.toBe(failure)
      vi.spyOn(ctx.workspaceRegistry, 'archiveSession').mockRejectedValueOnce(failure)
      await expect(api.workspace.archiveSession(request({ sessionId: SessionId('pending-archive') }))).rejects.toBe(failure)
      expect(ctx.workspaceRegistry.archivedSessionIds).toEqual([])
      expect(ctx.workspaceRegistry.list().map(item => item.id)).toEqual([created.workspaceId])
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('treats the current title as a no-op and rejects a conflicting title without changing either workspace', async () => {
    const { api, ctx, root } = await harness()
    try {
      const first = expectOk(await api.workspace.create(request({ path: stageDir(root, 'first') }))).workspace
      const second = expectOk(await api.workspace.create(request({ path: stageDir(root, 'second') }))).workspace
      const workspace = ctx.workspaceRegistry.list().find(item => item.id === first.workspaceId)
      if (workspace === undefined) throw new Error('first workspace is missing')
      const setTitle = vi.spyOn(workspace, 'setTitle')
      expectOk(await api.workspace.rename(request({ workspaceId: first.workspaceId, title: ' first ' })))
      expect(setTitle).not.toHaveBeenCalled()
      expect((await api.workspace.rename(request({ workspaceId: first.workspaceId, title: second.title }))).result)
        .toMatchObject({ ok: false, error: { code: 'workspace-name-conflict', details: { name: second.title } } })
      expect(workspace.title).toBe(first.title)
      expect((await api.workspace.rename(request({ workspaceId: 'missing' as WorkspaceId, title: 'Available' }))).result)
        .toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not poison later workspace operations after a title or deletion storage failure', async () => {
    const { api, ctx, root } = await harness()
    try {
      const created = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
      const workspace = ctx.workspaceRegistry.list()[0]
      if (workspace === undefined) throw new Error('workspace is missing')
      const failure = new Error('synthetic persistence failure')
      vi.spyOn(workspace, 'setTitle').mockRejectedValueOnce(failure)
      await expect(api.workspace.rename(request({ workspaceId: created.workspaceId, title: 'Rename' }))).rejects.toBe(failure)
      expectOk(await api.workspace.rename(request({ workspaceId: created.workspaceId, title: 'Rename' })))
      vi.spyOn(ctx.workspaceRegistry, 'delete').mockRejectedValueOnce(failure)
      await expect(api.workspace.delete(request({ workspaceId: created.workspaceId }))).rejects.toBe(failure)
      expect(expectOk(await api.workspace.list(request({}))).items).toHaveLength(1)
      expect(expectOk(await api.workspace.delete(request({ workspaceId: created.workspaceId })))).toEqual({ deleted: true })
      expect(existsSync(created.path)).toBe(true)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('moves a known session before an anchor or to the end and maps missing members', async () => {
    const { api, ctx, root } = await harness()
    try {
      const created = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
      for (const id of ['first-session', 'second-session']) {
        expectOk(await api.sessions.create(request({ workspaceId: created.workspaceId, sessionId: SessionId(id) })))
      }
      const workspace = ctx.workspaceRegistry.list()[0]
      if (workspace === undefined) throw new Error('workspace is missing')
      const [leading, trailing] = workspace.sessionIds
      if (leading === undefined || trailing === undefined) throw new Error('workspace lacks its two sessions')
      expect(expectOk(await api.workspace.insertSessionBefore(request({
        workspaceId: created.workspaceId, sessionId: trailing, beforeSessionId: leading,
      }))).workspace.sessionIds).toEqual([trailing, leading])
      expect(expectOk(await api.workspace.insertSessionBefore(request({
        workspaceId: created.workspaceId, sessionId: trailing,
      }))).workspace.sessionIds).toEqual([leading, trailing])
      for (const payload of [
        { workspaceId: created.workspaceId, sessionId: SessionId('not-a-member') },
        { workspaceId: created.workspaceId, sessionId: leading, beforeSessionId: SessionId('missing-anchor') },
      ]) {
        expect((await api.workspace.insertSessionBefore(request(payload))).result)
          .toMatchObject({ ok: false, error: { code: 'workspace-move-invalid' } })
      }
      expect((await api.workspace.insertSessionBefore(request({
        workspaceId: 'missing-workspace' as WorkspaceId, sessionId: leading,
      }))).result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
      const failure = new Error('synthetic order storage failure')
      vi.spyOn(workspace, 'insertSessionBefore').mockRejectedValueOnce(failure)
      await expect(api.workspace.insertSessionBefore(request({
        workspaceId: created.workspaceId, sessionId: leading,
      }))).rejects.toBe(failure)
      expect(workspace.sessionIds).toEqual([leading, trailing])
    } finally {
      await ctx.fiber.dispose()
    }
  })
})

describe('workspace.insertBefore', () => {
  it('commits the complete order, streams one order frame, and maps unknown ids', async () => {
    const { api, ctx, root } = await harness()
    const first = expectOk(await api.workspace.create(request({ path: stageDir(root, 'first') }))).workspace
    const second = expectOk(await api.workspace.create(request({ path: stageDir(root, 'second') }))).workspace
    const third = expectOk(await api.workspace.create(request({ path: stageDir(root, 'third') }))).workspace

    const abort = new AbortController()
    const listWorkspaces = vi.spyOn(ctx.workspaceRegistry, 'list')
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    expect(listWorkspaces).toHaveBeenCalledTimes(1)
    const changed = nextHostFrame(stream)
    const reordered = expectOk(await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: second.workspaceId,
    })))
    expect(reordered.workspaceIds).toEqual([third.workspaceId, first.workspaceId, second.workspaceId])
    expect(await changed).toMatchObject({
      payload: {
        type: 'host/workspace-order-changed',
        workspaceIds: [third.workspaceId, first.workspaceId, second.workspaceId],
      },
    })
    expect(expectOk(await api.workspace.list(request({}))).items.map(item => item.workspaceId))
      .toEqual(reordered.workspaceIds)

    const missingSource = await api.workspace.insertBefore(request({
      workspaceId: 'missing' as WorkspaceId,
    }))
    expect(missingSource.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing' } },
    })
    const missingAnchor = await api.workspace.insertBefore(request({
      workspaceId: first.workspaceId,
      beforeWorkspaceId: 'missing-anchor' as WorkspaceId,
    }))
    expect(missingAnchor.result).toMatchObject({
      ok: false, error: { code: 'workspace-not-found', details: { workspaceId: 'missing-anchor' } },
    })
    abort.abort()
  })
})

describe('session creation and Workspace membership', () => {
  it('attaches a preallocated idempotent session while cwd-only sessions stay ungrouped', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    const sessionId = SessionId('session-workspace-preallocated')

    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
    expect(ctx.agents.list().filter(agent => agent.id === sessionId)).toHaveLength(1)

    const ungrouped = SessionId('session-cwd-only')
    expectOk(await api.sessions.create(request({ cwd: workspace.path, sessionId: ungrouped })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(ungrouped)

    const conflict = await api.sessions.create(request({ cwd: join(workspace.path, 'other'), sessionId }))
    expect(conflict.result).toMatchObject({
      ok: false,
      error: { code: 'session-conflict', details: { sessionId, existingCwd: workspace.path } },
    })
    const missing = await api.sessions.create(request({
      workspaceId: 'missing-workspace' as WorkspaceId,
      sessionId: SessionId('session-missing-workspace'),
    }))
    expect(missing.result).toMatchObject({ ok: false, error: { code: 'workspace-not-found' } })
  })

  it('retains a published session when attachment fails and repairs it on retry', async () => {
    const { api, ctx, root } = await harness()
    const created = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    const workspace = ctx.workspaceRegistry.list()[0]
    if (workspace === undefined) throw new Error('workspace missing from registry')
    vi.spyOn(workspace, 'attachSession').mockRejectedValueOnce(new Error('simulated write failure'))
    const sessionId = SessionId('session-attach-retry')

    const failed = await api.sessions.create(request({ workspaceId: created.workspaceId, sessionId }))
    expect(failed.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-attach-failed', details: { sessionId, workspaceId: created.workspaceId } },
    })
    expect(ctx.agents.get(sessionId)).toBeDefined()

    expectOk(await api.sessions.create(request({ workspaceId: created.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).items[0]?.sessionIds).toEqual([sessionId])
  })
})

describe('Host Workspace increments', () => {
  it('ignores unrelated domains, unsupported tables and uncommitted deletion notifications', async () => {
    const { api, ctx, root } = await harness()
    const abort = new AbortController()
    try {
      const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
      const stream = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
      const marker = nextHostFrame(stream)
      ctx.emit('domain/changed', { domain: 'unrelated', table: '', key: '', operation: 'put', value: {} })
      ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'deleted' })
      ctx.emit('domain/changed', { domain: 'workspace', table: 'unrelated', key: 'a', operation: 'put', value: {} })
      ctx.emit('domain/changed', { domain: 'workspace', table: 'workspaces', key: 'uncommitted', operation: 'deleted' })
      expectOk(await api.workspace.rename(request({ workspaceId: workspace.workspaceId, title: 'Marker' })))
      expect((await marker).payload).toMatchObject({
        type: 'host/workspace-changed', workspace: { workspaceId: workspace.workspaceId, title: 'Marker' },
      })
      expect(ctx.workspaceRegistry.list()).toHaveLength(1)
    } finally {
      abort.abort()
      await ctx.fiber.dispose()
    }
  })

  it('rejects a committed registry notification that refers to a missing workspace', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    try {
      const stream = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
      const pending = stream.next()
      expect(() => { ctx.emit('domain/changed', {
        domain: 'workspace', table: '', key: '', operation: 'put',
        value: { initialized: true, workspaceIds: ['missing-workspace'], archivedSessionIds: [] },
      }) }).toThrow('committed workspace registry references missing workspace "missing-workspace"')
      abort.abort()
      expect(await pending).toEqual({ done: true, value: undefined })
    } finally {
      abort.abort()
      await ctx.fiber.dispose()
    }
  })

  it('does not repeat an unchanged archive snapshot when the workspace registry gains another member', async () => {
    const { api, ctx, root } = await harness()
    const abort = new AbortController()
    try {
      const first = expectOk(await api.workspace.create(request({ path: stageDir(root, 'first') }))).workspace
      const sessionId = SessionId('archived-baseline')
      expectOk(await api.sessions.create(request({ workspaceId: first.workspaceId, sessionId })))
      expectOk(await api.workspace.archiveSession(request({ sessionId })))
      const stream = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
      const created = nextHostFrame(stream)
      const second = expectOk(await api.workspace.create(request({ path: stageDir(root, 'second') }))).workspace
      expect((await created).payload).toMatchObject({ type: 'host/workspace-changed', workspace: { workspaceId: second.workspaceId } })
      const marker = nextHostFrame(stream)
      expectOk(await api.workspace.rename(request({ workspaceId: second.workspaceId, title: 'Marker after registry write' })))
      expect((await marker).payload).toMatchObject({
        type: 'host/workspace-changed', workspace: { workspaceId: second.workspaceId, title: 'Marker after registry write' },
      })
      expect(ctx.workspaceRegistry.archivedSessionIds).toEqual([sessionId])
    } finally {
      abort.abort()
      await ctx.fiber.dispose()
    }
  })

  it('does not deliver an event whose earlier observer cancels the host stream', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    try {
      ctx.on('agent/status', () => { abort.abort() })
      const stream = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
      const pending = stream.next()
      const session = ctx.sessions.prepare(SessionId('cancelled-status'), { meta: { cwd: '/synthetic' } })
      agentEvents(ctx, stubAgent(session)).emit('agent/status', { status: 'running' })
      expect(await pending).toEqual({ done: true, value: undefined })
    } finally {
      abort.abort()
      await ctx.fiber.dispose()
    }
  })

  it('streams paired session disposal and agent status/error notifications', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    const stream = api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    let detach = () => {}
    try {
      const session = ctx.sessions.prepare(SessionId('lifecycle-session'), { meta: { cwd: '/synthetic' } })
      detach = ctx.sessions.enter(session)
      const creation = nextHostFrame(stream)
      ctx.sessions.announce(session)
      expect((await creation).payload).toMatchObject({ type: 'host/session-added', sessionId: session.id })
      const agent = stubAgent(session)
      const events = agentEvents(ctx, agent)
      const status = nextHostFrame(stream)
      events.emit('agent/status', { status: 'running' })
      expect((await status).payload).toEqual({ type: 'host/session-status', sessionId: session.id, running: true })
      const failure = nextHostFrame(stream)
      events.emit('agent/error', { turn: 1, step: 1, error: new Error('synthetic turn error') })
      const frame = (await failure).payload
      expect(frame.type).toBe('host/agent-error')
      if (frame.type !== 'host/agent-error') throw new Error('missing error frame')
      expect(frame.sessionId).toBe(session.id)
      expect(frame.message).toContain('synthetic turn error')
      const disposed = nextHostFrame(stream)
      detach()
      expect((await disposed).payload).toEqual({ type: 'host/session-removed', sessionId: session.id })
      expect(ctx.sessions.get(session.id)).toBeUndefined()
    } finally {
      abort.abort()
      detach()
      await ctx.fiber.dispose()
    }
  })

  it('projects subagent origin in attached summaries and creation increments', async () => {
    const { api, ctx } = await harness()
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const pending = nextHostFrame(stream)
    const childId = SessionId('session-subagent-child')

    ctx.sessions.create(childId, {
      meta: {
        cwd: '/tmp',
        parentSession: SessionId('session-parent'),
        origin: 'subagent',
      },
    })

    expect(await pending).toMatchObject({
      payload: {
        type: 'host/session-added',
        sessionId: childId,
        parentSessionId: 'session-parent',
        origin: 'subagent',
      },
    })
    expect(expectOk(await api.sessions.list(request({}))).items).toContainEqual(
      expect.objectContaining({ sessionId: childId, origin: 'subagent' }),
    )
    abort.abort()
  })

  it('streams committed Workspace and Session increments after empty baselines', async () => {
    const { api, root } = await harness()
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const workspaceIncrement = nextHostFrame(stream)
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'project') }))).workspace
    expect(await workspaceIncrement).toMatchObject({
      payload: { type: 'host/workspace-changed', workspace: { workspaceId: workspace.workspaceId } },
    })

    const sessionId = SessionId('session-streamed-workspace')
    const pending = nextHostFrame(stream)
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    const increments: HostFrame[] = []
    increments.push((await pending).payload)
    while (increments.length < 2) {
      const next = await stream.next()
      if (next.done === true) throw new Error('Host stream ended before both increments')
      increments.push(next.value.payload)
    }
    expect(increments.find(increment => increment.type === 'host/session-added')).toMatchObject({
      // A just-created session has no events: the frame constantly carries blank:true.
      type: 'host/session-added', sessionId, blank: true, cwd: workspace.path,
    })
    const workspaceChanged = increments.find(
      (increment): increment is Extract<HostFrame, { type: 'host/workspace-changed' }> =>
        increment.type === 'host/workspace-changed',
    )
    expect(workspaceChanged?.workspace.sessionIds).toEqual([sessionId])
    abort.abort()
  })

  it('does not publish a Workspace whose registry-order commit fails', async () => {
    const { api, storageDomain, root } = await harness()
    const domain = storageDomain.get('workspace')
    if (domain === undefined) throw new Error('workspace domain is not open')
    vi.spyOn(domain.global, 'set').mockRejectedValueOnce(new Error('simulated registry order failure'))
    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const next = stream.next()

    const failed = await api.workspace.create(request({ path: stageDir(root, 'ghost') }))
    expect(failed.result.ok).toBe(false)
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    abort.abort()
    expect(await next).toMatchObject({ done: true })
  })

  it('deletes the registration, keeps its session and folder, and streams one removal', async () => {
    const { api, ctx, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'delete-me') }))).workspace
    const sessionId = SessionId('session-kept-after-workspace-delete')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const removed = nextHostFrame(stream)
    expectOk(await api.workspace.delete(request({ workspaceId: workspace.workspaceId })))
    expect(await removed).toMatchObject({
      payload: { type: 'host/workspace-removed', workspaceId: workspace.workspaceId },
    })
    expect(expectOk(await api.workspace.list(request({}))).items).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    expect(ctx.agents.get(sessionId)).toBeDefined()
    expect(existsSync(workspace.path)).toBe(true)

    const missing = await api.workspace.delete(request({ workspaceId: workspace.workspaceId }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'workspace-not-found', details: { workspaceId: workspace.workspaceId } },
    })

    const reregistered = expectOk(await api.workspace.create(request({ path: workspace.path }))).workspace
    expect(reregistered.workspaceId).not.toBe(workspace.workspaceId)
    expect(reregistered.path).toBe(workspace.path)
    expect(reregistered.sessionIds).toEqual([])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)
    abort.abort()
  })

  it('archives a session into the global set, keeps its accounting, and streams the set once', async () => {
    const { api, root } = await harness()
    const workspace = expectOk(await api.workspace.create(request({ path: stageDir(root, 'archive-home') }))).workspace
    const sessionId = SessionId('session-to-archive')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId })))
    expect(expectOk(await api.workspace.list(request({}))).archivedSessionIds).toEqual([])

    const abort = new AbortController()
    const stream: AsyncIterator<RpcRequest<HostFrame>> =
      api.events.host(request({}), abort.signal)[Symbol.asyncIterator]()
    const changed = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    expect(await changed).toMatchObject({
      payload: { type: 'host/archived-sessions-changed', archivedSessionIds: [sessionId] },
    })

    // Accounting and the session itself are untouched; list re-baselines the set.
    const listed = expectOk(await api.workspace.list(request({})))
    expect(listed.archivedSessionIds).toEqual([sessionId])
    expect(listed.items[0]?.sessionIds).toEqual([sessionId])
    expect(expectOk(await api.sessions.list(request({}))).items.map(item => item.sessionId)).toContain(sessionId)

    // The idempotent repeat emits no second frame: the next observed frame is
    // the workspace-changed of a later attach, not another archive snapshot.
    const after = nextHostFrame(stream)
    expect(expectOk(await api.workspace.archiveSession(request({ sessionId }))).archivedSessionIds)
      .toEqual([sessionId])
    const otherSession = SessionId('session-after-archive')
    expectOk(await api.sessions.create(request({ workspaceId: workspace.workspaceId, sessionId: otherSession })))
    expect((await after).payload.type).not.toBe('host/archived-sessions-changed')

    const missing = await api.workspace.archiveSession(request({ sessionId: SessionId('session-ghost') }))
    expect(missing.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found', details: { sessionId: 'session-ghost' } },
    })
    abort.abort()
  })
})
