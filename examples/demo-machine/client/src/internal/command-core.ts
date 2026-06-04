import {
  Opcua,
  OpcuaError,
  OpcuaSession,
  type OpcuaSession as OpcuaSessionService,
} from "@effect-opcua/client";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Option,
  Ref,
  Schema,
  Stream,
  SubscriptionRef,
} from "effect";

import {
  CommandObservationTimeout,
  CommandStatusUnavailable,
  CommandSubmissionInProgress,
  CommandTimeout,
  InvalidCommandInput,
} from "../contract/errors.js";
import {
  DemoMachineCommand,
  type DemoMachineCommand as DemoMachineCommandType,
} from "../contract/commands.js";
import {
  isTerminalCommandStatusEntry,
  type CommandOutcome,
  type CommandStatusBuffer,
  type CommandStatusEntry,
} from "../contract/command-status.js";
import {
  defaultClientId,
  type DemoMachineCommandOptions,
  type DemoMachineOptions,
} from "../contract/options.js";
import * as Variables from "../generated/variables.js";
import { mapCommandStatusBuffer } from "./command-status-mapper.js";
import { getCommandSpec } from "./command-specs.js";
import { makeCommandId } from "./ids.js";
import { resolveCommandTimeout, resolveObservedTimeout } from "./timeouts.js";

export type DemoMachineCommandCoreService = {
  readonly readStatus: Effect.Effect<CommandStatusBuffer>;
  readonly watchStatus: Stream.Stream<CommandStatusBuffer>;
  readonly submit: (
    command: DemoMachineCommandType,
    options?: DemoMachineCommandOptions,
  ) => Effect.Effect<
    CommandOutcome,
    | InvalidCommandInput
    | CommandSubmissionInProgress
    | CommandObservationTimeout
    | CommandTimeout
    | CommandStatusUnavailable
    | OpcuaError.OpcuaError
  >;
};

export class DemoMachineCommandCore extends Context.Service<
  DemoMachineCommandCore,
  DemoMachineCommandCoreService
>()("@effect-opcua/demo-client/internal/DemoMachineCommandCore") {
  static layerLive = (options: DemoMachineOptions = {}) =>
    Layer.effect(
      DemoMachineCommandCore,
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const active = yield* subscription.monitor(
          { status: Variables.Commands.Status },
          {
            startup: "strict",
            validation: "strict",
            samplingInterval: Duration.millis(50),
            queueSize: 5,
            discardOldest: true,
            filter: Opcua.MonitorFilter.statusValue(),
            timestamps: "both",
            clientBuffer: Opcua.BufferPolicy.sliding(16),
          },
        );
        const initial = yield* readStatusFromSession(session);
        const statusRef = yield* SubscriptionRef.make(initial);
        const submitInProgress = yield* Ref.make(false);

        yield* active.samples.pipe(
          Stream.runForEach((sample) =>
            sample._tag === "Value"
              ? updateStatusRef(statusRef, mapCommandStatusBuffer(sample.value))
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
          Effect.forkScoped,
        );

        const readStatus = SubscriptionRef.get(statusRef);
        const watchStatus = SubscriptionRef.changes(statusRef);
        const submit = (
          command: DemoMachineCommandType,
          commandOptions?: DemoMachineCommandOptions,
        ) =>
          submitCommand({
            command,
            commandOptions,
            layerOptions: options,
            session,
            statusRef,
            submitInProgress,
          });

        return DemoMachineCommandCore.of({
          readStatus,
          watchStatus,
          submit,
        });
      }),
    );
}

const readStatusFromSession = (session: OpcuaSessionService) =>
  session.read(Variables.Commands.Status).pipe(
    Effect.flatMap((result) => {
      if (result._tag === "Value") {
        return Effect.succeed(mapCommandStatusBuffer(result.value));
      }
      return Effect.fail(
        new CommandStatusUnavailable({
          operation: "read Commands.Status",
          nodeId: Variables.Commands.Status.nodeId,
          cause: result,
        }),
      );
    }),
  );

const updateStatusRef = (
  ref: SubscriptionRef.SubscriptionRef<CommandStatusBuffer>,
  next: CommandStatusBuffer,
) =>
  SubscriptionRef.get(ref).pipe(
    Effect.flatMap((current) =>
      next.revision > current.revision
        ? SubscriptionRef.set(ref, next)
        : Effect.void,
    ),
  );

