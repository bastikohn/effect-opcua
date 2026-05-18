import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import {
  Capabilities,
  OpcuaConfigurationError,
  OpcuaMethodInputError,
  OpcuaMethodNotExecutableError,
  OpcuaSession,
  type OpcuaMethodSpec,
} from "../src/index.js";
import { makeLiveTestContext } from "./live.js";

const { runLive } = makeLiveTestContext(4844);

const StartMethod = {
  objectId: "ns=1;s=MyMachine",
  methodId: "ns=1;s=MyMachine.Start",
  inputSchema: Schema.Struct({
    StartSpeed: Schema.Number,
    Force: Schema.Boolean,
  }),
  outputSchema: Schema.Struct({
    Accepted: Schema.Boolean,
    JobId: Schema.String,
  }),
} as const satisfies OpcuaMethodSpec;

describe("methods", () => {
  it("discovers method argument metadata and executable flags", async () => {
    const handle = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.methodHandle(StartMethod);
      }),
    );

    expect(handle.capabilities).toBe(Capabilities.call);
    expect(handle.metadata).toMatchObject({
      objectId: "ns=1;s=MyMachine",
      methodId: "ns=1;s=MyMachine.Start",
      executable: true,
      userExecutable: true,
    });
    expect(handle.metadata.inputMapping).toEqual([
      { key: "StartSpeed", index: 0, argumentName: "StartSpeed" },
      { key: "Force", index: 1, argumentName: "Force" },
    ]);
    expect(
      handle.metadata.outputArguments.map((argument) => argument.name),
    ).toEqual(["Accepted", "JobId"]);
    expect(handle.raw.inputArguments).toHaveLength(2);
  });

  it("fails eagerly for disabled methods", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.methodHandle({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.DisabledCommand",
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaMethodNotExecutableError);
  });

  it("preserves default argument names and supports explicit maps", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const handle = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Start",
          inputArgumentMap: { startSpeed: "StartSpeed", force: 1 },
          outputArgumentMap: { accepted: 0, jobId: "JobId" },
        });
        return yield* handle.call({ startSpeed: 120, force: true });
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { accepted: true, jobId: "job-120" },
    });
  });

  it("rejects incomplete explicit input and output maps", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.methodHandle({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Start",
            inputArgumentMap: { startSpeed: "StartSpeed" },
          });
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
      cause: "Explicit argument map must cover every argument",
    });

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.methodHandle({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.Start",
            outputArgumentMap: { accepted: "Accepted" },
          });
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaConfigurationError",
      cause: "Explicit argument map must cover every argument",
    });
  });

  it("resolves method argument datatypes without treating datatype nodes as variables", async () => {
    const metadata = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const start = yield* session.methodHandle(StartMethod);
        const custom = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.CustomCommand",
        });
        return {
          start: start.metadata.inputArguments.map((argument) => ({
            name: argument.name,
            dataType: argument.dataType,
            valueRank: argument.valueRank,
          })),
          custom: custom.metadata.inputArguments.map((argument) => ({
            name: argument.name,
            dataType: argument.dataType,
            valueRank: argument.valueRank,
          })),
        };
      }),
    );

    expect(metadata.start).toEqual([
      { name: "StartSpeed", dataType: "Double", valueRank: -1 },
      { name: "Force", dataType: "Boolean", valueRank: -1 },
    ]);
    expect(metadata.custom).toEqual([
      { name: "Command", dataType: "ExtensionObject", valueRank: -1 },
      { name: "When", dataType: "DateTime", valueRank: -1 },
      { name: "Payload", dataType: "ByteString", valueRank: -1 },
      { name: "Values", dataType: "Double", valueRank: 1 },
    ]);
  });

  it("rejects unusable default argument names unless explicit maps are provided", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.methodHandle({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.UnnamedArguments",
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const handle = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.UnnamedArguments",
          inputArgumentMap: { first: 0, second: "Named" },
        });
        return yield* handle.call({ first: "a", second: "b" });
      }),
    );
    expect(result).toMatchObject({ _tag: "Called", output: { Result: "ab" } });

    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.methodHandle({
            objectId: "ns=1;s=MyMachine",
            methodId: "ns=1;s=MyMachine.DuplicateArguments",
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);
  });

  it("calls methods with named inputs, zero inputs, schemas, and dynamic values", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const start = yield* session.methodHandle(StartMethod);
        const reset = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Reset",
        });
        const echo = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
        });
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
        const handle = yield* session.methodHandle(StartMethod);
        let calls = 0;
        const original = session.raw.call.bind(session.raw);
        (session.raw as { call: typeof session.raw.call }).call = ((
          input: never,
        ) => {
          calls++;
          return original(input);
        }) as typeof session.raw.call;

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
        const reject = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.RejectIfNegative",
        });
        const echoNumber = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
          outputSchema: Schema.Struct({ Value: Schema.Number }),
        });
        const nonGood = yield* reject.call({ Value: -1 });
        const decode = yield* echoNumber.call({ Value: "not-a-number" });
        return { nonGood, decode };
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
        const handle = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
          includeRaw: true,
        });
        const withDefault = yield* handle.call({ Value: "raw" });
        const withoutRaw = yield* handle.call(
          { Value: "raw" },
          { includeRaw: false },
        );
        return { withDefault, withoutRaw };
      }),
    );

    expect(result.withDefault.raw?.request).toBeDefined();
    expect(result.withDefault.raw?.result).toBeDefined();
    expect(result.withoutRaw.raw).toBeUndefined();
  });

  it("offers one-off and batched handle method calls", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const oneOff = yield* session.callMethod({
          ...StartMethod,
          input: { StartSpeed: 7, Force: true },
        });
        const echo = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
        });

        let batchCalls = 0;
        const original = session.raw.call.bind(session.raw);
        (session.raw as { call: typeof session.raw.call }).call = ((
          input: never,
        ) => {
          if (Array.isArray(input)) batchCalls++;
          return original(input);
        }) as typeof session.raw.call;

        const batch = yield* session.callMethodHandles([
          {
            handle: echo,
            input: { Value: "a" },
            options: { includeRaw: true },
          },
          { handle: echo, input: { Value: "b" } },
        ] as const);
        return { oneOff, batch, batchCalls };
      }),
    );

    expect(result.oneOff).toMatchObject({
      _tag: "Called",
      output: { JobId: "job-7" },
    });
    expect(result.batch.map((entry) => entry._tag)).toEqual([
      "Called",
      "Called",
    ]);
    expect(result.batch[0]).toMatchObject({ output: { Value: "a" } });
    expect(result.batch[1]).toMatchObject({ output: { Value: "b" } });
    expect(result.batch[0].raw).toBeDefined();
    expect(result.batch[1].raw).toBeUndefined();
    expect(result.batchCalls).toBe(1);
  });

  it("rejects malformed batch call service responses", async () => {
    const error = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const echo = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
        });
        (session.raw as { call: typeof session.raw.call }).call =
          (async () => ({})) as unknown as typeof session.raw.call;

        return yield* session
          .callMethodHandles([{ handle: echo, input: { Value: "a" } }] as const)
          .pipe(Effect.flip);
      }),
    );

    expect(error).toMatchObject({
      _tag: "OpcuaServiceError",
      operation: "callMethodHandles",
      cause: "Expected 1 call results, got non-array",
    });
  });

  it("preflights all batch entries before sending method calls", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const echo = yield* session.methodHandle({
          objectId: "ns=1;s=MyMachine",
          methodId: "ns=1;s=MyMachine.Echo",
        });
        let calls = 0;
        const original = session.raw.call.bind(session.raw);
        (session.raw as { call: typeof session.raw.call }).call = ((
          input: never,
        ) => {
          calls++;
          return original(input);
        }) as typeof session.raw.call;

        const error = yield* session
          .callMethodHandles([
            { handle: echo, input: { Value: "valid" } },
            { handle: echo, input: {} as never },
          ] as const)
          .pipe(Effect.flip);
        return { calls, error };
      }),
    );

    expect(result.calls).toBe(0);
    expect(result.error).toBeInstanceOf(OpcuaMethodInputError);
  });
});
