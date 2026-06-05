import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";
import type { CallMethodRequestLike } from "node-opcua";

import { Opcua, type OpcuaSession } from "@effect-opcua/client";
import {
  DataType,
  StatusCodes,
  Variant,
  VariantArrayType,
} from "@effect-opcua/client/node-opcua";
import {
  booleanArgument,
  makeFakeSession,
  methodResult,
  numberArgument,
  stringArgument,
  structureArgument,
  type FakeSessionOptions,
} from "./support/fake-session.js";

const MACHINE_ID = "ns=1;s=MyMachine";
const SCAN_SETTINGS_TYPE = "ns=1;i=3010";

const ScanSettings = Opcua.structure({
  name: "ScanSettings",
  dataTypeId: SCAN_SETTINGS_TYPE,
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});
const ScanSettingsArray = Opcua.structureArray(ScanSettings);

const StartMethod = Opcua.method({
  objectId: MACHINE_ID,
  methodId: methodNodeId("Start"),
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
    const result = await runWithFakeSession((fake) =>
      fake.session.call(StartMethod, {
        StartSpeed: 120,
        Force: true,
      }),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { Accepted: true, JobId: "job-120" },
    });
  });

  it("fails eagerly for disabled methods", async () => {
    await expect(
      runWithFakeSession((fake) =>
        fake.session.call(
          Opcua.method({
            objectId: MACHINE_ID,
            methodId: methodNodeId("DisabledCommand"),
          }),
          {},
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "MethodNotExecutable" },
    });
  });

  it("maps arguments by public key, OPC UA name, and OPC UA index", async () => {
    const result = await runWithFakeSession((fake) =>
      fake.session.call(
        Opcua.method({
          objectId: MACHINE_ID,
          methodId: methodNodeId("Start"),
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
      ),
    );

    expect(result).toMatchObject({
      _tag: "Called",
      output: { accepted: true, jobId: "job-120" },
    });
  });

  it("rejects incomplete maps and unusable default names", async () => {
    await expect(
      runWithFakeSession((fake) =>
        fake.session.call(
          Opcua.method({
            objectId: MACHINE_ID,
            methodId: methodNodeId("Start"),
            input: {
              startSpeed: Opcua.arg({
                name: "StartSpeed",
                codec: Opcua.schema(Schema.Number),
              }),
            },
          }),
          { startSpeed: 1 },
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });

    await expect(
      runWithFakeSession((fake) =>
        fake.session.call(
          Opcua.method({
            objectId: MACHINE_ID,
            methodId: methodNodeId("UnnamedArguments"),
          }),
          {},
        ),
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
      runWithFakeSession((fake) =>
        fake.session.call(
          Opcua.method({
            objectId: MACHINE_ID,
            methodId: methodNodeId("Start"),
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
        ),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });
  });

  it("calls methods with named inputs, zero inputs, and dynamic values", async () => {
    const result = await runWithFakeSession((fake) => {
      const Reset = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("Reset"),
        output: {
          Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
        },
      });
      const Echo = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("Echo"),
        input: { Value: Opcua.arg() },
        output: { Value: Opcua.arg() },
      });
      return Effect.gen(function* () {
        const started = yield* fake.session.call(StartMethod, {
          StartSpeed: 120,
          Force: false,
        });
        const resetResult = yield* fake.session.call(Reset, {});
        const echoed = yield* fake.session.call(Echo, { Value: "hello" });
        return { started, resetResult, echoed };
      });
    });

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
    const failures = await runWithFakeSession((fake) =>
      Effect.gen(function* () {
        let calls = 0;
        const original = fake.session.unsafeRaw.call.bind(
          fake.session.unsafeRaw,
        );
        (
          fake.session.unsafeRaw as {
            call: typeof fake.session.unsafeRaw.call;
          }
        ).call = ((input: never) => {
          calls++;
          return original(input);
        }) as typeof fake.session.unsafeRaw.call;

        const missing = yield* fake.session
          .call(StartMethod, { StartSpeed: 1 } as never)
          .pipe(Effect.flip);
        const unknown = yield* fake.session
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
    const result = await runWithFakeSession((fake) => {
      const Reject = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("RejectIfNegative"),
        input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }) },
        output: {
          Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
        },
      });
      const EchoNumber = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("Echo"),
        input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
        output: {
          Value: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
        },
      });
      return Effect.gen(function* () {
        return {
          nonGood: yield* fake.session.call(Reject, { Value: -1 }),
          decode: yield* fake.session.call(EchoNumber, {
            Value: "not-a-number",
          }),
        };
      });
    });

    expect(result.nonGood).toMatchObject({
      _tag: "NonGoodStatus",
      status: { isGood: false },
    });
    expect(result.decode).toMatchObject({ _tag: "DecodeError" });
  });

  it("supports includeRaw defaults and per-call overrides", async () => {
    const result = await runWithFakeSession((fake) => {
      const Echo = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("Echo"),
        input: { Value: Opcua.arg() },
        output: { Value: Opcua.arg() },
        includeRaw: true,
      });
      return Effect.gen(function* () {
        const withDefault = yield* fake.session.call(Echo, { Value: "raw" });
        const withoutRaw = yield* fake.session.call(
          Echo,
          { Value: "raw" },
          { includeRaw: false },
        );
        return { withDefault, withoutRaw };
      });
    });

    expect(result.withDefault.unsafeRaw?.request).toBeDefined();
    expect(result.withDefault.unsafeRaw?.result).toBeDefined();
    expect(result.withoutRaw.unsafeRaw).toBeUndefined();
  });

  it("calls keyed method definitions in key order", async () => {
    const Echo = Opcua.method({
      objectId: MACHINE_ID,
      methodId: methodNodeId("Echo"),
      input: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
      output: { Value: Opcua.arg({ codec: Opcua.schema(Schema.String) }) },
    });
    const result = await runWithFakeSession((fake) =>
      fake.session.callMany({
        first: [Echo, { Value: "a" }, { includeRaw: true }],
        second: [Echo, { Value: "b" }],
      } as const),
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
    const result = await runWithFakeSession((fake) => {
      const EchoScan = Opcua.method({
        objectId: MACHINE_ID,
        methodId: methodNodeId("EchoScan"),
        input: {
          Settings: Opcua.arg({ codec: ScanSettings }),
          Jobs: Opcua.arg({ codec: ScanSettingsArray }),
        },
        output: {
          Settings: Opcua.arg({ codec: ScanSettings }),
          Jobs: Opcua.arg({ codec: ScanSettingsArray }),
        },
      });
      return fake.session.call(EchoScan, {
        Settings: settings,
        Jobs: jobs,
      });
    });

    expect(result).toMatchObject({
      _tag: "Called",
      output: { Settings: settings, Jobs: jobs },
    });
  });
});

