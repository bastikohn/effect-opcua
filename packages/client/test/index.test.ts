import { describe, expect, it } from "vitest";
import { Duration, Effect, Layer, Schema, Stream } from "effect";

import {
  Capabilities,
  ClientBufferPolicy,
  OpcuaClient,
  OpcuaSession,
  capabilities,
} from "../src/index.js";

describe("capabilities", () => {
  it("returns the provided capabilities", () => {
    expect(capabilities("read", "write")).toEqual(["read", "write"]);
    expect(Capabilities.readWrite).toEqual(["read", "write"]);
  });
});

describe("subscriptions", () => {
  it("subscribes to two nodeIds", async () => {
    const endpointUrl = "opc.tcp://192.168.100.166:4842";
    const nodeIds = ["ns=0;i=2258", "ns=0;i=2259"] as const;
    const layer = OpcuaSession.layer().pipe(
      Layer.provideMerge(OpcuaClient.layer({ endpointUrl })),
    );
    const program = Effect.scoped(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(250),
        });
        const values = subscription.monitorValues(
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
        );
        yield* values.pipe(
          Stream.runDrain,
          Effect.forkScoped({ startImmediately: true }),
        );
        return yield* subscription.events.pipe(
          Stream.filter((event) => event._tag === "MonitorItemsCreated"),
          Stream.take(1),
          Stream.runCollect,
        );
      }),
    ).pipe(Effect.provide(layer), Effect.timeout("10 seconds"));

    const events = await Effect.runPromise(program);

    expect(events[0]).toMatchObject({
      _tag: "MonitorItemsCreated",
      nodeIds: [...nodeIds],
    });
    console.dir(events);
  }, 20_000);

  it("receives values in the right format", async () => {
    const endpointUrl = "opc.tcp://192.168.100.166:4842";
    const nodeIds = ["ns=0;i=2258", "ns=0;i=2259"] as const;
    const layer = OpcuaSession.layer().pipe(
      Layer.provideMerge(OpcuaClient.layer({ endpointUrl })),
    );
    const program = Effect.scoped(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(250),
        });
        return yield* subscription
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
          .pipe(Stream.take(2), Stream.runCollect);
      }),
    ).pipe(Effect.provide(layer), Effect.timeout("10 seconds"));

    const values = await Effect.runPromise(program);

    console.dir(values);
    expect(values).toHaveLength(2);
    expect(values).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          _tag: "Value",
          nodeId: nodeIds[0],
          value: expect.any(Date),
        }),
        expect.objectContaining({
          _tag: "Value",
          nodeId: nodeIds[1],
          value: expect.any(Number),
        }),
      ]),
    );
  }, 20_000);
});
