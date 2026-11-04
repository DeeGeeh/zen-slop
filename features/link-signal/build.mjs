import { build } from "esbuild";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";

const endpoint = process.env.LINK_SIGNAL_ENDPOINT;
if (endpoint) {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("The hosted service must use a public HTTPS URL without credentials or query parameters.");
}
const define = { __SIGNAL_SERVICE_URL__: endpoint ? JSON.stringify(endpoint) : "undefined" };

await mkdir("dist/extension", { recursive: true });
await cp("public", "dist/extension", { recursive: true });
if (endpoint) {
  const manifest = JSON.parse(await readFile("public/manifest.json", "utf8"));
  manifest.permissions = ["storage", `${new URL(endpoint).origin}/*`];
  await writeFile("dist/extension/manifest.json", JSON.stringify(manifest, null, 2));
}
await writeFile("dist/extension/service.json", JSON.stringify({ endpoint: endpoint ?? null }));
await cp("node_modules/lucide/LICENSE", "dist/extension/LUCIDE-LICENSE");
await build({
  entryPoints: ["src/extension/background.ts", "src/extension/content.ts"],
  bundle: true,
  format: "iife",
  outdir: "dist/extension",
  target: "firefox128",
  minify: true,
  define,
  legalComments: "eof",
});
await build({
  entryPoints: ["src/extension/options.ts"],
  bundle: true,
  format: "esm",
  outdir: "dist/extension",
  target: "firefox128",
  minify: true,
  define,
  legalComments: "eof",
});
