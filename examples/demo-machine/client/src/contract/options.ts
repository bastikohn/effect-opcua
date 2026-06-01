import type { Duration } from "effect";

export type DemoMachineCommandOptions = {
  readonly commandId?: string;
  readonly observedTimeout?: Duration.Input;
  readonly timeout?: Duration.Input;
};

export type DemoMachineOptions = {
  readonly clientId?: string;
  readonly commandDefaults?: {
    readonly observedTimeout?: Duration.Input;
    readonly timeout?: Duration.Input;
  };
};

export const defaultClientId = "effect-opcua-demo-client";
export const defaultObservedTimeout = "1 second";
export const defaultCommandTimeout = "5 seconds";
