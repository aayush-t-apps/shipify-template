import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  // `pnpm dev:ui` serves the UI with hot reload and forwards API calls to `pnpm dev` on 8787.
  server: { proxy: { "/api": "http://localhost:8787", "/health": "http://localhost:8787" } },
});
