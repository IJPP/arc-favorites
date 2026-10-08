import { describe, expect, it } from "vitest";
import { verticalListStep } from "../src/sidepanel/keyboard";

describe("vertical list keyboard navigation", () => {
  it("moves exactly one tile per arrow key", () => {
    expect(verticalListStep("ArrowDown")).toBe(1);
    expect(verticalListStep("ArrowUp")).toBe(-1);
    expect(verticalListStep("ArrowRight")).toBe(1);
    expect(verticalListStep("ArrowLeft")).toBe(-1);
  });

  it("ignores unrelated keys", () => {
    expect(verticalListStep("Enter")).toBe(0);
    expect(verticalListStep("Tab")).toBe(0);
  });
});

import { tileFocusIndex } from '../src/sidepanel/keyboard';

describe('grid keyboard navigation', () => {
  it('moves vertically by a row and reaches the last incomplete row', () => {
    expect(tileFocusIndex('ArrowDown', 0, 5, 4)).toBe(4);
    expect(tileFocusIndex('ArrowDown', 2, 5, 4)).toBe(4);
    expect(tileFocusIndex('ArrowUp', 4, 5, 4)).toBe(0);
    expect(tileFocusIndex('ArrowLeft', 0, 5, 4)).toBe(0);
    expect(tileFocusIndex('Home', 4, 5, 4)).toBe(0);
    expect(tileFocusIndex('End', 0, 5, 4)).toBe(4);
  });
});
