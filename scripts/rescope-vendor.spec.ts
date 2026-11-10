/**
 * Acceptance-path coverage for the rescope codemod's exact-edit classifier: a
 * duplicated insertion — what a non-idempotent apply produces — must be
 * rejected rather than applied again.
 */

import { describe, expect, it } from 'vitest'
import { exactEditState, rescopePackageTokens } from './rescope-vendor.ts'

const ANCHOR = '\n## Sync procedure'
const INSERTED = `\n15. **rescope**: one log entry.\n${ANCHOR}`

describe('package names versus runtime identifiers', () => {
  const labelFile = 'packages/extensions/ui-cordis/src/client/locales.ts'

  it('preserves event declarations, filters, escaped signatures and UI namespaces', () => {
    const text = [
      "export const NS = 'cordis'",
      "ctx.on('cordis/request-run', handler)",
      "const visible = !name.startsWith('cordis/')",
      String.raw`const signature = '\'cordis/dynamic-package\'(pkg: Package): void'`,
    ].join('\n')
    expect(rescopePackageTokens(text, labelFile)).toBe(text)
  })

  it.each([
    "import { Context } from 'cordis'",
    "export { Context } from\n  'cordis'",
    "import 'cordis/request-run'",
    "import /* side-effect module */ 'cordis/request-run'",
    "import { Context } from\n/* module comment */ 'cordis'",
    "const module = import(\n  'cordis/request-run')",
    "const module = require('cordis/package.json')",
    "const file = require.resolve('cordis/package.json')",
    "declare module 'cordis' {}",
  ])('still rewrites a module reference inside an identifier-bearing file: %s', (text) => {
    const renamed = text.replaceAll("'cordis", "'@deepseek-ai/cordis")
    expect(rescopePackageTokens(text, labelFile)).toBe(renamed)
    expect(rescopePackageTokens(renamed, labelFile, true)).toBe(text)
    expect(rescopePackageTokens(renamed, labelFile)).toBe(renamed)
  })

  it('preserves documented event namespaces while rewriting module examples', () => {
    const text = "`cordis/*` events\n```ts\nimport { Context } from 'cordis'\nctx.on('cordis/request-run', handler)\n```\n"
    expect(rescopePackageTokens(text, 'docs/subsystems/extensions.md'))
      .toBe(text.replace("from 'cordis'", "from '@deepseek-ai/cordis'"))
  })

  it('keeps package manifests and unrelated package-name strings checked', () => {
    expect(rescopePackageTokens('{"dependencies":{"cordis":"*"}}', 'package.json'))
      .toBe('{"dependencies":{"@deepseek-ai/cordis":"*"}}')
    expect(rescopePackageTokens("const pkg = 'cordis'", 'packages/example/source.ts'))
      .toBe("const pkg = '@deepseek-ai/cordis'")
  })
})

describe('exactEditState', () => {
  it('classifies an insertion by its target form, so a duplicate is invalid', () => {
    expect(exactEditState(`log\n${ANCHOR}\n`, ANCHOR, INSERTED, 1)).toBe('pending')
    expect(exactEditState(`log${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('applied')
    // The anchor survives an insertion, so counting the source form would have
    // called this pending and inserted the entry a second time.
    expect(exactEditState(`log${INSERTED}${INSERTED}\n`, ANCHOR, INSERTED, 1)).toBe('invalid')
    expect(exactEditState('log\n', ANCHOR, INSERTED, 1)).toBe('invalid')
  })

  it('classifies a deletion by its source form, and requires its remainder to survive', () => {
    const remainder = 'exclude:\n'
    const withEntries = 'exclude:\n  - cordis@4\n'
    expect(exactEditState(withEntries, withEntries, remainder, 1)).toBe('pending')
    expect(exactEditState(remainder, withEntries, remainder, 1)).toBe('applied')
    // Upstream dropped the whole field: the source form is gone, but so is the
    // remainder, so this is a moved site rather than a completed deletion.
    expect(exactEditState('unrelated:\n', withEntries, remainder, 1)).toBe('invalid')
  })

  it('requires a replacement to leave no source form and the exact target count', () => {
    expect(exactEditState('a = 1\n', 'a = 1', 'b = 2', 1)).toBe('pending')
    expect(exactEditState('b = 2\n', 'a = 1', 'b = 2', 1)).toBe('applied')
    expect(exactEditState('b = 2\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    // A moved or partially applied site: neither state is complete.
    expect(exactEditState('a = 1\nb = 2\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
    expect(exactEditState('x\n', 'a = 1', 'b = 2', 1)).toBe('invalid')
  })
})
