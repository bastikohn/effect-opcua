import {
  Opcua,
  OpcuaSession,
  type OpcuaSession as OpcuaSessionService,
  type ReadManyResult,
} from "@effect-opcua/client";
import {
  Context,
  Duration,
  Effect,
  Layer,
  Ref,
  Stream,
  SubscriptionRef,
} from "effect";

import { CommandStatusUnavailable } from "../contract/errors.js";
import type { DemoMachineOptions } from "../contract/options.js";
import type { DemoMachineSnapshot } from "../contract/telemetry.js";
import {
  bigintValue,
  makeSnapshot,
  snapshotVariables,
  type TelemetryStaging,
} from "./telemetry-snapshot.js";

export type DemoMachineTelemetryCoreService = {
  readonly readSnapshot: Effect.Effect<DemoMachineSnapshot>;
  readonly watchSnapshot: Stream.Stream<DemoMachineSnapshot>;
};

export class DemoMachineTelemetryCore extends Context.Service<
  DemoMachineTelemetryCore,
  DemoMachineTelemetryCoreService
>()("@effect-opcua/demo-client/internal/DemoMachineTelemetryCore") {
  static layerLive = (options: DemoMachineOptions = {}) => {
    void options;
    return Layer.effect(
      DemoMachineTelemetryCore,
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const subscription = yield* session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
        const active = yield* subscription.monitor(
          { telemetryRevision: snapshotVariables.telemetryRevision },
          {
            startup: "strict",
            validation: "strict",
            samplingInterval: Duration.millis(50),
            queueSize: 5,
            discardOldest: true,
            filter: Opcua.MonitorFilter.statusValue(),
            timestamps: "both",
            clientBuffer: Opcua.BufferPolicy.sliding(64),
          },
        );
        const initialSnapshot = yield* readSnapshotFromSession(session);
        const latestRevision = yield* Ref.make(initialSnapshot.revision);
        const snapshotRef = yield* SubscriptionRef.make(initialSnapshot);

        yield* active.samples.pipe(
          Stream.runForEach((sample) =>
            sample._tag === "Value"
              ? refreshSnapshot(
                  session,
                  snapshotRef,
                  latestRevision,
                  sample.value,
                )
              : Effect.void,
          ),
          Effect.catch(() => Effect.void),
          Effect.forkScoped,
        );

        return DemoMachineTelemetryCore.of({
          readSnapshot: SubscriptionRef.get(snapshotRef),
          watchSnapshot: SubscriptionRef.changes(snapshotRef),
        });
      }),
    );
  };
}

const readSnapshotFromSession = (session: OpcuaSessionService) =>
  session
    .readMany(snapshotVariables, { validation: "strict" })
    .pipe(Effect.flatMap(readManyToStaging), Effect.map(makeSnapshot));

const refreshSnapshot = (
  session: OpcuaSessionService,
  snapshotRef: SubscriptionRef.SubscriptionRef<DemoMachineSnapshot>,
  latestRevision: Ref.Ref<bigint>,
  sampledRevision: unknown,
) =>
  Effect.gen(function* () {
    const revision = bigintValue(sampledRevision);
    const latest = yield* Ref.get(latestRevision);
    if (revision <= latest) return;

    const snapshot = yield* readSnapshotFromSession(session);
    if (snapshot.revision < latest) return;
    yield* Ref.set(latestRevision, snapshot.revision);
    yield* SubscriptionRef.set(snapshotRef, snapshot);
  }).pipe(Effect.catch(() => Effect.void));

const readManyToStaging = (results: ReadManyResult<typeof snapshotVariables>) =>
  Effect.gen(function* () {
    const staging: Record<string, unknown> = {};
    for (const [key, result] of Object.entries(results)) {
      if (result._tag !== "Value") {
        return yield* Effect.fail(
          new CommandStatusUnavailable({
            operation: "read telemetry snapshot",
            cause: result,
          }),
        );
      }
      staging[key] = result.value;
    }
    return staging as TelemetryStaging;
  });
