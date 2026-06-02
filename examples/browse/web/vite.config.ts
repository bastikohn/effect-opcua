import tailwindcss from "@tailwindcss/vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";

const rpcUrl = new URL(
  process.env.VITE_EFFECT_OPCUA_RPC_URL ?? "ws://127.0.0.1:4123/rpc",
);
const rpcProxyTarget = `${rpcUrl.protocol}//${rpcUrl.host}`;

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    outDir: "dist/client",
    emptyOutDir: false,
  },
  server: {
    proxy: {
      "/rpc": {
        target: rpcProxyTarget,
        ws: true,
      },
    },
  },
});
