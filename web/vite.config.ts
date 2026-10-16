import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// `base: "./"` keeps the build working on GitHub Pages sub-paths as well as Cloudflare.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { proxy: { "/api": "http://localhost:8787" } },
});
