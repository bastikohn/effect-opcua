import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Effect, Layer, Option, Queue, Result, Scope, Stream } from "effect";
import type { Duration } from "effect";
import { OpcuaSession } from "@effect-opcua/client";

import * as Root from "../src/index.js";
import * as Generated from "../src/generated/index.js";
import { DemoMachineCommands } from "../src/DemoMachineCommands.js";
import { DemoMachineTelemetry } from "../src/DemoMachineTelemetry.js";
import { DemoMachineCommandCore } from "../src/internal/command-core.js";
import * as Variables from "../src/generated/variables.js";
import type { RawCommandStatusBuffer } from "../src/generated/structures.js";
import {
  CommandObservationTimeout,
  CommandSubmissionInProgress,
  CommandTimeout,
  InvalidCommandInput,
} from "../src/contract/errors.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext("demo-machine", 1);

const runConfiguration = {
  productName: "Water",
  targetFillVolumeMl: 250,
  fillToleranceMl: 2,
  pumpRateMlPerSecond: 50,
  batchSize: 3,
  xAxisSpeedMmPerSecond: 200,
  zAxisSpeedMmPerSecond: 100,
} as const;

describe("@effect-opcua/demo-client", () => {
  it("exposes curated root APIs and a generated escape hatch", () => {
    expect(Root.DemoMachine).toBeDefined();
    expect(Root.DemoMachineCommands).toBeDefined();
    expect(Root.DemoMachineTelemetry).toBeDefined();
    expect(Root.DemoMachineCommand).toBeDefined();
    expect(Generated.Variables.Variables.Commands.Status.nodeId).toBe(
      "ns=1;s=DemoFillingCell.Commands.Status",
    );

    const packageJson = JSON.parse(
      readFileSync(
        join(fileURLToPath(new URL("..", import.meta.url)), "package.json"),
        "utf8",
      ),
    ) as { readonly exports: Record<string, unknown> };
    expect(packageJson.exports).toHaveProperty(".");
    expect(packageJson.exports).toHaveProperty("./generated");
    expect(packageJson.exports).toHaveProperty("./internal/*", null);
  });

  it("starts strict command-status and telemetry monitors", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const telemetry = yield* DemoMachineTelemetry;
        const commands = yield* DemoMachineCommands;
        const status = yield* commands.readCommandStatus;
        const watchedStatus = yield* first(commands.watchCommandStatus);
        const snapshot = yield* telemetry.readSnapshot;
        const watchedSnapshot = yield* first(telemetry.watchSnapshot);
        return { status, watchedStatus, snapshot, watchedSnapshot };
      }),
    );

    expect(result.status).toMatchObject({ capacity: 8, entries: [] });
    expect(result.watchedStatus).toEqual(result.status);
    expect(result.snapshot.revision).toBe(0n);
    expect(result.snapshot.machine.state).toBe("Idle");
    expect(result.watchedSnapshot).toEqual(result.snapshot);
  });

  it("submits machine commands and observes terminal status plus telemetry", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const commands = yield* DemoMachineCommands;
        const telemetry = yield* DemoMachineTelemetry;

        const configured = yield* commands.machine.configure(runConfiguration);
        const homed = yield* commands.machine.home();
        yield* waitUntilSnapshot((snapshot) => snapshot.machine.ready);
        const afterHome = yield* telemetry.readSnapshot;
        const started = yield* commands.machine.start();
        yield* waitUntilSnapshot((snapshot) => snapshot.machine.busy);
        const afterStart = yield* telemetry.readSnapshot;
        const status = yield* commands.readCommandStatus;

        return { configured, homed, started, afterHome, afterStart, status };
      }),
    );

    expect(result.configured.state).toBe("Completed");
    expect(result.homed.state).toBe("Completed");
    expect(result.started.state).toBe("Completed");
    expect(result.afterHome.machine.ready).toBe(true);
    expect(result.afterHome.machine.homed).toBe(true);
    expect(result.afterStart.machine.state).toBe("Running");
    expect(result.afterStart.machine.busy).toBe(true);
    expect(result.status.entries.at(-1)).toMatchObject({
      state: "Completed",
      statusCode: "Completed",
    });
  });

  it("returns PLC rejection as terminal status data", async () => {
    const rejected = await runLive(
      Effect.gen(function* () {
        const commands = yield* DemoMachineCommands;
        return yield* commands.machine.start();
      }),
      "rejection-vitest",
    );

    expect(rejected).toMatchObject({
      state: "Rejected",
      statusCode: "InvalidMachineState",
      statusMessage: "Start is accepted only from Ready.",
    });
  });

  it("supports manual and maintenance payload commands", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const commands = yield* DemoMachineCommands;
        const telemetry = yield* DemoMachineTelemetry;

        yield* commands.machine.setMode("Manual");
        const manual = yield* commands.manual.moveXAxisToTarget({
          target: "Load",
          velocityMmPerSecond: 100,
        });
        yield* waitUntilSnapshot(
          (snapshot) => snapshot.motion.xAxis.currentTarget === "Load",
        );
        const manualSnapshot = yield* telemetry.readSnapshot;

        yield* commands.machine.setMode("Maintenance");
        const maintenance = yield* commands.maintenance.homeAxes({
          axisSelection: "Both",
        });
        yield* waitUntilSnapshot((snapshot) => snapshot.machine.homed);
        const maintenanceSnapshot = yield* telemetry.readSnapshot;

        return { manual, manualSnapshot, maintenance, maintenanceSnapshot };
      }),
    );

    expect(result.manual.state).toBe("Completed");
    expect(result.manualSnapshot.motion.xAxis.currentTarget).toBe("Load");
    expect(result.maintenance.state).toBe("Completed");
    expect(result.maintenanceSnapshot.machine.operatingMode).toBe(
      "Maintenance",
    );
    expect(result.maintenanceSnapshot.machine.homed).toBe(true);
  });

  it("generates command IDs, honors overrides, rejects retained duplicates, and validates input locally", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const commands = yield* DemoMachineCommands;

        yield* commands.machine.setMode("Manual");
        const generated = yield* commands.manual.openClamp();
        const override = yield* commands.manual.closeClamp({
          commandId: "manual-command-id",
        });
        const duplicate = yield* Effect.result(
          commands.manual.openClamp({ commandId: "manual-command-id" }),
        );
        const invalid = yield* Effect.result(
          commands.manual.jogXPositive({
            velocityMmPerSecond: -1,
            maxDurationMs: 10,
          }),
        );

        return { generated, override, duplicate, invalid };
      }),
    );

    expect(result.generated.commandId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u,
    );
    expect(result.override).toMatchObject({
      commandId: "manual-command-id",
      state: "Completed",
    });
    expect(Result.isFailure(result.duplicate)).toBe(true);
    if (Result.isFailure(result.duplicate)) {
      expect(result.duplicate.failure).toBeInstanceOf(InvalidCommandInput);
    }
    expect(Result.isFailure(result.invalid)).toBe(true);
    if (Result.isFailure(result.invalid)) {
      expect(result.invalid.failure).toBeInstanceOf(InvalidCommandInput);
    }
  });

  it("fails overlapping submit handshakes immediately", async () => {
    const result = await runWithFakeCommandCore(
      {
        observeSubmit: false,
        writeDelay: "100 millis",
      },
      Effect.gen(function* () {
        const core = yield* DemoMachineCommandCore;
        return yield* Effect.all(
          [
            Effect.result(
              core.submit(
                { _tag: "MachineHome" },
                {
                  commandId: "slow-submit",
                  observedTimeout: "20 millis",
                },
              ),
            ),
            Effect.sleep("10 millis").pipe(
              Effect.andThen(
                Effect.result(
                  core.submit(
                    { _tag: "MachineStart" },
                    {
                      commandId: "overlap-submit",
                      observedTimeout: "20 millis",
                    },
                  ),
                ),
              ),
            ),
          ] as const,
          { concurrency: "unbounded" },
        );
      }),
    );

    expect(Result.isFailure(result[1])).toBe(true);
    if (Result.isFailure(result[1])) {
      expect(result[1].failure).toBeInstanceOf(CommandSubmissionInProgress);
    }
  });

  it("distinguishes observation and terminal timeouts", async () => {
    const observation = await runWithFakeCommandCore(
      { observeSubmit: false, writeDelay: "0 millis" },
      Effect.gen(function* () {
        const core = yield* DemoMachineCommandCore;
        return yield* Effect.result(
          core.submit(
            { _tag: "MachineHome" },
            {
              commandId: "never-observed",
              observedTimeout: "20 millis",
              timeout: "20 millis",
            },
          ),
        );
      }),
    );
    expect(Result.isFailure(observation)).toBe(true);
    if (Result.isFailure(observation)) {
      expect(observation.failure).toBeInstanceOf(CommandObservationTimeout);
    }

    const terminal = await runWithFakeCommandCore(
      { observeSubmit: true, writeDelay: "0 millis" },
      Effect.gen(function* () {
        const core = yield* DemoMachineCommandCore;
        return yield* Effect.result(
          core.submit(
            { _tag: "MachineHome" },
            {
              commandId: "observed-not-terminal",
              observedTimeout: "100 millis",
              timeout: "20 millis",
            },
          ),
        );
      }),
    );
    expect(Result.isFailure(terminal)).toBe(true);
    if (Result.isFailure(terminal)) {
      expect(terminal.failure).toBeInstanceOf(CommandTimeout);
    }
  });
});