const submitCommand = (input: {
  readonly command: DemoMachineCommandType;
  readonly commandOptions?: DemoMachineCommandOptions;
  readonly layerOptions: DemoMachineOptions;
  readonly session: OpcuaSessionService;
  readonly statusRef: SubscriptionRef.SubscriptionRef<CommandStatusBuffer>;
  readonly submitInProgress: Ref.Ref<boolean>;
}) =>
  Effect.gen(function* () {
    const command = yield* SchemaDecodeCommand(input.command);
    const spec = getCommandSpec(command._tag);
    const commandId = input.commandOptions?.commandId ?? makeCommandId();
    const clientId = input.layerOptions.clientId ?? defaultClientId;
    const current = yield* SubscriptionRef.get(input.statusRef);
    if (current.entries.some((entry) => entry.commandId === commandId)) {
      return yield* Effect.fail(
        new InvalidCommandInput({
          command: input.command,
          cause: `commandId ${commandId} is already retained in Commands.Status`,
        }),
      );
    }

    const observedTimeout = resolveObservedTimeout(
      input.commandOptions,
      spec.timeouts?.observedTimeout,
      input.layerOptions,
    );
    const commandTimeout = resolveCommandTimeout(
      input.commandOptions,
      spec.timeouts?.timeout,
      input.layerOptions,
    );

    const observedWait = waitForStatusEntry(
      input.statusRef,
      commandId,
      (entry): entry is CommandStatusEntry => Boolean(entry),
    ).pipe(
      timeoutAs(observedTimeout, new CommandObservationTimeout({ commandId })),
    );

    const acquired = yield* Ref.modify(input.submitInProgress, (active) =>
      active ? [false, true] : [true, true],
    );
    if (!acquired) {
      return yield* Effect.fail(new CommandSubmissionInProgress({ commandId }));
    }

    yield* Effect.gen(function* () {
      yield* writeGood(input.session, Variables.Commands.SubmitRequest, {
        commandId,
        commandKind: spec.kind,
        clientId,
        ...emptySubmitPayload,
        ...(spec.buildPayload
          ? (spec.buildPayload(command as never) as Record<string, unknown>)
          : {}),
      });
    }).pipe(Effect.ensuring(Ref.set(input.submitInProgress, false)));

    yield* observedWait;
    const terminal = yield* waitForStatusEntry(
      input.statusRef,
      commandId,
      isTerminalCommandStatusEntry,
    ).pipe(timeoutAs(commandTimeout, new CommandTimeout({ commandId })));
    return terminal;
  });

const SchemaDecodeCommand = (command: DemoMachineCommandType) =>
  Schema.decodeUnknownEffect(DemoMachineCommand)(command).pipe(
    Effect.mapError(
      (cause) =>
        new InvalidCommandInput({
          command,
          cause,
        }),
    ),
  );

const writeGood = (
  session: OpcuaSessionService,
  variable: Opcua.WritableVariableDef,
  value: unknown,
) =>
  session.write(variable, value as never).pipe(
    Effect.flatMap((result) =>
      result._tag === "Written"
        ? Effect.void
        : Effect.fail(
            new CommandStatusUnavailable({
              operation: "write",
              nodeId: result.nodeId,
              cause: result,
            }),
          ),
    ),
  );

const emptySubmitPayload = {
  targetMode: 0,
  configuration: {
    productName: "",
    targetFillVolumeMl: 0,
    fillToleranceMl: 0,
    pumpRateMlPerSecond: 0,
    batchSize: 0,
    xAxisSpeedMmPerSecond: 0,
    zAxisSpeedMmPerSecond: 0,
  },
  target: 0,
  targetPositionMm: 0,
  velocityMmPerSecond: 0,
  maxDurationMs: 0,
  actuator: 0,
  axisSelection: 0,
} as const;

const waitForStatusEntry = <A extends CommandStatusEntry>(
  ref: SubscriptionRef.SubscriptionRef<CommandStatusBuffer>,
  commandId: string,
  predicate: (entry: CommandStatusEntry) => entry is A,
): Effect.Effect<A, CommandStatusUnavailable> =>
  findStatusEntry(ref, commandId, predicate).pipe(
    Effect.flatMap((current) =>
      Option.isSome(current)
        ? Effect.succeed(current.value)
        : SubscriptionRef.changes(ref).pipe(
            Stream.map((buffer) =>
              buffer.entries.find(
                (entry): entry is A =>
                  entry.commandId === commandId && predicate(entry),
              ),
            ),
            Stream.filter((entry): entry is A => entry !== undefined),
            Stream.runHead,
            Effect.flatMap((option) =>
              Option.isSome(option)
                ? Effect.succeed(option.value)
                : Effect.fail(
                    new CommandStatusUnavailable({
                      operation: "watch Commands.Status",
                    }),
                  ),
            ),
          ),
    ),
  );

const findStatusEntry = <A extends CommandStatusEntry>(
  ref: SubscriptionRef.SubscriptionRef<CommandStatusBuffer>,
  commandId: string,
  predicate: (entry: CommandStatusEntry) => entry is A,
) =>
  SubscriptionRef.get(ref).pipe(
    Effect.map((buffer) => {
      const entry = buffer.entries.find(
        (entry): entry is A =>
          entry.commandId === commandId && predicate(entry),
      );
      return entry === undefined ? Option.none<A>() : Option.some(entry);
    }),
  );

const timeoutAs =
  <A, E2>(duration: Duration.Input, error: E2) =>
  <E1, R>(effect: Effect.Effect<A, E1, R>) =>
    effect.pipe(
      Effect.timeoutOption(duration),
      Effect.flatMap((option) =>
        Option.isSome(option)
          ? Effect.succeed(option.value)
          : Effect.fail(error),
      ),
    );
