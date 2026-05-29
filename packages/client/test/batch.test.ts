import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import * as Opcua from "../src/Opcua.js";
import { isOpcuaError } from "../src/OpcuaError.js";
import { makeFakeSession, numberDataValue } from "./support/fake-session.js";

describe("keyed batch APIs", () => {
  it("returns empty dictionaries without server calls", async () => {
    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          return {
            read: yield* fake.session.readMany({}),
            write: yield* fake.session.writeMany({}),
            call: yield* fake.session.callMany({}),
            calls: fake.calls,
          };
        }),
      ),
    );

    expect(result).toMatchObject({ read: {}, write: {}, call: {} });
    expect(result.calls.valueReads).toHaveLength(0);
    expect(result.calls.writes).toHaveLength(0);
    expect(result.calls.calls).toHaveLength(0);
  });

  it("validates option shapes consistently across batch operations", async () => {
    const A = Opcua.variable({
      nodeId: "ns=1;s=Batch.Options.A",
      access: "readWrite",
    });
    const Echo = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Method",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();

          const topLevel = [
            yield* fake.session
              .readMany({ a: A } as const, { nope: true } as never)
              .pipe(Effect.flip),
            yield* fake.session
              .writeMany({ a: [A, 1] } as const, { nope: true } as never)
              .pipe(Effect.flip),
            yield* fake.session
              .callMany(
                { a: [Echo, { Value: 1 }] } as const,
                { nope: true } as never,
              )
              .pipe(Effect.flip),
          ];

          const serviceKey = [
            yield* fake.session
              .readMany(
                { a: A } as const,
                { validation: "none", service: { nope: 1 } } as never,
              )
              .pipe(Effect.flip),
            yield* fake.session
              .writeMany(
                { a: [A, 1] } as const,
                { service: { nope: 1 } } as never,
              )
              .pipe(Effect.flip),
            yield* fake.session
              .callMany(
                { a: [Echo, { Value: 1 }] } as const,
                { service: { nope: 1 } } as never,
              )
              .pipe(Effect.flip),
          ];

          const serviceValue = [
            yield* fake.session
              .readMany(
                { a: A } as const,
                {
                  validation: "none",
                  service: { maxConcurrentRequests: 0 },
                } as never,
              )
              .pipe(Effect.flip),
            yield* fake.session
              .writeMany(
                { a: [A, 1] } as const,
                { service: { maxConcurrentRequests: 0 } } as never,
              )
              .pipe(Effect.flip),
            yield* fake.session
              .callMany(
                { a: [Echo, { Value: 1 }] } as const,
                { service: { maxConcurrentRequests: 0 } } as never,
              )
              .pipe(Effect.flip),
          ];

          return { topLevel, serviceKey, serviceValue, calls: fake.calls };
        }),
      ),
    );

    expect(configurationCauses(result.topLevel)).toEqual([
      "unsupported option: nope",
      "unsupported option: nope",
      "unsupported option: nope",
    ]);
    expect(configurationCauses(result.serviceKey)).toEqual([
      "unsupported service option: nope",
      "unsupported service option: nope",
      "unsupported service option: nope",
    ]);
    expect(configurationCauses(result.serviceValue)).toEqual([
      "maxConcurrentRequests must be a positive integer",
      "maxConcurrentRequests must be a positive integer",
      "maxConcurrentRequests must be a positive integer",
    ]);
    expect(result.calls.valueReads).toHaveLength(0);
    expect(result.calls.writes).toHaveLength(0);
    expect(result.calls.calls).toHaveLength(0);
  });

  it("reads keyed definitions without validation and preserves key mapping", async () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Batch.Read.A",
      codec: Opcua.schema(Schema.Number),
    });
    const Pressure = Opcua.variable({
      nodeId: "ns=1;s=Batch.Read.B",
      codec: Opcua.schema(Schema.Number),
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            readValues: (nodes) =>
              nodes.map((node) =>
                numberDataValue(
                  node.nodeId?.toString() === "ns=1;s=Batch.Read.A" ? 1 : 2,
                ),
              ),
          });
          const values = yield* fake.session.readMany(
            { pressure: Pressure, temperature: Temperature } as const,
            {
              validation: "none",
              service: { maxNodesPerRead: 1, maxConcurrentRequests: 2 },
            },
          );
          return { values, calls: fake.calls };
        }),
      ),
    );

    expect(result.calls.metadataReads).toHaveLength(0);
    expect(result.calls.valueReads.map((call) => call.length)).toEqual([1, 1]);
    expect(result.values.temperature).toMatchObject({
      _tag: "Value",
      value: 1,
    });
    expect(result.values.pressure).toMatchObject({ _tag: "Value", value: 2 });
  });

  it("uses session batching defaults for batch service calls", async () => {
    const A = Opcua.variable({
      nodeId: "ns=1;s=Batch.Default.A",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const B = Opcua.variable({
      nodeId: "ns=1;s=Batch.Default.B",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const C = Opcua.variable({
      nodeId: "ns=1;s=Batch.Default.C",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const Echo = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Method",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
    });

    const calls = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            batching: {
              read: { maxNodesPerRead: 2 },
              write: { maxNodesPerWrite: 2 },
              call: { maxMethodsPerCall: 2 },
            },
          });
          yield* fake.session.readMany({ a: A, b: B, c: C } as const, {
            validation: "none",
          });
          yield* fake.session.writeMany({
            a: [A, 1],
            b: [B, 2],
            c: [C, 3],
          } as const);
          yield* fake.session.callMany({
            a: [Echo, { Value: 1 }],
            b: [Echo, { Value: 2 }],
            c: [Echo, { Value: 3 }],
          } as const);
          return fake.calls;
        }),
      ),
    );

    expect(calls.valueReads.map((call) => call.length)).toEqual([2, 1]);
    expect(calls.writes.map((call) => call.length)).toEqual([2, 1]);
    expect(calls.calls.map((call) => call.length)).toEqual([2, 1]);
  });

  it("lets per-call service options override session batching defaults", async () => {
    const A = Opcua.variable({ nodeId: "ns=1;s=Batch.Override.A" });
    const B = Opcua.variable({ nodeId: "ns=1;s=Batch.Override.B" });
    const C = Opcua.variable({ nodeId: "ns=1;s=Batch.Override.C" });

    const calls = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            batching: { read: { maxNodesPerRead: 3 } },
          });
          yield* fake.session.readMany({ a: A, b: B, c: C } as const, {
            validation: "none",
            service: { maxNodesPerRead: 1 },
          });
          return fake.calls;
        }),
      ),
    );

    expect(calls.valueReads.map((call) => call.length)).toEqual([1, 1, 1]);
  });

  it("caches strict read validation until session_restored", async () => {
    const Temperature = Opcua.variable({
      nodeId: "ns=1;s=Batch.Strict",
      codec: Opcua.schema(Schema.Number),
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          yield* fake.session.readMany({ temperature: Temperature } as const);
          yield* fake.session.readMany({ temperature: Temperature } as const);
          fake.raw.emit("session_restored");
          yield* fake.session.readMany({ temperature: Temperature } as const);
          return fake.calls;
        }),
      ),
    );

    expect(result.metadataReads).toHaveLength(2);
    expect(result.valueReads).toHaveLength(3);
  });

  it("rejects duplicate NodeIds for read and write", async () => {
    const A = Opcua.variable({ nodeId: "ns=1;s=Duplicate" });
    const B = Opcua.variable({
      nodeId: "ns=1;s=Duplicate",
      access: "readWrite",
    });

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSession();
            return yield* fake.session.readMany({ a: A, b: A } as const);
          }),
        ),
      ),
    ).rejects.toSatisfy(isConfigurationError);

    await expect(
      Effect.runPromise(
        Effect.scoped(
          Effect.gen(function* () {
            const fake = yield* makeFakeSession();
            return yield* fake.session.writeMany({
              a: [B, 1],
              b: [B, 2],
            } as const);
          }),
        ),
      ),
    ).rejects.toSatisfy(isConfigurationError);
  });

  it("preflights all writes before any write service call", async () => {
    const A = Opcua.variable({
      nodeId: "ns=1;s=Batch.Write.A",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });
    const B = Opcua.variable({
      nodeId: "ns=1;s=Batch.Write.B",
      codec: Opcua.schema(Schema.Number),
      access: "readWrite",
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          const error = yield* fake.session
            .writeMany({ a: [A, 1], b: [B, "bad" as never] } as const)
            .pipe(Effect.flip);
          return { error, calls: fake.calls };
        }),
      ),
    );

    expect(isOpcuaError(result.error)).toBe(true);
    expect(isOpcuaError(result.error) && result.error.reason._tag).toBe(
      "Encode",
    );
    expect(result.calls.writes).toHaveLength(0);
  });

  it("calls duplicate method definitions and maps results by key", async () => {
    const Echo = Opcua.method({
      objectId: "ns=1;s=Object",
      methodId: "ns=1;s=Method",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
    });

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession();
          const calls = yield* fake.session.callMany(
            {
              first: [Echo, { Value: 1 }],
              second: [Echo, { Value: 2 }, { includeRaw: true }],
            } as const,
            { service: { maxMethodsPerCall: 1, maxConcurrentRequests: 1 } },
          );
          return { calls, serviceCalls: fake.calls.calls };
        }),
      ),
    );

    expect(result.serviceCalls.map((call) => call.length)).toEqual([1, 1]);
    expect(result.calls.first).toMatchObject({
      _tag: "Called",
      output: { Value: 1 },
    });
    expect(result.calls.second).toMatchObject({
      _tag: "Called",
      output: { Value: 2 },
    });
    expect(result.calls.second.unsafeRaw).toBeDefined();
  });
});

const isConfigurationError = (
  error: unknown,
): error is {
  readonly reason: { readonly _tag: "Configuration"; readonly cause?: unknown };
} => isOpcuaError(error) && error.reason._tag === "Configuration";

const configurationCauses = (errors: ReadonlyArray<unknown>) =>
  errors.map((error) =>
    isConfigurationError(error) ? error.reason.cause : "not configuration",
  );
