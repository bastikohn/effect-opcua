import type { Duration } from "effect";

import {
  defaultCommandTimeout,
  defaultObservedTimeout,
  type DemoMachineCommandOptions,
  type DemoMachineOptions,
} from "../contract/options.js";

export const resolveObservedTimeout = (
  options: DemoMachineCommandOptions | undefined,
  specTimeout: Duration.Input | undefined,
  layerOptions: DemoMachineOptions,
) =>
  options?.observedTimeout ??
  specTimeout ??
  layerOptions.commandDefaults?.observedTimeout ??
  defaultObservedTimeout;

export const resolveCommandTimeout = (
  options: DemoMachineCommandOptions | undefined,
  specTimeout: Duration.Input | undefined,
  layerOptions: DemoMachineOptions,
) =>
  options?.timeout ??
  specTimeout ??
  layerOptions.commandDefaults?.timeout ??
  defaultCommandTimeout;
