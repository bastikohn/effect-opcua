import { startDemoOpcuaServer } from "./index.js";

const port = process.env.OPCUA_DEMO_PORT
  ? Number(process.env.OPCUA_DEMO_PORT)
  : 4840;

const demo = await startDemoOpcuaServer({ port });

process.stdout.write(
  `effect-opcua demo server listening at ${demo.endpointUrl}\n`,
);

const shutdown = async () => {
  await demo.stop();
  process.exit(0);
};

process.once("SIGINT", () => {
  void shutdown();
});
process.once("SIGTERM", () => {
  void shutdown();
});
