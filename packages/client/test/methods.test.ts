import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import * as Opcua from "../src/Opcua.js";
import * as OpcuaSession from "../src/OpcuaSession.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4844);
const ScanSettingsSpec = Opcua.Structure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});
const ScanSettings = Opcua.structure(ScanSettingsSpec);
const ScanSettingsArray = Opcua.structureArray(
  Opcua.Structure.array(ScanSettingsSpec),
);

const StartMethod = Opcua.method({
  objectId: "ns=1;s=MyMachine",
  methodId: "ns=1;s=MyMachine.Start",
  input: {
    StartSpeed: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
    Force: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
  },
  output: {
    Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
    JobId: Opcua.arg({ codec: Opcua.schema(Schema.String) }),
  },
});

describe("methods", () => {
  it("calls methods through definitions", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.call(StartMethod, {
          StartSpeed: 120,
          Force: true,
        });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { Accepted: true, JobId: "job-120" },
    });
  });

  it("fails eagerly for disabled methods", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.call(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.DisabledCommand",
            }),
            {},
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MethodNotExecutable" },
    });
  });

  it("maps arguments by public key, OPC UA name, and OPC UA index", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.call(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Start",
            input: {
              startSpeed: Opcua.arg({
                name: "StartSpeed",
                codec: Opcua.schema(Schema.Number),
              }),
              force: Opcua.arg({
                index: 1,
                codec: Opcua.schema(Schema.Boolean),
              }),
            },
            output: {
              accepted: Opcua.arg({
                index: 0,
                codec: Opcua.schema(Schema.Boolean),
              }),
              jobId: Opcua.arg({
                name: "JobId",
                codec: Opcua.schema(Schema.String),
              }),
            },
          }),
          { startSpeed: 120, force: true },
        );
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { accepted: true, jobId: "job-120" },
    });
  });

  it("rejects incomplete maps and unusable default names", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.call(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.Start",
              input: {
                startSpeed: Opcua.arg({
                  name: "StartSpeed",
                  codec: Opcua.schema(Schema.Number),
                }),
              },
            }),
            { startSpeed: 1 },
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.call(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.UnnamedArguments",
            }),
            {},
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });
  });

  it("rejects invalid and duplicate OPC UA argument selectors", async () => {
    expect(() =>
      Opcua.arg({
        name: "StartSpeed",
        index: 0,
        codec: Opcua.schema(Schema.Number),
      }),
    ).toThrow("name and index are mutually exclusive");

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.call(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.Start",
              input: {
                speed: Opcua.arg({
                  name: "StartSpeed",
                  codec: Opcua.schema(Schema.Number),
                }),
                duplicate: Opcua.arg({
                  index: 0,
                  codec: Opcua.schema(Schema.Number),
                }),
              },
            }),
            { speed: 1, duplicate: 1 },
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });
  });

  it("calls methods with named inputs, zero inputs, and dynamic values", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const Reset = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Reset",
          output: {
            Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
          },
        });
        const Echo = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
          input: { Value: Opcua.arg() },
          output: { Value: Opcua.arg() },
        });
        const started = yield* session.call(StartMethod, {
          StartSpeed: 120,
          Force: false,
        });
        const resetResult = yield* session.call(Reset, {});
        const echoed = yield* session.call(Echo, { Value: "hello" });
        return { started, resetResult, echoed };
      }),
    );

    expect(result.started).toMatchObject({
      _tag: "Called",
      output: { Accepted: true, JobId: "job-120" },
    });
    expect(result.resetResult).toMatchObject({
      _tag: "Called",
      output: { Accepted: true },
    });
    expect(result.echoed).toMatchObject({
      _tag: "Called",
      output: { Value: "hello" },
    });
  });

  it("fails missing and unknown input keys before calling the server", async () => {
    const failures = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        let calls = 0;
        const original = session.unsafeRaw.call.bind(session.unsafeRaw);
        (session.unsafeRaw as { call: typeof session.unsafeRaw.call }).call = ((
          input: never,
        ) => {
          calls++;
          return original(input);
        }) as typeof session.unsafeRaw.call;

        const missing = yield* session
          .call(StartMethod, { StartSpeed: 1 } as never)
          .pipe(Effect.flip);
        const unknown = yield* session
          .call(StartMethod, {
            StartSpeed: 1,
            Force: false,
            Extra: true,
          } as never)
          .pipe(Effect.flip);
        return { calls, missing, unknown };
      }),
    );

    expect(failures.calls).toBe(0);
    expect(failures.missing).toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MethodInput", phase: "MissingInputKey" },
    });
    expect(failures.unknown).toMatchObject({
      reason: { phase: "UnknownInputKey" },
    });
  });

  it("returns method statuses and schema decode failures as data", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const Reject = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.RejectIfNegative",
          input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
          output: {
            Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
          },
        });
        const EchoNumber = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
          input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
          output: {
            Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
          },
        });
        return {
          nonGood: yield* session.call(Reject, { Value: -1 }),
          decode: yield* session.call(EchoNumber, { Value: "not-a-number" }),
        };
      }),
    );

    expect(result.nonGood).toMatchObject({
      _tag: "NonGoodStatus",
      status: { isGood: false },
    });
    expect(result.decode).toMatchObject({ _tag: "DecodeError" });
  });

  it("supports includeRaw defaults and per-call overrides", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const Echo = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
          input: { Value: Opcua.arg() },
          output: { Value: Opcua.arg() },
          includeRaw: true,
        });
        const withDefault = yield* session.call(Echo, { Value: "raw" });
        const withoutRaw = yield* session.call(
          Echo,
          { Value: "raw" },
          { includeRaw: false },
        );
        return { withDefault, withoutRaw };
      }),
    );

    expect(result.withDefault.unsafeRaw?.request).toBeDefined();
    expect(result.withDefault.unsafeRaw?.result).toBeDefined();
    expect(result.withoutRaw.unsafeRaw).toBeUndefined();
  });

  it("calls keyed method definitions in key order", async () => {
    const Echo = Opcua.method({
      objectId: "ns=1;s=MyMachine",
      methodId: "ns=1;s=MyMachine.Echo",
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
    });
    const result = await runLive(
      Effect.gen(function* () {
        return yield* OpcuaSession.callMany({
          first: [Echo, { Value: "a" }, { includeRaw: true }],
          second: [Echo, { Value: "b" }],
        } as const);
      }),
    );

    expect(Object.values(result).map((entry) => entry._tag)).toEqual([
      "Called",
      "Called",
    ]);
    expect(result.first).toMatchObject({ output: { Value: "a" } });
    expect(result.second).toMatchObject({ output: { Value: "b" } });
    expect(result.first.unsafeRaw).toBeDefined();
    expect(result.second.unsafeRaw).toBeUndefined();
  });

  it("encodes and decodes structure method arguments through the shared codec", async () => {
    const settings = { duration: 100, cycles: 3, dataAvailable: true };
    const jobs = [
      { duration: 10, cycles: 1, dataAvailable: true },
      { duration: 20, cycles: 2, dataAvailable: false },
    ];
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const EchoScan = Opcua.method({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.EchoScan",
          input: {
            Settings: Opcua.arg({ codec: ScanSettings }),
            Jobs: Opcua.arg({ codec: ScanSettingsArray }),
          },
          output: {
            Settings: Opcua.arg({ codec: ScanSettings }),
            Jobs: Opcua.arg({ codec: ScanSettingsArray }),
          },
        });
        return yield* session.call(EchoScan, {
          Settings: settings,
          Jobs: jobs,
        });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { Settings: settings, Jobs: jobs },
    });
  });
});
