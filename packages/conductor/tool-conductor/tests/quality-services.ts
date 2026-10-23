import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import { SandboxProvider } from '@deepseek-ai/dsh-sandbox'
import type { ConfinedArgv, SandboxPolicy } from '@deepseek-ai/dsh-sandbox'
import { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import type {
  SubprocessHandle,
  SubprocessOutputRead,
  SubprocessSpawnSpec,
  SubprocessTerminalHandle,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'

class FullSandbox extends SandboxProvider {
  confine(argv: readonly string[], _policy: SandboxPolicy): ConfinedArgv {
    return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
  }
}

export class RecordingSubprocess extends SubprocessRuntime {
  readonly specs: SubprocessSpawnSpec[] = []
  resolveExecutable(command: string): Promise<string> { return Promise.resolve(command) }
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle {
    this.specs.push(spec)
    const read = (text: string): SubprocessOutputRead => ({ text, nextOffset: text.length, lossy: false })
    return {
      pid: this.specs.length,
      stdin: undefined,
      stdout: undefined,
      stderr: undefined,
      collected: {
        stdout: { readFrom: () => read('quality passed') },
        stderr: { readFrom: () => read('') },
      },
      done: Promise.resolve({ exitCode: 0, signal: null }),
      terminate: () => {},
      waitForExit: () => Promise.resolve(true),
    }
  }
  spawnTerminal(_spec: SubprocessTerminalSpawnSpec): Promise<SubprocessTerminalHandle> {
    return Promise.resolve({
      pid: 1,
      output: new PassThrough(),
      done: Promise.resolve({ exitCode: 0, signal: null }),
      write: () => Promise.resolve(),
      inspectForeground: () => Promise.resolve({ processGroupId: 1, inputWaiting: true }),
      signalForeground: () => Promise.resolve(1),
      terminate: () => Promise.resolve(),
    })
  }
}

export async function mountQualityServices(ctx: Context): Promise<void> {
  await ctx.plugin(FullSandbox)
  await ctx.plugin(RecordingSubprocess)
}
