import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

type PaginationNavProps = {
  page: number
  pageCount: number
  onPageChange: (page: number) => void
}

/** Pages visibles : 1, 2, 3 … dernière (fenêtre glissante autour de la page courante). */
function visiblePages(page: number, pageCount: number): (number | 'ellipsis')[] {
  if (pageCount <= 5) return Array.from({ length: pageCount }, (_, index) => index + 1)
  const start = Math.min(Math.max(1, page - 1), pageCount - 3)
  const window = [start, start + 1, start + 2]
  const pages: (number | 'ellipsis')[] = []
  if (start > 1) pages.push(1)
  if (start > 2) pages.push('ellipsis')
  pages.push(...window)
  if (start + 2 < pageCount - 1) pages.push('ellipsis')
  if (start + 2 < pageCount) pages.push(pageCount)
  return pages
}

const navButton =
  'inline-flex items-center gap-2 rounded-md px-2 py-1 text-xl transition-colors focus-visible:outline-2 focus-visible:outline-primary disabled:cursor-not-allowed'

export function PaginationNav({ page, pageCount, onPageChange }: PaginationNavProps) {
  if (pageCount <= 1) return null

  return (
    <nav aria-label="Pagination des projets" className="flex justify-center">
      <ul className="flex items-center gap-2">
        <li>
          <button
            type="button"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            className={cn(navButton, 'text-muted-foreground enabled:hover:text-foreground')}
          >
            <ChevronLeft className="size-5" aria-hidden="true" />
            Précédent
          </button>
        </li>
        {visiblePages(page, pageCount).map((item, index) =>
          item === 'ellipsis' ? (
            <li key={`ellipsis-${index}`} aria-hidden="true" className="px-1 text-xl">
              …
            </li>
          ) : (
            <li key={item}>
              <button
                type="button"
                onClick={() => onPageChange(item)}
                aria-current={item === page ? 'page' : undefined}
                aria-label={`Page ${item}`}
                className={cn(
                  navButton,
                  'min-w-8 justify-center tabular-nums',
                  item === page ? 'text-muted-foreground' : 'text-foreground hover:text-primary',
                )}
              >
                {item}
              </button>
            </li>
          ),
        )}
        <li>
          <button
            type="button"
            onClick={() => onPageChange(page + 1)}
            disabled={page === pageCount}
            className={cn(navButton, 'text-foreground enabled:hover:text-primary disabled:text-muted-foreground')}
          >
            Suivant
            <ChevronRight className="size-5" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </nav>
  )
}
