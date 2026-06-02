import type { WritePolicy } from "../shared/rpc.js";

export type ServerConfig = {
  readonly host: string;
  readonly port: number;
  readonly writePolicy: WritePolicy;
};

export const readServerConfig = (env = process.env): ServerConfig => ({
  host: env.EFFECT_OPCUA_WEB_HOST ?? env.HOST ?? "127.0.0.1",
  port: readPort(env.EFFECT_OPCUA_WEB_PORT ?? env.PORT, 4123),
  writePolicy: readWritePolicyFromEnv(env),
});

export const readWritePolicy = (): WritePolicy =>
  readWritePolicyFromEnv(process.env);

const readWritePolicyFromEnv = (env: NodeJS.ProcessEnv): WritePolicy =>
  env.EFFECT_OPCUA_WEB_WRITES === "disabled"
    ? { _tag: "Disabled" }
    : { _tag: "Enabled", reason: "RuntimeConfig" };

const readPort = (value: string | undefined, fallback: number) => {
  if (value === undefined || value.trim() === "") return fallback;
  const port = Number(value);
  return Number.isInteger(port) && port > 0 ? port : fallback;
};
