import { createHash } from 'node:crypto'
import { appendFile, mkdtemp, open, readFile, readdir, stat, truncate, writeFile } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { ConductorRunId } from '@deepseek-ai/dsh-conductor'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DetectiveSearchSnapshotStore } from '../src/detective-search-snapshot.ts'
import type { DetectiveSearchSnapshot } from '../src/detective-search-snapshot.ts'
import type { DetectiveSearchDigest } from '../src/detective-search-page.ts'

const owner = { runId: ConductorRunId('CON-2026-1234'), childId: SessionId('synthetic-detective') }
const snapshot: DetectiveSearchSnapshot = {
  kind: 'glob', query: { pattern: '**/*.ts', path: '.' }, entries: ['src/a.ts', 'test/a.spec.ts'],
}
const signal = () => new AbortController().signal

async function setup(maxBytes = 20_000) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-detective-search-'))
  const store = new DetectiveSearchSnapshotStore(root, maxBytes)
  const directory = join(root, createHash('sha256').update(JSON.stringify([owner.runId, owner.childId])).digest('hex'))
  return { root, store, directory }
}

describe('Detective immutable search snapshots', () => {
  it('loads the same source through a new store instance without touching workspace files', async () => {
    const { root, store } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    const resumed = new DetectiveSearchSnapshotStore(root, 20_000)
    expect(await resumed.load(owner, reference, 'glob', signal())).toEqual(snapshot)
  })

  it('uses exclusive random artifact names while keeping equal source checksums stable', async () => {
    const { store, directory } = await setup()
    const first = await store.save(owner, snapshot, signal())
    const second = await store.save(owner, snapshot, signal())
    expect(first.snapshotId).not.toBe(second.snapshotId)
    expect(first.digest).toBe(second.digest)
    expect(await readdir(directory)).toHaveLength(2)
  })

  it('retains grep query identity and every formatted line', async () => {
    const { store } = await setup()
    const result: DetectiveSearchSnapshot = {
      kind: 'grep', query: { pattern: 'finding', path: '.', include: '*.ts' },
      entries: ['src/a.ts:3: first finding', 'src/b.ts:7: adverse finding'],
    }
    const reference = await store.save(owner, result, signal())
    expect(await store.load(owner, reference, 'grep', signal())).toEqual(result)
  })

  it('includes ownership and framing bytes in the exact storage limit', async () => {
    const maxBytes = Buffer.byteLength(JSON.stringify({ version: 1, owner, snapshot }))
    const { store, root } = await setup(maxBytes)
    const reference = await store.save(owner, snapshot, signal())
    expect(await store.load(owner, reference, 'glob', signal())).toEqual(snapshot)
    await expect(new DetectiveSearchSnapshotStore(root, maxBytes - 1).save(owner, snapshot, signal()))
      .rejects.toThrow('exceeds its storage limit')
  })

  it('isolates producing children and never accepts a foreign namespace', async () => {
    const { store } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    await expect(store.load({ ...owner, childId: SessionId('another-child') }, reference, 'glob', signal())).rejects.toThrow()
    await expect(store.load({ ...owner, runId: ConductorRunId('CON-2026-5678') }, reference, 'glob', signal())).rejects.toThrow()
  })

  it('rejects a cursor for another search kind or checksum', async () => {
    const { store } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    await expect(store.load(owner, reference, 'grep', signal())).rejects.toThrow('does not match its cursor')
    await expect(store.load(owner, { ...reference, digest: '0'.repeat(64) as DetectiveSearchDigest }, 'glob', signal()))
      .rejects.toThrow('does not match its cursor')
  })

  it('rejects missing files without starting a replacement search', async () => {
    const { root, store } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    const empty = await setup()
    expect(root).not.toBe(empty.root)
    await expect(empty.store.load(owner, reference, 'glob', signal())).rejects.toThrow()
  })

  it('rejects a snapshot before creating artifacts when its complete serialized bytes exceed the cap', async () => {
    const { store, root } = await setup(1)
    await expect(store.save(owner, snapshot, signal())).rejects.toThrow('exceeds its storage limit')
    expect(await readdir(root)).toEqual([])
  })

  it('enforces the read cap on a saved artifact', async () => {
    const { root, store } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    await expect(new DetectiveSearchSnapshotStore(root, 1).load(owner, reference, 'glob', signal()))
      .rejects.toThrow('exceeds its storage limit')
  })

  it('does not quote corrupt artifact content in its JSON error', async () => {
    const { store, directory } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    await writeFile(join(directory, `${reference.snapshotId}.json`), 'synthetic-private-marker: broken JSON')
    await expect(store.load(owner, reference, 'glob', signal()))
      .rejects.toMatchObject({ message: 'Saved Detective search snapshot contains invalid JSON' })
  })

  it.each(['shrink', 'grow'] as const)('rejects a file that changes size after the bounded allocation: %s', async (change) => {
    const { store, directory } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    const path = join(directory, `${reference.snapshotId}.json`)
    const observed = await stat(path)
    const probe = await open(path, 'r')
    // Pin the stat/read interleaving while the owned file and all reads remain real.
    const intercept = vi.spyOn(Object.getPrototypeOf(probe) as FileHandle, 'stat').mockImplementationOnce(async () => {
      if (change === 'shrink') await truncate(path, observed.size - 1)
      else await appendFile(path, 'more bytes')
      return observed
    })
    try {
      await expect(store.load(owner, reference, 'glob', signal())).rejects.toThrow('changed while being read')
    } finally {
      intercept.mockRestore()
      await probe.close()
    }
  })

  it.each([
    null,
    { version: 2 },
    { version: 1, owner: null },
    { version: 1, owner: { ...owner, childId: 'another-child' }, snapshot },
    { version: 1, owner, snapshot: { ...snapshot, kind: 'write' } },
    { version: 1, owner, snapshot: { ...snapshot, query: null } },
    { version: 1, owner, snapshot: { ...snapshot, query: { pattern: 1 } } },
    { version: 1, owner, snapshot: { ...snapshot, query: { pattern: '*', path: 1 } } },
    { version: 1, owner, snapshot: { ...snapshot, query: { pattern: '*', include: 1 } } },
    { version: 1, owner, snapshot: { ...snapshot, entries: [1] } },
    { version: 1, owner, snapshot: { ...snapshot, entries: null } },
  ])('rejects invalid durable snapshot data: %j', async (value) => {
    const { store, directory } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    await writeFile(join(directory, `${reference.snapshotId}.json`), JSON.stringify(value))
    await expect(store.load(owner, reference, 'glob', signal())).rejects.toThrow('invalid ownership or format')
  })

  it('detects changed results even when ownership and format remain valid', async () => {
    const { store, directory } = await setup()
    const reference = await store.save(owner, snapshot, signal())
    const path = join(directory, `${reference.snapshotId}.json`)
    const saved = JSON.parse(await readFile(path, 'utf8')) as { snapshot: { entries: string[] } }
    saved.snapshot.entries.push('later/changed.ts')
    await writeFile(path, JSON.stringify(saved))
    await expect(store.load(owner, reference, 'glob', signal())).rejects.toThrow('does not match its cursor')
  })

  it('honors cancellation before saving or reading', async () => {
    const { store, root } = await setup()
    const controller = new AbortController()
    controller.abort(new Error('synthetic cancellation'))
    await expect(store.save(owner, snapshot, controller.signal)).rejects.toThrow('synthetic cancellation')
    expect(await readdir(root)).toEqual([])
    const reference = await store.save(owner, snapshot, signal())
    await expect(store.load(owner, reference, 'glob', controller.signal)).rejects.toThrow('synthetic cancellation')
  })
})
