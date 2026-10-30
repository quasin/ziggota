// Inlines the Vite build into one self-contained HTML file: CSS, the app bundle and
// the WASM core (a single base64 data URL shared by both references).
//
// The SDK's upload worker is deliberately dropped here: it needs its own copy of the
// WASM (a separate worker scope cannot read the page's constant), which would double an
// 8 MB file for a code path this app never uses. Uploads therefore throw in the
// single-file build; every download path works.
//
// Usage: node scripts/build-single.mjs [outfile]
import { readFile, writeFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
const outFile = path.resolve(root, process.argv[2] || "ziggota.html");

const assetDir = path.join(dist, "assets");
const files = await readdir(assetDir);
const pick = (re) => files.find((f) => re.test(f));
const cssFile = pick(/\.css$/);
const jsFile = pick(/^index-.*\.js$/);
const wasmFile = pick(/\.wasm$/);
const workerFile = pick(/worker.*\.js$/);

for (const [label, value] of Object.entries({ cssFile, jsFile, wasmFile })) {
  if (!value) throw new Error(`Missing build asset: ${label}`);
}

const [html, css, jsRaw, wasm] = await Promise.all([
  readFile(path.join(dist, "index.html"), "utf8"),
  readFile(path.join(assetDir, cssFile), "utf8"),
  readFile(path.join(assetDir, jsFile), "utf8"),
  readFile(path.join(assetDir, wasmFile)),
]);

const wasmUrl = `data:application/wasm;base64,${wasm.toString("base64")}`;
const wasmPath = new RegExp(`"/assets/${wasmFile.replace(/\./g, "\\.")}"`, "g");

let js = jsRaw.replace(wasmPath, "__WASM_URL");

if (workerFile) {
  const workerSnippet = new RegExp(
    `new Worker\\(new URL\\("/assets/${workerFile.replace(/\./g, "\\.")}",import\\.meta\\.url\\),\\{type:"module"\\}\\)`,
  );
  if (!workerSnippet.test(js)) throw new Error("Upload-worker reference not found in bundle");
  js = js.replace(
    workerSnippet,
    `(() => { throw new Error("Uploads are not available in the single-file build") })()`,
  );
}

if (/\/assets\//.test(js)) {
  throw new Error(`Bundle still references /assets/: ${js.match(/\/assets\/[^"')]+/g)?.join(", ")}`);
}

js = `const __WASM_URL = "${wasmUrl}";\n${js}`;

const escapeScript = (code) => code.replace(/<\/script/gi, "<\\/script");

let out = html
  .replace(/<link[^>]+rel="stylesheet"[^>]*>/, `<style>\n${css}\n</style>`)
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, `<script type="module">\n${escapeScript(js)}\n</script>`);

if (/<link[^>]+stylesheet|<script[^>]+src=/.test(out)) {
  throw new Error("Could not inline every external reference");
}

await writeFile(outFile, out);
console.log(`Wrote ${path.relative(root, outFile)} (${(Buffer.byteLength(out) / 1048576).toFixed(1)} MB)`);
