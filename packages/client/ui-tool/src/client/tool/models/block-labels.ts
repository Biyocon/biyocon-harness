/** Localized card copy shared by chat rows and the selected-call details panel. */
import type { DiffBlockLabels, ReadBlockLabels, SearchBlockLabels, WebBlockLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import type { TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Resolve primitive display labels from the render site's locale seat.
 * @param t - conversation translator, including common copy labels.
 * @returns complete label sets for the four structured result cards.
 */
export function resultBlockLabels(t: TranslateNS<'conversation'>): {
  diff: DiffBlockLabels
  read: ReadBlockLabels
  search: SearchBlockLabels
  web: WebBlockLabels
} {
  const common = {
    copy: t('copy'), copied: t('copied'), collapse: t('collapse'),
    expand: (n: number) => t('card.expand', { n }),
  }
  return {
    diff: {
      ...common,
      collapseAria: t('diff.collapseAria'),
      expandAria: n => t('diff.expandAria', { n }),
      files: n => t(n === 1 ? 'diff.file' : 'diff.files', { n }),
    },
    read: {
      ...common,
      collapseAria: t('read.collapseAria'),
      expandAria: n => t('read.expandAria', { n }),
      window: (shown, total) => t('read.window', { shown, total }),
    },
    search: {
      ...common,
      collapseAria: t('search.collapseAria'),
      expandAria: n => t('search.expandAria', { n }),
      empty: t('search.empty'),
      summary: (shown, total, files, truncated) => {
        const count = truncated ? t('search.showing', { shown, total }) : String(shown)
        return files === null ? t('search.paths', { count }) : t('search.matches', { count, files })
      },
    },
    web: {
      empty: t('web.empty'), sourceTruncated: t('web.sourceTruncated'), contentTruncated: t('web.contentTruncated'),
    },
  }
}
