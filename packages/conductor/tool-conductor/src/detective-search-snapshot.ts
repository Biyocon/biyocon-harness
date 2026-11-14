/** Child-owned immutable search artifacts, independent of the live workspace. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import { join } from 'node:path'
import type { ConductorRunId } from '@deepseek-ai/dsh-conductor'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {
  DetectiveSearchDigest, DetectiveSearchKind, DetectiveSearchSnapshotId,
} from './detective-search-page.ts'

/** Host-owned namespace; model arguments never select an owner. */
export interface DetectiveSearchOwner {
  readonly runId: ConductorRunId
  readonly childId: SessionId
}

/** Complete discovery result saved before returning its first bounded page. */
export interface DetectiveSearchSnapshot {
  readonly kind: DetectiveSearchKind
  readonly query: { readonly pattern: string; readonly path?: string; readonly include?: string }
  readonly entries: readonly string[]
}

/** The random artifact identity and its content checksum. */
export interface DetectiveSearchReference {
  readonly snapshotId: DetectiveSearchSnapshotId
  readonly digest: DetectiveSearchDigest
}

function digest(text: string): DetectiveSearchDigest {
  return createHash('sha256').update(text).digest('hex') as DetectiveSearchDigest
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function validSnapshot(value: unknown): value is DetectiveSearchSnapshot {
  if (!record(value) || value.kind !== 'glob' && value.kind !== 'grep' || !record(value.query)) return false
  const query = value.query
  return typeof query.pattern === 'string'
    && (query.path === undefined || typeof query.path === 'string')
    && (query.include === undefined || typeof query.include === 'string')
    && Array.isArray(value.entries) && value.entries.every(entry => typeof entry === 'string')
}

/** Read at most the observed bounded size plus one byte; changed files fail instead of growing the allocation. */
async function readSnapshotFile(file: FileHandle, maxBytes: number, signal: AbortSignal): Promise<string> {
  const info = await file.stat()
  if (!info.isFile() || info.size > maxBytes) throw new Error('Saved Detective search snapshot exceeds its storage limit or is not a file')
  const bytes = Buffer.alloc(info.size + 1)
  let length = 0
  while (length < bytes.length) {
    signal.throwIfAborted()
    const result = await file.read(bytes, length, bytes.length - length, length)
    if (result.bytesRead === 0) break
    length += result.bytesRead
  }
  if (length !== info.size) throw new Error('Saved Detective search snapshot changed while being read')
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))
}

/** Local host storage for bounded Detective search snapshots. */
export class DetectiveSearchSnapshotStore {
  /**
   * Configure private artifact storage; no filesystem operation occurs here.
   * @param root - the host's validated absolute artifact directory.
   * @param maxBytes - validated maximum serialized bytes per snapshot.
   */
  constructor(private readonly root: string, private readonly maxBytes: number) {}

  private directory(owner: DetectiveSearchOwner): string {
    return join(this.root, digest(JSON.stringify([owner.runId, owner.childId])))
  }

  /**
   * Persist all entries before publishing a usable reference. Failed writes leave no published cursor.
   * @param owner - the producing run and child, selected by the host.
   * @param snapshot - complete query result; never reread from the workspace during pagination.
   * @param signal - cancellation for the owning tool call.
   * @returns a random artifact id and checksum independent of the owner id.
   * @throws on cancellation, an oversized snapshot, or storage failure.
   */
  async save(owner: DetectiveSearchOwner, snapshot: DetectiveSearchSnapshot, signal: AbortSignal): Promise<DetectiveSearchReference> {
    signal.throwIfAborted()
    const content = JSON.stringify({ version: 1, owner, snapshot })
    if (Buffer.byteLength(content) > this.maxBytes) throw new Error('Detective search snapshot exceeds its storage limit; narrow the query')
    const directory = this.directory(owner)
    await mkdir(directory, { recursive: true, mode: 0o700 })
    signal.throwIfAborted()
    const snapshotId = randomUUID() as DetectiveSearchSnapshotId
    const file = await open(join(directory, `${snapshotId}.json`), 'wx', 0o600)
    try {
      await file.writeFile(content, { encoding: 'utf8', signal })
      await file.sync()
    } finally {
      await file.close()
    }
    signal.throwIfAborted()
    return { snapshotId, digest: digest(JSON.stringify(snapshot)) }
  }

  /**
   * Load one immutable source by a parsed cursor and verify its owner, kind and checksum.
   * @param owner - current host-owned run and child.
   * @param reference - artifact id and checksum decoded from a validated cursor.
   * @param kind - the search tool receiving the continuation.
   * @param signal - cancellation for the owning tool call.
   * @returns the complete saved result, never a newly executed search.
   * @throws for missing, changed, invalid, foreign, oversized or unreadable artifacts.
   */
  async load(
    owner: DetectiveSearchOwner, reference: DetectiveSearchReference, kind: DetectiveSearchKind, signal: AbortSignal,
  ): Promise<DetectiveSearchSnapshot> {
    signal.throwIfAborted()
    const file = await open(join(this.directory(owner), `${reference.snapshotId}.json`), 'r')
    let content: string
    try {
      content = await readSnapshotFile(file, this.maxBytes, signal)
    } finally {
      await file.close()
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      // JSON parser diagnostics can quote private source text; expose only the failed artifact condition.
      throw new Error('Saved Detective search snapshot contains invalid JSON')
    }
    if (!record(parsed) || parsed.version !== 1 || !record(parsed.owner)
      || parsed.owner.runId !== owner.runId || parsed.owner.childId !== owner.childId || !validSnapshot(parsed.snapshot)) {
      throw new Error('Saved Detective search snapshot has invalid ownership or format')
    }
    if (parsed.snapshot.kind !== kind || digest(JSON.stringify(parsed.snapshot)) !== reference.digest) {
      throw new Error('Saved Detective search snapshot does not match its cursor')
    }
    signal.throwIfAborted()
    return parsed.snapshot
  }
}
