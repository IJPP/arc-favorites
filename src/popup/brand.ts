const CACHE_KEY = "favorites.brand.v1";

let cache: Record<string, string> = {};
try {
  const stored = JSON.parse(localStorage.getItem(CACHE_KEY) ?? "{}") as unknown;
  if (stored && typeof stored === "object") cache = stored as Record<string, string>;
} catch { /* Storage may be unavailable; colours are recomputed. */ }

export function cachedBrand(key: string): string | undefined {
  return cache[key];
}

export function rememberBrand(key: string, color: string): void {
  if (cache[key] === color) return;
  cache = { ...cache, [key]: color };
  try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* Keep the in-memory value. */ }
}

/** A stable, pleasant hue for sites whose icon cannot be read. */
export function fallbackBrand(key: string): string {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return `hsl(${Math.abs(hash) % 360} 55% 50%)`;
}

/**
 * The dominant saturated colour of a favicon. Near-white, near-black and
 * transparent pixels barely count, so "a red logo on white" reads as red.
 */
export function extractBrand(image: HTMLImageElement): string | undefined {
  try {
    const size = 24;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return undefined;
    context.drawImage(image, 0, 0, size, size);
    const data = context.getImageData(0, 0, size, size).data;
    let red = 0, green = 0, blue = 0, total = 0;
    for (let index = 0; index < data.length; index += 4) {
      const alpha = data[index + 3]! / 255;
      if (alpha < 0.5) continue;
      const r = data[index]!, g = data[index + 1]!, b = data[index + 2]!;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const saturation = (max - min) / 255;
      const lightness = (max + min) / 510;
      const weight = (lightness > 0.94 || lightness < 0.06 ? 0.02 : 0.15) + saturation * saturation * 4;
      red += r * weight; green += g * weight; blue += b * weight; total += weight;
    }
    if (total === 0) return undefined;
    return `rgb(${Math.round(red / total)} ${Math.round(green / total)} ${Math.round(blue / total)})`;
  } catch {
    // A cross-origin icon taints the canvas.
    return undefined;
  }
}
