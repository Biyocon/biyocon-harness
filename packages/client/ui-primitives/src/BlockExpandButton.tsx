/** Shared overflow toggle for structured result cards; callers own copy and styling. */

/** Display copy needed by a structured card's overflow toggle. */
interface BlockExpandLabels {
  collapse: string
  collapseAria: string
  expand: (hidden: number) => string
  expandAria: (hidden: number) => string
}

interface BlockExpandButtonProps {
  hidden: number
  expanded: boolean
  onToggle: () => void
  labels: BlockExpandLabels
  className: string | undefined
}

/**
 * Render the card's overflow control only when it has hidden rows.
 * @param props - hidden row count, expansion state, callback, labels, and owner styles.
 * @returns the localized toggle, or null for an uncapped card.
 */
export function BlockExpandButton({ hidden, expanded, onToggle, labels, className }: BlockExpandButtonProps) {
  if (hidden <= 0) return null
  return (
    <button
      type="button"
      className={className}
      aria-expanded={expanded}
      aria-label={expanded ? labels.collapseAria : labels.expandAria(hidden)}
      onClick={onToggle}
    >
      {expanded ? labels.collapse : labels.expand(hidden)}
    </button>
  )
}
