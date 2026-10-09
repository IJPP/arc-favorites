// Renders Chrome Web Store artwork from store/compose.html into store/images/.
// Needs the popup dev server: `npx vite --host 127.0.0.1 --port 5191`.
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

const chrome = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const base = process.env.BASE ?? "http://127.0.0.1:5191/store/compose.html";
const out = resolve("store/images");
mkdirSync(out, { recursive: true });

function render(name, query, width, height, { dark = false, scale = 2, transparent = false } = {}) {
  const file = resolve(out, `${name}.png`);
  execFileSync(chrome, [
    "--headless=new", "--hide-scrollbars", "--disable-gpu",
    `--force-device-scale-factor=${scale}`, `--window-size=${width},${height}`,
    "--virtual-time-budget=6000",
    ...(dark ? ["--force-dark-mode", "--blink-settings=preferredColorScheme=0"] : ["--blink-settings=preferredColorScheme=1"]),
    ...(transparent ? ["--default-background-color=00000000"] : []),
    `--screenshot=${file}`, `${base}?${query}`,
  ], { stdio: "ignore" });
  // Store sizes are exact, so render at 2× and scale down for clean edges.
  if (scale !== 1) execFileSync("sips", ["-z", String(height), String(width), file], { stdio: "ignore" });
  console.log(name);
}

for (const lang of ["en", "zh"]) {
  for (const shot of [1, 2, 3, 4]) {
    render(`screenshot-${lang}-${shot}`, `kind=shot&lang=${lang}&shot=${shot}`, 1280, 800, { dark: shot === 2 });
  }
  render(`promo-small-${lang}`, `kind=small&lang=${lang}`, 440, 280);
  render(`promo-marquee-${lang}`, `kind=marquee&lang=${lang}`, 1400, 560);
}
render("store-icon-128", "kind=icon", 128, 128, { scale: 1, transparent: true });
