import { Effect, Layer, Stream } from "effect";
import { RpcTest } from "effect/unstable/rpc";
import { describe, expect, it } from "vitest";

import { UaBrowserRpcs } from "../src/shared/rpc.js";
import { UaBrowserHandlers } from "../src/server/handlers.js";
import { SessionRegistry } from "../src/server/session-registry.js";
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
      size: Effect.succeed(connected && !disconnected ? 1 : 0),
    });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(UaBrowserRpcs).pipe(
            Effect.provide(UaBrowserHandlers),
            Effect.provide(registry),
          );

          const root = yield* client.Connect({
            endpointUrl: "opc.tcp://localhost:4840",
            startNodeId: "i=85",
            auth: { _tag: "Anonymous" },
          });
          expect(root.nodeId).toBe("i=85");

          const browse = yield* client.Browse({ nodeId: "i=85" });
          expect(browse.references.map((reference) => reference.nodeId)).toEqual(
            ["ns=1;s=Temperature"],
          );

          const read = yield* client.ReadNode({
            nodeId: "ns=1;s=Temperature",
          });
          expect(read.value).toMatchObject({ value: 10 });

          const write = yield* client.WriteNode({
            nodeId: "ns=1;s=Temperature",
            value: 42,
          });
          expect(write.write).toMatchObject({ _tag: "Written" });
          expect(write.refreshed.value).toMatchObject({ value: 42 });

          const samples = yield* client
            .MonitorValues({
              nodeIds: ["ns=1;s=Temperature"],
              samplingIntervalMs: 100,
            })
            .pipe(Stream.take(2), Stream.runCollect);
          expect(Array.from(samples)).toHaveLength(2);

          yield* Effect.sleep("10 millis");
          expect(interrupted).toBe(1);

          const result = yield* client.Disconnect();
          expect(result.disconnected).toBe(true);
          expect(disconnected).toBe(true);
        }),
      ),
    );
  });
});

