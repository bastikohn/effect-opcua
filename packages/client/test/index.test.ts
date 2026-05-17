import { describe, expect, it } from "vitest";
import { Duration, Effect, Layer, Schema, Scope, Stream } from "effect";

import {
  Capabilities,
  ClientBufferPolicy,
  MonitorValueDeadband,
  MonitorValueFilter,
  OpcuaClient,
  OpcuaSession,
  capabilities,
} from "../src/index.js";

const endpointUrl =
  process.env.OPCUA_TEST_ENDPOINT_URL ?? "opc.tcp://192.168.100.166:4842";
const testIfEndpoint = endpointUrl ? it : it.skip;

const serverStatusNodeId = "ns=0;i=2256";
const currentTimeNodeId = "ns=0;i=2258";
const secondsTillShutdownNodeId = "ns=0;i=2259";

const makeLiveLayer = () =>
  OpcuaSession.layer().pipe(
    Layer.provideMerge(OpcuaClient.layer({ endpointUrl: endpointUrl! })),
  );

const runLive = <A, E>(
  effect: Effect.Effect<A, E, OpcuaSession | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(makeLiveLayer()),
      Effect.timeout("10 seconds"),
    ),
  );

describe("capabilities", () => {
  it("returns the provided capabilities without widening the value", () => {
    expect(capabilities("read", "write")).toEqual(["read", "write"]);
  });

  it("exposes common capability presets", () => {
    expect(Capabilities.read).toEqual(["read"]);
    expect(Capabilities.write).toEqual(["write"]);
    expect(Capabilities.readWrite).toEqual(["read", "write"]);
  });
});

describe("client options", () => {
  it("builds buffer policies", () => {
    expect(ClientBufferPolicy.latest()).toEqual({
      _tag: "Sliding",
      capacity: 1,
    });
    expect(ClientBufferPolicy.sliding(3)).toEqual({
      _tag: "Sliding",
      capacity: 3,
    });
    expect(ClientBufferPolicy.dropping(2)).toEqual({
      _tag: "Dropping",
      capacity: 2,
    });
  });

  it("builds monitor filters", () => {
    expect(MonitorValueDeadband.none()).toEqual({ _tag: "None" });
    expect(MonitorValueDeadband.absolute(0.5)).toEqual({
      _tag: "Absolute",
      value: 0.5,
    });
    expect(MonitorValueDeadband.percent(10)).toEqual({
      _tag: "Percent",
      value: 10,
    });
    expect(MonitorValueFilter.none()).toEqual({ _tag: "None" });
    expect(MonitorValueFilter.status()).toEqual({ _tag: "Status" });
    expect(
      MonitorValueFilter.statusValue(MonitorValueDeadband.absolute(1)),
    ).toEqual({
      _tag: "StatusValue",
      deadband: { _tag: "Absolute", value: 1 },
    });
    expect(MonitorValueFilter.statusValueTimestamp()).toEqual({
      _tag: "StatusValueTimestamp",
      deadband: { _tag: "None" },
    });
  });
});

describe("reading (integration)", () => {
  testIfEndpoint(
    "reads well-known server nodes",
    async () => {
      const values = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.readValues([
            { nodeId: currentTimeNodeId, schema: Schema.Date },
            { nodeId: secondsTillShutdownNodeId, schema: Schema.Number },
          ]);
        }),
      );

      expect(Object.keys(values)).toEqual([
        currentTimeNodeId,
        secondsTillShutdownNodeId,
      ]);
      expect(values[currentTimeNodeId]).toMatchObject({
        _tag: "Value",
        nodeId: currentTimeNodeId,
        value: expect.any(Date),
      });
      expect(values[secondsTillShutdownNodeId]).toMatchObject({
        _tag: "Value",
        nodeId: secondsTillShutdownNodeId,
        value: expect.any(Number),
      });
    },
    20_000,
  );

  it("rejects duplicate node ids before calling the server", async () => {
    const program = Effect.gen(function* () {
      const session = yield* OpcuaSession;
      return yield* session.readValues([
        { nodeId: serverStatusNodeId, schema: Schema.Unknown },
        { nodeId: serverStatusNodeId, schema: Schema.Unknown },
      ]);
    }).pipe(
      Effect.provideService(OpcuaSession, {
        readValue: () => Effect.die("not implemented"),
        readValues: (specs) =>
          Effect.fail({
            _tag: "OpcuaConfigurationError" as const,
            operation: "readValues",
            nodeId: specs[1]?.nodeId,
            cause: "Duplicate nodeId",
          } as never),
        valueHandle: () => Effect.die("not implemented"),
        writeValues: () => Effect.die("not implemented"),
        createSubscription: () => Effect.die("not implemented"),
        events: Stream.empty,
        raw: {} as never,
      }),
      Effect.flip,
    );

    await expect(Effect.runPromise(program)).resolves.toMatchObject({
      _tag: "OpcuaConfigurationError",
      operation: "readValues",
      nodeId: serverStatusNodeId,
      cause: "Duplicate nodeId",
    });
  });
});

describe("subscriptions (integration)", () => {
  testIfEndpoint(
    "publishes MonitorItemsCreated for all requested node ids",
    async () => {
      const nodeIds = [currentTimeNodeId, secondsTillShutdownNodeId] as const;
      const events = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(250),
          });
          yield* subscription
            .monitorValues(
              [
                { nodeId: nodeIds[0], schema: Schema.Date },
                { nodeId: nodeIds[1], schema: Schema.Number },
              ],
              {
                samplingInterval: Duration.millis(250),
                queueSize: 1,
                discardOldest: true,
                clientBuffer: ClientBufferPolicy.latest(),
              },
            )
            .pipe(
              Stream.runDrain,
              Effect.forkScoped({ startImmediately: true }),
            );
          return yield* subscription.events.pipe(
            Stream.filter((event) => event._tag === "MonitorItemsCreated"),
            Stream.take(1),
            Stream.runCollect,
          );
        }),
      );

      expect(events[0]).toMatchObject({
        _tag: "MonitorItemsCreated",
        nodeIds: [...nodeIds],
      });
    },
    20_000,
  );

  it("value batching", async () => {
    const nodeIds = [currentTimeNodeId, secondsTillShutdownNodeId] as const;
    const values = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(500),
        });

        return yield* subscription
          .monitorValues(
            [
              { nodeId: nodeIds[0], schema: Schema.Date },
              { nodeId: nodeIds[1], schema: Schema.Number },
            ],
            {
              samplingInterval: Duration.millis(50),
              queueSize: 1,
              discardOldest: true,
              clientBuffer: ClientBufferPolicy.latest(),
            },
          )
          .pipe(Stream.take(5), Stream.runCollect);
      }),
    );
    expect(values).toHaveLength(5);
  }, 20_000);

  testIfEndpoint(
    "decodes monitored values with the requested schema",
    async () => {
      const values = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(500),
          });
          return yield* subscription
            .monitorValues(
              [{ nodeId: currentTimeNodeId, schema: Schema.Date }],
              {
                samplingInterval: Duration.millis(100),
                queueSize: 5,
                discardOldest: false,
                clientBuffer: ClientBufferPolicy.latest(),
              },
            )
            .pipe(Stream.take(5), Stream.runCollect);
        }),
      );

      expect(values).toHaveLength(5);
      expect(values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: "Value",
            nodeId: currentTimeNodeId,
            value: expect.any(Date),
          }),
        ]),
      );
    },
    20_000,
  );
});
