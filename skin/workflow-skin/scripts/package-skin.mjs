import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = fileURLToPath(new URL("..", import.meta.url));
const dist = join(root, "dist");
const manifest = JSON.parse(await readFile(join(root, "skin-manifest.json"), "utf8"));
const zip = new JSZip();

async function addDir(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await addDir(full);
    } else {
      zip.file(relative(dist, full), await readFile(full));
    }
  }
}

await addDir(dist);
zip.file("skin-manifest.json", JSON.stringify(manifest, null, 2));
const bytes = await zip.generateAsync({ type: "uint8array" });
await writeFile(join(root, "workflow-skin.zip"), bytes);
console.log(`Created workflow-skin.zip for ${manifest.id} ${manifest.version}`);
