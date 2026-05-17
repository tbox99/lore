import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://v2.tauri.app/start/create-project/
export default defineConfig({
  root: path.resolve(__dirname, "src"),
  // Use relative paths so Tauri can load assets from tauri:// protocol
  base: "./",
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  envPrefix: [
    "VITE_",
    "TAURI_PLATFORM",
    "TAURI_ARCH",
    "TAURI_FAMILY",
    "TAURI_PLATFORM_VERSION",
    "TAURI_PLATFORM_TYPE",
    "TAURI_DEBUG",
  ],
  build: {
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_DEBUG,
    outDir: path.resolve(__dirname, "dist"),
    emptyOutDir: true,
  },
});