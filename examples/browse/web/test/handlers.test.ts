import { Effect, Fiber, Layer, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";

import { UaBrowserRpcs } from "../src/shared/rpc.js";
import { UaBrowserHandlers } from "../src/server/handlers.js";
import {
  SessionFactory,
  SessionRegistry,
} from "../src/server/session-registry.js";
import {
  goodStatus,
  makeFakeSession,
  objectMetadata,
  valueSample,
  variableMetadata,
} from "./support/fake-session.js";

describe("RPC handlers", () => {
  it("connects, browses, reads, writes, and interrupts monitor streams", async () => {
    let connected = false;
    let disconnected = false;
    let interrupted = 0;
    const session = makeFakeSession({
      metadata: {
        "i=85": objectMetadata("i=85"),
        "ns=1;s=Temperature": variableMetadata("ns=1;s=Temperature"),
      },
      values: {
        "ns=1;s=Temperature": {
          _tag: "Value",
          nodeId: "ns=1;s=Temperature",
          value: 10,
          status: goodStatus,
        },
      },
      monitorStream: Stream.fromEffectRepeat(
        Effect.succeed(valueSample("ns=1;s=Temperature", 10)),
      ).pipe(Stream.ensuring(Effect.sync(() => interrupted++))),
    });
    const registry = Layer.succeed(SessionRegistry)({
      connect: () =>
        Effect.sync(() => {
          connected = true;
          return session;
        }),
      get: () => Effect.succeed(session),
      disconnect: () =>
        Effect.sync(() => {
          disconnected = true;
          return true;
        }),
      cleanup: () => Effect.void,
      storeContinuation: () => Effect.succeed("unused"),
      takeContinuation: () =>
        Effect.fail(new Error("unused continuation") as never),
      releaseContinuation: () => Effect.succeed(false),
      releaseContinuations: () => Effect.void,
      size: Effect.succeed(connected && !disconnected ? 1 : 0),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
            Effect.provide(UaBrowserHandlers),
            Effect.provide(registry),
          );

          const connected = yield* client.Connect({
            endpointUrl: "opc.tcp://localhost:4840",
            startNodeId: "i=85",
            auth: { _tag: "Anonymous" },
          });
          expect(connected).toEqual({
            connected: true,
            endpointUrl: "opc.tcp://localhost:4840",
          });

          const browse = yield* client.Browse({ nodeId: "i=85" });
          expect(browse._tag).toBe("Browsed");
          if (browse._tag !== "Browsed") throw new Error("expected browse");
          expect(
            browse.references.map((reference) => reference.nodeId),
          ).toEqual(["ns=1;s=Temperature"]);

          const metadataOnly = yield* client.ReadNode({
            nodeId: "ns=1;s=Temperature",
          });
          expect(metadataOnly.value).toBeUndefined();
          expect(metadataOnly.metadata).toMatchObject({
            nodeId: "ns=1;s=Temperature",
          });

          const read = yield* client.ReadNode({
            nodeId: "ns=1;s=Temperature",
            value: true,
          });
          expect(read.value).toMatchObject({ value: 10 });

          const write = yield* client.WriteNode({
            nodeId: "ns=1;s=Temperature",
            value: 42,
          });
          expect(write.write).toMatchObject({ _tag: "Written" });
          expect(write.refreshed.value).toMatchObject({ value: 42 });

          const events = yield* client
            .MonitorValues({
              nodeIds: ["ns=1;s=Temperature"],
              samplingIntervalMs: 100,
            })
            .pipe(Stream.take(2), Stream.runCollect);
          expect(Array.from(events)).toMatchObject([
            {
              _tag: "Started",
              accepted: ["ns=1;s=Temperature"],
              rejected: [],
            },
            {
              _tag: "Sample",
              sample: { nodeId: "ns=1;s=Temperature" },
            },
          ]);

          yield* Effect.sleep("10 millis");
          expect(interrupted).toBe(1);

          const result = yield* client.Disconnect();
          expect(result.disconnected).toBe(true);
          expect(disconnected).toBe(true);
        }),
      ),
    );
  });

  it("cleans up sessions when connect is interrupted", async () => {
    let cleaned = false;
    const registry = Layer.succeed(SessionRegistry)({
      connect: () => Effect.never,
      get: () =>
        Effect.succeed(
          makeFakeSession({
            metadata: { "i=85": objectMetadata("i=85") },
          }),
        ),
      disconnect: () => Effect.succeed(false),
      cleanup: () =>
        Effect.sync(() => {
          cleaned = true;
        }),
      storeContinuation: () => Effect.succeed("unused"),
      takeContinuation: () =>
        Effect.fail(new Error("unused continuation") as never),
      releaseContinuation: () => Effect.succeed(false),
      releaseContinuations: () => Effect.void,
      size: Effect.succeed(0),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
            Effect.provide(UaBrowserHandlers),
            Effect.provide(registry),
          );

          const fiber = yield* Effect.forkScoped(
            client.Connect({
              endpointUrl: "opc.tcp://localhost:4840",
              startNodeId: "i=85",
              auth: { _tag: "Anonymous" },
            }),
          );
          yield* Effect.sleep("10 millis");
          yield* Fiber.interrupt(fiber);
          expect(cleaned).toBe(true);
        }),
      ),
    );
  });

  it("loads browse continuation pages through opaque tokens", async () => {
    const released: Array<string> = [];
    const session = makeFakeSession({
      metadata: {
        "i=85": objectMetadata("i=85"),
        "ns=1;s=Temperature": variableMetadata("ns=1;s=Temperature"),
        "ns=1;s=Pressure": variableMetadata("ns=1;s=Pressure"),
      },
      browsePages: [["ns=1;s=Temperature"], ["ns=1;s=Pressure"]],
      onReleaseContinuation: (nodeId) => released.push(nodeId),
    });
    const factory = Layer.succeed(SessionFactory)({
      connect: () =>
        Effect.succeed({
          session,
          close: Effect.void,
        }),
    });
    const registry = SessionRegistry.layer.pipe(Layer.provide(factory));

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
            Effect.provide(UaBrowserHandlers),
            Effect.provide(registry),
          );

          yield* client.Connect({
            endpointUrl: "opc.tcp://localhost:4840",
            startNodeId: "i=85",
            auth: { _tag: "Anonymous" },
          });

          const first = yield* client.Browse({
            nodeId: "i=85",
            maxReferencesPerNode: 1,
          });
          expect(first).toMatchObject({
            _tag: "Browsed",
            references: [{ nodeId: "ns=1;s=Temperature" }],
          });
          expect(first._tag === "Browsed" && first.continuationToken).toEqual(
            expect.any(String),
          );
          if (first._tag !== "Browsed" || !first.continuationToken) {
            throw new Error("expected continuation token");
          }

          const second = yield* client.Browse({
            nodeId: "i=85",
            continuationToken: first.continuationToken,
          });
          expect(second).toMatchObject({
            _tag: "Browsed",
            references: [{ nodeId: "ns=1;s=Pressure" }],
          });

          const invalid = yield* Effect.flip(
            client.Browse({
              nodeId: "i=85",
              continuationToken: first.continuationToken,
            }),
          );
          expect(invalid).toMatchObject({
            _tag: "WebRpcError",
            category: "Session",
            operation: "BrowseContinuation",
          });

          const fresh = yield* client.Browse({
            nodeId: "i=85",
            maxReferencesPerNode: 1,
          });
          if (fresh._tag !== "Browsed" || !fresh.continuationToken) {
            throw new Error("expected fresh continuation token");
          }
          expect(
            yield* client.ReleaseBrowseContinuation({
              continuationToken: fresh.continuationToken,
            }),
          ).toEqual({ released: true });
          expect(released).toContain("i=85");
        }),
      ),
    );
  });

  it("returns sanitized RPC errors", async () => {
    const registry = Layer.succeed(SessionRegistry)({
      connect: () => Effect.fail(new Error("not used by this test") as never),
      get: () =>
        Effect.succeed({
          ...makeFakeSession(),
          inspectNode: () =>
            Effect.fail(new Error("raw session failure with stack") as never),
        }),
      disconnect: () => Effect.succeed(false),
      cleanup: () => Effect.void,
      storeContinuation: () => Effect.succeed("unused"),
      takeContinuation: () =>
        Effect.fail(new Error("unused continuation") as never),
      releaseContinuation: () => Effect.succeed(false),
      releaseContinuations: () => Effect.void,
      size: Effect.succeed(0),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
            Effect.provide(UaBrowserHandlers),
            Effect.provide(registry),
          );

          const error = yield* Effect.flip(
            client.ReadNode({ nodeId: "ns=1;s=Temperature" }),
          );
          expect(error).toMatchObject({
            _tag: "WebRpcError",
            category: "Unexpected",
            operation: "ReadNode",
            nodeId: "ns=1;s=Temperature",
            message: "raw session failure with stack",
          });
          expect("cause" in error).toBe(false);
        }),
      ),
    );
  });

  it("rejects writes when the server write policy is disabled", async () => {
    const previous = process.env.EFFECT_OPCUA_WEB_WRITES;
    process.env.EFFECT_OPCUA_WEB_WRITES = "disabled";
    const registry = Layer.succeed(SessionRegistry)({
      connect: () => Effect.succeed(makeFakeSession()),
      get: () => Effect.succeed(makeFakeSession()),
      disconnect: () => Effect.succeed(false),
      cleanup: () => Effect.void,
      storeContinuation: () => Effect.succeed("unused"),
      takeContinuation: () =>
        Effect.fail(new Error("unused continuation") as never),
      releaseContinuation: () => Effect.succeed(false),
      releaseContinuations: () => Effect.void,
      size: Effect.succeed(0),
    });

    try {
      await Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
              Effect.provide(UaBrowserHandlers),
              Effect.provide(registry),
            );

            expect(yield* client.GetConfig()).toEqual({
              writePolicy: { _tag: "Disabled" },
            });
            const error = yield* Effect.flip(
              client.WriteNode({ nodeId: "ns=1;s=Setpoint", value: 12 }),
            );
            expect(error).toMatchObject({
              _tag: "WebRpcError",
              category: "Configuration",
              operation: "WriteNode",
              message: "Writes are disabled by server policy",
            });
          }),
        ),
      );
    } finally {
      if (previous === undefined) {
        delete process.env.EFFECT_OPCUA_WEB_WRITES;
      } else {
        process.env.EFFECT_OPCUA_WEB_WRITES = previous;
      }
    }
  });
});
