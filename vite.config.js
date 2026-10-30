import { defineConfig } from "vite";

// The SDK ships WASM and a worker referenced through `new URL(..., import.meta.url)`.
// Excluding it from dep pre-bundling lets Vite rewrite those asset URLs.
export default defineConfig({
  optimizeDeps: {
    exclude: ["@withautonomi/ant-browser-sdk"],
  },
  build: {
    target: "esnext",
    assetsInlineLimit: 0,
  },
});
