import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// The synthetic sample set, served at demo/tg_company/ so the users page can load it into the demo
// engagement (worker/src/demo.js). expected.json is the tests' answer key and stays out.
const SAMPLES = new URL("../pipeline/samples/tg_company/", import.meta.url).pathname;
function demoSamples(): Plugin {
  const list = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? list(join(dir, n)) : [join(dir, n)]));
  return {
    name: "demo-samples",
    generateBundle() {
      const files = list(SAMPLES).filter((p) => !p.endsWith("expected.json"));
      for (const p of files) this.emitFile({ type: "asset", fileName: `demo/tg_company/${relative(SAMPLES, p)}`, source: readFileSync(p) });
      const manifest = files.map((p) => relative(SAMPLES, p)).sort();
      this.emitFile({ type: "asset", fileName: "demo/tg_company/manifest.json", source: JSON.stringify(manifest) });
    },
  };
}

// `base: "./"` keeps the build working on GitHub Pages sub-paths as well as Cloudflare.
export default defineConfig({
  base: "./",
  plugins: [react(), demoSamples()],
  server: { proxy: { "/api": "http://localhost:8787" } },
});