function methodNodeId<const Name extends string>(name: Name) {
  return `ns=1;s=MyMachine.${name}` as const;
}

type FakeMethodSession = {
  readonly session: OpcuaSession.Service;
};

const runWithFakeSession = <A, E>(
  body: (fake: FakeMethodSession) => Effect.Effect<A, E, never>,
) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const fake = yield* makeFakeSession(methodFakeOptions);
        return yield* body(fake);
      }),
    ),
  );

const methodFakeOptions: FakeSessionOptions = {
  methodDefinitions: {
    [methodNodeId("Start")]: {
      inputArguments: [numberArgument("StartSpeed"), booleanArgument("Force")],
      outputArguments: [booleanArgument("Accepted"), stringArgument("JobId")],
    },
    [methodNodeId("DisabledCommand")]: {
      executable: false,
      inputArguments: [],
      outputArguments: [booleanArgument("Accepted")],
    },
    [methodNodeId("UnnamedArguments")]: {
      inputArguments: [stringArgument(""), stringArgument("Named")],
      outputArguments: [stringArgument("Result")],
    },
    [methodNodeId("Reset")]: {
      inputArguments: [],
      outputArguments: [booleanArgument("Accepted")],
    },
    [methodNodeId("Echo")]: {
      inputArguments: [stringArgument("Value")],
      outputArguments: [stringArgument("Value")],
    },
    [methodNodeId("RejectIfNegative")]: {
      inputArguments: [numberArgument("Value")],
      outputArguments: [booleanArgument("Accepted")],
    },
    [methodNodeId("EchoScan")]: {
      inputArguments: [
        structureArgument("Settings", SCAN_SETTINGS_TYPE),
        structureArgument("Jobs", SCAN_SETTINGS_TYPE, 1),
      ],
      outputArguments: [
        structureArgument("Settings", SCAN_SETTINGS_TYPE),
        structureArgument("Jobs", SCAN_SETTINGS_TYPE, 1),
      ],
    },
  },
  dataTypeSuperTypes: { [SCAN_SETTINGS_TYPE]: "i=22" },
  methodResults: ({ request }) => resultForMethod(request),
};

const resultForMethod = (request: CallMethodRequestLike) => {
  const methodId = request.methodId?.toString();
  const inputs = request.inputArguments ?? [];
  switch (methodId) {
    case methodNodeId("Start"): {
      const speed = Number((inputs[0] as Variant | undefined)?.value ?? 0);
      const force = Boolean((inputs[1] as Variant | undefined)?.value);
      return methodResult([
        new Variant({
          dataType: DataType.Boolean,
          value: speed > 0 || force,
        }),
        new Variant({
          dataType: DataType.String,
          value: `job-${Math.trunc(speed)}`,
        }),
      ]);
    }
    case methodNodeId("Reset"):
      return methodResult([
        new Variant({ dataType: DataType.Boolean, value: true }),
      ]);
    case methodNodeId("Echo"):
      return methodResult([
        new Variant({
          dataType: DataType.String,
          value: String((inputs[0] as Variant | undefined)?.value ?? ""),
        }),
      ]);
    case methodNodeId("RejectIfNegative"): {
      const value = Number((inputs[0] as Variant | undefined)?.value ?? 0);
      return value < 0
        ? methodResult([], StatusCodes.BadInvalidArgument)
        : methodResult([
            new Variant({ dataType: DataType.Boolean, value: true }),
          ]);
    }
    case methodNodeId("EchoScan"): {
      const settings = (inputs[0] as Variant | undefined)?.value;
      const jobs = (inputs[1] as Variant | undefined)?.value;
      return methodResult([
        new Variant({
          dataType: DataType.ExtensionObject,
          value: settings,
        }),
        new Variant({
          dataType: DataType.ExtensionObject,
          arrayType: VariantArrayType.Array,
          value: Array.isArray(jobs) ? jobs : [],
        }),
      ]);
    }
    default:
      return methodResult([]);
  }
};
