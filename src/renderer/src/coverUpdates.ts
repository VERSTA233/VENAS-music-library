import type { CoverUpdate } from '../../shared/types'
import { invalidateUpdatedThumbnails } from './thumbnailCache'

export function dispatchCoverUpdate(update: CoverUpdate): void {
  invalidateUpdatedThumbnails(update)
  window.dispatchEvent(new CustomEvent<CoverUpdate>('library:cover-updated', { detail: update }))
}
