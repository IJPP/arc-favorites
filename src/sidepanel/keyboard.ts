const BACKWARD_KEYS = new Set(["ArrowUp", "ArrowLeft"]);
const FORWARD_KEYS = new Set(["ArrowDown", "ArrowRight"]);

/**
 * The management popup renders Favorites as a single vertical list, so every
 * arrow key moves focus by exactly one tile.
 */
export function verticalListStep(key: string): -1 | 0 | 1 {
  if (BACKWARD_KEYS.has(key)) return -1;
  if (FORWARD_KEYS.has(key)) return 1;
  return 0;
}

export function tileFocusIndex(key: string, index: number, count: number, columns: number): number {
  if (!count) return -1;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  const delta = key === 'ArrowUp' ? -columns : key === 'ArrowDown' ? columns : verticalListStep(key);
  return Math.max(0, Math.min(count - 1, index + delta));
}
