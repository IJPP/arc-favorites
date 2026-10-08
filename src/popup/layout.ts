export type TileSize = "xl" | "l" | "m" | "s";

/**
 * Columns follow the number of Favorites: a few apps get large tiles on one
 * row, a full set packs into four compact columns. Nothing looks empty with
 * two apps or cramped with twelve.
 */
export function gridLayout(count: number): { cols: number; size: TileSize } {
  if (count <= 3) return { cols: Math.max(count, 1), size: "xl" };
  if (count === 4) return { cols: 2, size: "m" };
  if (count <= 6) return { cols: 3, size: "l" };
  if (count <= 9) return { cols: 3, size: "m" };
  return { cols: 4, size: "s" };
}

/**
 * Moves the keyboard selection through a grid in which only `visible` indices
 * (sorted ascending) can be selected; filtered tiles keep their slots.
 */
export function moveSelection(key: string, current: number, visible: number[], cols: number): number {
  if (visible.length === 0) return -1;
  if (current < 0 || !visible.includes(current)) {
    return key === "End" || key === "ArrowUp" || key === "ArrowLeft" ? visible[visible.length - 1]! : visible[0]!;
  }
  const position = visible.indexOf(current);
  switch (key) {
    case "Home": return visible[0]!;
    case "End": return visible[visible.length - 1]!;
    case "ArrowRight": return visible[Math.min(position + 1, visible.length - 1)]!;
    case "ArrowLeft": return visible[Math.max(position - 1, 0)]!;
    case "ArrowDown": {
      const row = Math.floor(current / cols);
      const below = visible.filter((index) => Math.floor(index / cols) > row);
      if (below.length === 0) return current;
      const nextRow = Math.floor(below[0]! / cols);
      return closestInRow(below, nextRow, current % cols, cols);
    }
    case "ArrowUp": {
      const row = Math.floor(current / cols);
      const above = visible.filter((index) => Math.floor(index / cols) < row);
      if (above.length === 0) return current;
      const previousRow = Math.floor(above[above.length - 1]! / cols);
      return closestInRow(above, previousRow, current % cols, cols);
    }
    default: return current;
  }
}

function closestInRow(candidates: number[], row: number, column: number, cols: number): number {
  const inRow = candidates.filter((index) => Math.floor(index / cols) === row);
  return inRow.reduce((best, index) =>
    Math.abs((index % cols) - column) < Math.abs((best % cols) - column) ? index : best, inRow[0]!);
}

/** Moves one id by `delta` positions, clamped; returns the same array when nothing moves. */
export function shiftId(ids: string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  if (from < 0 || from === to) return ids;
  const next = [...ids];
  next.splice(to, 0, next.splice(from, 1)[0]!);
  return next;
}
