/** Shipped UI dictionaries retain their English keys, interpolation fields, and supported languages. */
import { globSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import ts from 'typescript'

function dictionaries(path: string): Map<string, Map<string, string>> {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
  const result = new Map<string, Map<string, string>>()
  function visit(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer !== undefined) {
      let value = node.initializer
      while (ts.isSatisfiesExpression(value) || ts.isAsExpression(value)) value = value.expression
      if (ts.isObjectLiteralExpression(value)) {
        const fields = new Map<string, string>()
        for (const property of value.properties) {
          if (!ts.isPropertyAssignment(property)) continue
          const key = property.name.getText(source).replace(/^['"]|['"]$/g, '')
          // Expressions such as shared onboarding copy retain the same keys;
          // their rendered values are exercised by the assembled browser lane.
          fields.set(key, ts.isStringLiteralLike(property.initializer) ? property.initializer.text : '')
        }
        result.set(node.name.text, fields)
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

const files = [...globSync('packages/**/src/client/locales.ts'), 'packages/client/locale/src/locales/settings.ts']
const placeholders = (text: string): string[] => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]!).sort()

describe('shipped UI translations', () => {
  it.each(['ui-conversation', 'ui-permission-presets'])('%s owns translated permission product labels', (plugin) => {
    const bundles = dictionaries(`packages/client/${plugin}/src/client/locales.ts`)
    for (const [english, danish] of [['en', 'da'], ...(plugin === 'ui-permission-presets' ? [['accessEn', 'accessDa']] : [])]) {
      for (const [key, en, da] of [
        ['permission.preset.readOnly', 'Read Only', 'Skrivebeskyttet'],
        ['permission.preset.workspaceWrite', 'Workspace Write', 'Skriv i arbejdsområde'],
        ['permission.preset.fullAccess', 'Full access', 'Fuld adgang'],
      ]) {
        expect(bundles.get(english!)?.get(key!)).toBe(en)
        expect(bundles.get(danish!)?.get(key!)).toBe(da)
      }
    }
  })

  it.each([
    'packages/client/ui-conversation/src/client/skeleton/PermissionSelect.tsx',
    'packages/client/ui-permission-presets/src/client/presentation.ts',
  ])('%s does not hardcode permission product labels outside dictionaries', (path) => {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node): void {
      if (ts.isStringLiteralLike(node)) expect(node.text).not.toMatch(/^(Read Only|Workspace Write|Full access)$/)
      ts.forEachChild(node, visit)
    }
    visit(source)
  })

  it('keeps primitive string defaults free of Chinese application copy', () => {
    for (const path of globSync('packages/client/ui-primitives/src/**/*.tsx')) {
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function visit(node: ts.Node): void {
        if (ts.isStringLiteralLike(node)) expect(node.text, path).not.toMatch(/\p{Script=Han}/u)
        ts.forEachChild(node, visit)
      }
      visit(source)
    }
  })

  it.each(['standard', 'code', 'minimal', 'cordis', 'conductor'])('%s preset metadata contains no Chinese UI copy', (id) => {
    expect(readFileSync(`apps/cli/config/agent-presets/${id}/preset.yml`, 'utf8')).not.toMatch(/\p{Script=Han}/u)
  })

  it.each(files)('%s has matching English and Danish keys and interpolation fields', (path) => {
    const bundles = dictionaries(path)
    expect(bundles.has('zh')).toBe(false)
    for (const [englishName, danishName] of [['en', 'da'], ['accessEn', 'accessDa']] as const) {
      const english = bundles.get(englishName)
      if (english === undefined) continue
      const danish = bundles.get(danishName)
      expect(danish).toBeDefined()
      expect([...danish!.keys()].sort()).toEqual([...english.keys()].sort())
      for (const [key, text] of english) {
        const translated = danish!.get(key)!
        expect(translated, key).not.toMatch(/\p{Script=Han}/u)
        expect(text, key).not.toMatch(/\p{Script=Han}/u)
        expect(placeholders(translated), key).toEqual(placeholders(text))
      }
    }
  })

  it('keeps common Danish copy aligned with the English key set', () => {
    const english = dictionaries('packages/client/locale/src/locales/en.ts').get('en')!
    const danish = dictionaries('packages/client/locale/src/locales/da.ts').get('da')!
    expect([...danish.keys()].sort()).toEqual([...english.keys()].sort())
    for (const text of danish.values()) expect(text).not.toMatch(/\p{Script=Han}/u)
  })
})
