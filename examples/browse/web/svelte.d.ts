declare module "*.svelte" {
  import type { Component } from "svelte";

  const component: Component<Record<string, never>>;
  export default component;
}

interface ImportMetaEnv {
  readonly VITE_EFFECT_OPCUA_RPC_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
