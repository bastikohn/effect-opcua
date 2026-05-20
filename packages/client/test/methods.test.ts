import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import {
  Opcua,
  OpcuaConfigurationError,
  OpcuaMethodInputError,
  OpcuaMethodNotExecutableError,
  OpcuaSession,
} from "../src/index.js";
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
  it("discovers metadata and builds callable handles", async () => {
    const handle = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.handle(StartMethod);
      }),
    );

    expect(handle.metadata).toMatchObject({
      objectId: "ns=1;s=MyMachine",
      methodId: "ns=1;s=MyMachine.Start",
      executable: true,
      userExecutable: true,
    });
    expect(handle.metadata.inputMapping).toEqual([
      expect.objectContaining({
        key: "StartSpeed",
        index: 0,
        argumentName: "StartSpeed",
      }),
      expect.objectContaining({
        key: "Force",
        index: 1,
        argumentName: "Force",
      }),
    ]);
    expect(handle.unsafeRaw.inputArguments).toHaveLength(2);
  });

  it("fails eagerly for disabled methods", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.handle(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.DisabledCommand",
            }),
          );
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaMethodNotExecutableError);
  });

  it("maps arguments by public key, OPC UA name, and OPC UA index", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const handle = yield* session.handle(
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
        );
        return yield* handle.call({ startSpeed: 120, force: true });
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
          const session = yield* OpcuaSession;
          return yield* session.handle(
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
          );
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.handle(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.UnnamedArguments",
            }),
          );
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);
  });

  it("rejects invalid and duplicate OPC UA argument selectors", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.handle(
            Opcua.method({
              objectId: "ns=1;s=MyMachine",
              methodId: "ns=1;s=MyMachine.Start",
              input: {
                speed: Opcua.arg({
                  name: "StartSpeed",
                  index: 0,
                  codec: Opcua.schema(Schema.Number),
                }),
                force: Opcua.arg({
                  name: "Force",
                  codec: Opcua.schema(Schema.Boolean),
                }),
              },
            }),
          );
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.handle(
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
          );
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);
  });

  it("calls methods with named inputs, zero inputs, and dynamic values", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const start = yield* session.handle(StartMethod);
        const reset = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Reset",
          }),
        );
        const echo = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Echo",
          }),
        );
        const started = yield* start.call({ StartSpeed: 120, Force: false });
        const resetResult = yield* reset.call({});
        const echoed = yield* echo.call({ Value: "hello" });
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
        const session = yield* OpcuaSession;
        const handle = yield* session.handle(StartMethod);
        let calls = 0;
        const original = session.unsafeRaw.call.bind(session.unsafeRaw);
        (session.unsafeRaw as { call: typeof session.unsafeRaw.call }).call = ((
          input: never,
        ) => {
          calls++;
          return original(input);
        }) as typeof session.unsafeRaw.call;

        const missing = yield* handle
          .call({ StartSpeed: 1 } as never)
          .pipe(Effect.flip);
        const unknown = yield* handle
          .call({ StartSpeed: 1, Force: false, Extra: true } as never)
          .pipe(Effect.flip);
        return { calls, missing, unknown };
      }),
    );

    expect(failures.calls).toBe(0);
    expect(failures.missing).toBeInstanceOf(OpcuaMethodInputError);
    expect(failures.missing).toMatchObject({ phase: "MissingInputKey" });
    expect(failures.unknown).toMatchObject({ phase: "UnknownInputKey" });
  });

  it("returns method statuses and schema decode failures as data", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const reject = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.RejectIfNegative",
          }),
        );
        const echoNumber = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Echo",
            input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
            output: {
              Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
            },
          }),
        );
        return {
          nonGood: yield* reject.call({ Value: -1 }),
          decode: yield* echoNumber.call({ Value: "not-a-number" }),
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
        const session = yield* OpcuaSession;
        const handle = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Echo",
            includeRaw: true,
          }),
        );
        const withDefault = yield* handle.call({ Value: "raw" });
        const withoutRaw = yield* handle.call(
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

  it("calls all method handles in input order", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const echo = yield* session.handle(
          Opcua.method({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Echo",
          }),
        );
        return yield* Opcua.callAll([
          {
            handle: echo,
            input: { Value: "a" },
            options: { includeRaw: true },
          },
          { handle: echo, input: { Value: "b" } },
        ] as const);
      }),
    );

    expect(result.map((entry) => entry._tag)).toEqual(["Called", "Called"]);
    expect(result[0]).toMatchObject({ output: { Value: "a" } });
    expect(result[1]).toMatchObject({ output: { Value: "b" } });
    expect(result[0].unsafeRaw).toBeDefined();
    expect(result[1].unsafeRaw).toBeUndefined();
  });

  it("encodes and decodes structure method arguments through the shared codec", async () => {
    const settings = { duration: 100, cycles: 3, dataAvailable: true };
    const jobs = [
      { duration: 10, cycles: 1, dataAvailable: true },
      { duration: 20, cycles: 2, dataAvailable: false },
    ];
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const echoScan = yield* session.handle(
          Opcua.method({
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
          }),
        );
        return yield* echoScan.call({ Settings: settings, Jobs: jobs });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { Settings: settings, Jobs: jobs },
    });
  });
});
