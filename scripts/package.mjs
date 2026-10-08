import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import JSZip from "jszip";

const dist = resolve("dist");
const zip = new JSZip();

async function addDirectory(directory) {
  for (const name of await readdir(directory)) {
    const path = resolve(directory, name);
    const info = await stat(path);
    if (info.isDirectory()) {
      await addDirectory(path);
    } else if (!name.endsWith(".map")) {
      zip.file(relative(dist, path), await readFile(path));
    }
  }
}

await addDirectory(dist);
const archive = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
await writeFile(resolve("arc-favorites-chrome.zip"), archive);
