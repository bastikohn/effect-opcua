import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/rpc": {
        target: "ws://127.0.0.1:4123",
        ws: true,
      },
    },
  },
});
