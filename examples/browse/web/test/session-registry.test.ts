import { Effect, Layer } from "effect";
import { describe, expect, it } from "vitest";

import {
  SessionFactory,
  SessionRegistry,
} from "../src/server/session-registry.js";
import { makeFakeSession } from "./support/fake-session.js";

describe("SessionRegistry", () => {
  it("reconnects cleanly, disconnects, and cleans up", async () => {
    const closed: Array<string> = [];
    let count = 0;
    const factory = Layer.succeed(SessionFactory)({
      connect: (request) => {
        const id = `${++count}:${request.endpointUrl}`;
        return Effect.succeed({
          session: makeFakeSession(),
          close: Effect.sync(() => {
            closed.push(id);
          }),
        });
      },
    });
    const layer = SessionRegistry.layer.pipe(Layer.provide(factory));

    await Effect.runPromise(
      Effect.gen(function* () {
        const registry = yield* SessionRegistry;
        yield* registry.connect(1, {
          endpointUrl: "opc.tcp://one",
          auth: { _tag: "Anonymous" },
        });
        yield* registry.connect(1, {
          endpointUrl: "opc.tcp://two",
          auth: { _tag: "Anonymous" },
        });
        expect(closed).toEqual(["1:opc.tcp://one"]);
        expect(yield* registry.size).toBe(1);
        expect(yield* registry.disconnect(1)).toBe(true);
        expect(closed).toEqual(["1:opc.tcp://one", "2:opc.tcp://two"]);
        expect(yield* registry.size).toBe(0);
        yield* registry.connect(2, {
          endpointUrl: "opc.tcp://three",
          auth: { _tag: "Anonymous" },
        });
        yield* registry.cleanup(2);
        expect(closed).toEqual([
          "1:opc.tcp://one",
          "2:opc.tcp://two",
          "3:opc.tcp://three",
        ]);
      }).pipe(Effect.provide(layer)),
    );
  });
});

