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

const passwordEnv = optionValue("--password-env");
const runtime = await createTuiRuntime({
  endpointUrl,
  startNode: optionValue("--start-node") ?? "i=85",
  user: optionValue("--user"),
  password: passwordEnv ? process.env[passwordEnv] : undefined,
  enableWrites: args.includes("--enable-writes"),
});

render(<App runtime={runtime} />);
