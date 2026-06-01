import { spawn } from "node:child_process";

const build = spawn("pnpm", ["build:server"], { stdio: "inherit" });
const buildCode = await waitForExit(build);
if (buildCode !== 0) process.exit(buildCode);

const processes = [
  spawn("node", ["dist/server/main.mjs"], { stdio: "inherit" }),
  spawn("pnpm", ["dev:client"], { stdio: "inherit" }),
];
const exits = processes.map(waitForExit);

let stopping = false;
const stop = (signal = "SIGTERM") => {
  if (stopping) return;
  stopping = true;
  for (const child of processes) {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill(signal);
    }
  }
};

process.once("SIGINT", () => stop("SIGINT"));
process.once("SIGTERM", () => stop("SIGTERM"));

const code = await Promise.race(exits);
stop();
await Promise.allSettled(exits);
process.exit(code);

function waitForExit(child) {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
}
