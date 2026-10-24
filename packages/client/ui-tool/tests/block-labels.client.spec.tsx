// @vitest-environment jsdom
/** Tool card copy follows the locale in both chat and the selected-call panel. */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render } from '@testing-library/react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import type { ToolResultNode } from '@deepseek-ai/dsh-client-runtime/client'
import { da, en } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { da as commonDa } from '@deepseek-ai/dsh-client-locale/src/locales/da.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { ToolDetails } from '../src/client/tool/ToolDetails.tsx'
import { ToolRow } from '../src/client/tool/components/ToolRow.tsx'
import { resultBlockLabels } from '../src/client/tool/models/block-labels.ts'

afterEach(cleanup)

describe('structured result labels', () => {
  it.each([
    { dictionary: en, common: commonEn, expand: '… 3 more lines', summary: 'Showing 2 / 5 matches · 1 files', file: '1 file' },
    { dictionary: da, common: commonDa, expand: '… 3 flere linjer', summary: 'Viser 2 / 5 fund · 1 filer', file: '1 fil' },
  ])('resolves all card controls from the selected dictionary: $file', ({ dictionary, common, expand, summary, file }) => {
    const t = makeTranslate(dictionary, common)
    const labels = resultBlockLabels(t)
    expect(labels.diff.expand(3)).toBe(expand)
    expect(labels.read.expand(3)).toBe(expand)
    expect(labels.search.expand(3)).toBe(expand)
    expect(labels.diff.files(1)).toBe(file)
    expect(labels.diff.files(2)).toBe(t('diff.files', { n: 2 }))
    expect(labels.diff.expandAria(3)).toBe(t('diff.expandAria', { n: 3 }))
    expect(labels.read.expandAria(3)).toBe(t('read.expandAria', { n: 3 }))
    expect(labels.search.expandAria(3)).toBe(t('search.expandAria', { n: 3 }))
    expect(labels.read.window(2, 5)).toBe(t('read.window', { shown: 2, total: 5 }))
    expect(labels.search.summary(2, 5, 1, true)).toBe(summary)
    expect(labels.search.summary(2, 2, null, false)).toBe(t('search.paths', { count: '2' }))
  })

  it.each([
    { dictionary: en, common: commonEn, empty: 'No results found', capped: 'Content truncated' },
    { dictionary: da, common: commonDa, empty: 'Ingen resultater fundet', capped: 'Indholdet er afkortet' },
  ])('passes current web labels to chat and details: $empty', ({ dictionary, common, empty, capped }) => {
    const t = makeTranslate(dictionary, common)
    const resultView: ToolResultNode['resultView'] = { card: 'web', kind: 'search', sources: [], truncated: false }
    const block: ToolResultNode = {
      kind: 'tool-result', seq: 1, time: 2_000, callId: 'c1',
      call: { name: 'web_search', argsRaw: '{}' }, callTime: 1_000,
      content: [], isError: false, callView: null, resultView, subCalls: [],
    }
    const chat = render(<ToolRow
      t={t} title="Web" icon={null} variant="search" summary="query" body={null} state="ok"
      web={{ kind: 'search', sources: [], truncated: false }}
    />)
    fireEvent.click(chat.getByRole('button', { expanded: false }))
    expect(chat.getByText(empty)).toBeTruthy()
    chat.unmount()
    const details = render(<ToolDetails t={t} block={block} />)
    expect(details.getByText(empty)).toBeTruthy()
    details.rerender(<ToolDetails t={t} block={{ ...block, resultView: {
      card: 'web', kind: 'fetch', url: 'https://example.com', statusCode: 200, truncated: true,
    } }} />)
    expect(details.getByText(capped)).toBeTruthy()
  })
})
