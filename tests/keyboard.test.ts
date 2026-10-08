import { describe, expect, it } from "vitest";
import { gridLayout, moveSelection, shiftId } from "../src/popup/layout";

describe("adaptive grid", () => {
  it("uses big tiles for a few apps and four compact columns for many", () => {
    expect(gridLayout(0)).toEqual({ cols: 1, size: "xl" });
    expect(gridLayout(2)).toEqual({ cols: 2, size: "xl" });
    expect(gridLayout(4)).toEqual({ cols: 2, size: "m" });
    expect(gridLayout(6)).toEqual({ cols: 3, size: "l" });
    expect(gridLayout(9)).toEqual({ cols: 3, size: "m" });
    expect(gridLayout(12)).toEqual({ cols: 4, size: "s" });
  });
});

describe("grid keyboard navigation", () => {
  const all = [0, 1, 2, 3, 4];
  it("moves by one and by a row, reaching the last incomplete row", () => {
    expect(moveSelection("ArrowDown", -1, all, 3)).toBe(0);
    expect(moveSelection("ArrowRight", 0, all, 3)).toBe(1);
    expect(moveSelection("ArrowDown", 0, all, 3)).toBe(3);
    expect(moveSelection("ArrowDown", 2, all, 3)).toBe(4);
    expect(moveSelection("ArrowUp", 4, all, 3)).toBe(1);
    expect(moveSelection("ArrowLeft", 0, all, 3)).toBe(0);
    expect(moveSelection("End", 0, all, 3)).toBe(4);
    expect(moveSelection("Home", 4, all, 3)).toBe(0);
  });

  it("skips tiles hidden by the filter", () => {
    expect(moveSelection("ArrowRight", 0, [0, 2, 4], 3)).toBe(2);
    expect(moveSelection("ArrowDown", 0, [0, 4], 3)).toBe(4);
    expect(moveSelection("ArrowDown", 4, [0, 4], 3)).toBe(4);
    expect(moveSelection("ArrowDown", 0, [], 3)).toBe(-1);
  });
});

describe("keyboard reordering", () => {
  it("moves one id and clamps at the ends", () => {
    expect(shiftId(["a", "b", "c"], "a", 1)).toEqual(["b", "a", "c"]);
    expect(shiftId(["a", "b", "c"], "c", 3)).toEqual(["a", "b", "c"]);
    expect(shiftId(["a", "b", "c", "d"], "d", -3)).toEqual(["d", "a", "b", "c"]);
  });
});
