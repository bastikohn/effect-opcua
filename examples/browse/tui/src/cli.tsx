#!/usr/bin/env node
import React from "react";
import { render } from "ink";

import { createTuiRuntime } from "./runtime/index.js";
import { App } from "./ui/App.js";

const args = process.argv.slice(2);
const endpointUrl = args.find((arg) => !arg.startsWith("--"));

if (!endpointUrl) {
  process.stderr.write(
    "usage: effect-opcua-tui <endpointUrl> [--start-node i=85] [--user name] [--password-env ENV] [--enable-writes]\n",
  );
  process.exit(1);
}

const optionValue = (name: string) => {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};

const createPassthroughStream = (
  stream: NodeJS.WriteStream,
): NodeJS.WriteStream => {
  const output = Object.create(stream) as NodeJS.WriteStream;
  output.write = stream.write.bind(stream) as NodeJS.WriteStream["write"];
  output.on = stream.on.bind(stream) as NodeJS.WriteStream["on"];
  output.off = stream.off.bind(stream) as NodeJS.WriteStream["off"];
  return output;
};

const muteProcessOutput = () => {
  const stdoutWrite = process.stdout.write;
  const stderrWrite = process.stderr.write;
  const mutedWrite = (() => true) as typeof process.stdout.write;
  process.stdout.write = mutedWrite;
  process.stderr.write = mutedWrite as typeof process.stderr.write;
  return () => {
    process.stdout.write = stdoutWrite;
    process.stderr.write = stderrWrite;
  };
};

const passwordEnv = optionValue("--password-env");
const terminalStdout = createPassthroughStream(process.stdout);
const terminalStderr = createPassthroughStream(process.stderr);
const restoreProcessOutput = muteProcessOutput();

try {
  const runtime = await createTuiRuntime({
    endpointUrl,
    startNode: optionValue("--start-node") ?? "i=85",
    user: optionValue("--user"),
    password: passwordEnv ? process.env[passwordEnv] : undefined,
    enableWrites: args.includes("--enable-writes"),
  });
  const instance = render(<App runtime={runtime} />, {
    stdout: terminalStdout,
    stderr: terminalStderr,
    patchConsole: false,
  });
  await instance.waitUntilExit();
} catch (error) {
  restoreProcessOutput();
  process.stderr.write(`${String(error)}\n`);
  process.exitCode = 1;
} finally {
  restoreProcessOutput();
}