const first = <A>(stream: Stream.Stream<A>) =>
  Stream.runHead(stream).pipe(Effect.map(Option.getOrThrow));

const waitUntilSnapshot = (
  predicate: (
    snapshot: import("../src/contract/telemetry.js").DemoMachineSnapshot,
  ) => boolean,
) =>
  DemoMachineTelemetry.pipe(
    Effect.flatMap((telemetry) =>
      telemetry.readSnapshot.pipe(
        Effect.flatMap((snapshot) =>
          predicate(snapshot)
            ? Effect.succeed(snapshot)
            : telemetry.watchSnapshot.pipe(
                Stream.filter(predicate),
                Stream.runHead,
                Effect.map(Option.getOrThrow),
              ),
        ),
      ),
    ),
  );

type FakeCoreOptions = {
  readonly observeSubmit: boolean;
  readonly writeDelay: Duration.Input;
};

const runWithFakeCommandCore = <A, E>(
  options: FakeCoreOptions,
  effect: Effect.Effect<A, E, Scope.Scope | DemoMachineCommandCore>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(
        DemoMachineCommandCore.layerLive().pipe(
          Layer.provide(makeFakeSessionLayer(options)),
        ),
      ),
      Effect.timeout("2 seconds"),
    ),
  );

const makeFakeSessionLayer = (options: FakeCoreOptions) =>
  Layer.effect(
    OpcuaSession.OpcuaSession,
    Effect.gen(function* () {
      const samples = yield* Queue.unbounded<unknown>();
      const session = {
        makeSubscription: () =>
          Effect.succeed({
            monitor: () =>
              Effect.succeed({
                startup: {},
                samples: Stream.fromQueue(samples),
              }),
            events: Stream.empty,
            unsafeRaw: {},
          }),
        read: () =>
          Effect.succeed({
            _tag: "Value",
            nodeId: Variables.CommandsStatus.nodeId,
            value: emptyRawStatusBuffer(),
            status: { isGood: true, text: "Good" },
          }),
        write: (def: { readonly nodeId: string }, value: unknown) =>
          Effect.sleep(options.writeDelay).pipe(
            Effect.andThen(
              options.observeSubmit &&
                def.nodeId === Variables.CommandsSubmitRequest.nodeId
                ? Queue.offer(samples, statusSample(value))
                : Effect.void,
            ),
            Effect.as({
              _tag: "Written",
              nodeId: def.nodeId,
              status: { isGood: true, text: "Good" },
            }),
          ),
      } as unknown as OpcuaSession.OpcuaSession;
      return session;
    }),
  );

const emptyRawStatusBuffer = (): RawCommandStatusBuffer => ({
  revision: 0,
  capacity: 8,
  entries: [],
});

const statusSample = (value: unknown) => {
  const submit = value as {
    readonly commandId: string;
    readonly commandKind: number;
    readonly clientId: string;
  };
  const now = new Date();
  return {
    _tag: "Value",
    key: "status",
    nodeId: Variables.CommandsStatus.nodeId,
    value: {
      revision: 1,
      capacity: 8,
      entries: [
        {
          sequence: 1,
          commandId: submit.commandId,
          commandKind: submit.commandKind,
          clientId: submit.clientId,
          state: 1,
          statusCode: "Observed",
          statusMessage: "Command request observed.",
          observedAt: now,
          updatedAt: now,
        },
      ],
    } satisfies RawCommandStatusBuffer,
    status: { isGood: true, text: "Good" },
  };
};
