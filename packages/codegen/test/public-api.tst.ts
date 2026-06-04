import { Duration, Effect, Schema, Stream } from "effect";
import { describe, expect, it } from "tstyche";

import {
  Opcua,
  OpcuaSession,
  type OpcuaSubscription,
} from "@effect-opcua/client";
import {
  check,
  defineConfig,
  generate,
  type CheckResult,
  type GenerateResult,
} from "@effect-opcua/codegen";

declare const subscription: OpcuaSubscription;

describe("codegen public API", () => {
  it("keeps the root package surface small", () => {
    const config = defineConfig({
      endpointUrl: "opc.tcp://localhost:4840",
      clientOptions: { endpointMustExist: false },
      userIdentity: { type: 1, userName: "user", password: "secret" },
      outputDir: "src/generated",
      roots: [
        { path: ["DemoFillingCell"] },
        { nodeId: "ns=2;s=PLC", exportPrefix: "PLC" },
      ],
      exclude: [
        { path: ["DemoFillingCell", "Commands", "Catalog"], mode: "prune" },
        { path: ["DemoFillingCell", "**", /^InterfaceVersion/], mode: "omit" },
      ],
      discovery: { onBrowseFailure: "warn" },
      diagnostics: { warningsAsErrors: true, typeFallback: "dynamic" },
    });

    expect(generate).type.toBeCallableWith(config);
    expect(check).type.toBeCallableWith(config);

    Effect.map(generate(config), (result) => {
      expect(result).type.toBe<GenerateResult>();
      expect(result).type.toHaveProperty("issues");
      expect(result).type.toHaveProperty("writtenFiles");
      expect(result).type.not.toHaveProperty("files");
    });

    Effect.map(check(config), (result) => {
      expect(result).type.toBe<CheckResult>();
      expect(result).type.toHaveProperty("issues");
      expect(result).type.toHaveProperty("staleFiles");
      expect(result).type.toHaveProperty("missingFiles");
      expect(result).type.toHaveProperty("ok");
      expect(result).type.not.toHaveProperty("files");
    });
  });

  it("uses generated write-only variables with write APIs only", () => {
    const WriteOnly = Opcua.variable({
      nodeId: "ns=1;s=Commands.Submit",
      codec: Opcua.schema(Schema.String),
      access: "write",
    });

    expect(OpcuaSession.write).type.toBeCallableWith(WriteOnly, "run");
    expect(OpcuaSession.writeMany).type.toBeCallableWith({
      submit: [WriteOnly, "run"],
    } as const);
    expect(OpcuaSession.write).type.not.toBeCallableWith(WriteOnly, 1);
    expect(OpcuaSession.read).type.not.toBeCallableWith(WriteOnly);
    expect(OpcuaSession.readMany).type.not.toBeCallableWith({
      submit: WriteOnly,
    } as const);
  });

  it("uses generated structures with read and write APIs", () => {
    const ScanSettings = Opcua.structure({
      name: "ScanSettings",
      dataTypeId: "ns=1;i=3010",
      schema: Schema.Struct({
        duration: Schema.Number,
        cycles: Schema.Number,
        dataAvailable: Schema.Boolean,
      }),
    });
    const ScanSettingsQueue = Opcua.structureArray(ScanSettings);
    const Settings = Opcua.variable({
      nodeId: "ns=1;s=Machine.ScanSettings",
      codec: ScanSettings,
      access: "readWrite",
    });
    const Queue = Opcua.variable({
      nodeId: "ns=1;s=Machine.ScanSettingsQueue",
      codec: ScanSettingsQueue,
      access: "readWrite",
    });
    const settings: Opcua.CodecType<typeof ScanSettings> = {
      duration: 100,
      cycles: 2,
      dataAvailable: true,
    };
    const queue: Opcua.CodecType<typeof ScanSettingsQueue> = [settings];

    expect(OpcuaSession.read).type.toBeCallableWith(Settings);
    expect(OpcuaSession.write).type.toBeCallableWith(Settings, settings);
    expect(OpcuaSession.readMany).type.toBeCallableWith({
      settings: Settings,
      queue: Queue,
    } as const);
    expect(OpcuaSession.writeMany).type.toBeCallableWith({
      settings: [Settings, settings],
      queue: [Queue, queue],
    } as const);
    expect(OpcuaSession.write).type.not.toBeCallableWith(Settings, {
      duration: "wrong",
      cycles: 2,
      dataAvailable: true,
    });
    expect(OpcuaSession.write).type.not.toBeCallableWith(Queue, settings);
  });

  it("uses generated structures with call and monitor APIs", () => {
    const RunConfiguration = Opcua.structure({
      name: "RunConfiguration",
      dataTypeId: "ns=1;i=4001",
      schema: Schema.Struct({
        productName: Schema.String,
        targetFillVolumeMl: Schema.Number,
      }),
    });
    const CommandStatus = Opcua.structure({
      name: "CommandStatus",
      dataTypeId: "ns=1;i=4002",
      schema: Schema.Struct({
        commandId: Schema.String,
        ok: Schema.Boolean,
      }),
    });
    const Status = Opcua.variable({
      nodeId: "ns=1;s=Commands.Status",
      codec: CommandStatus,
    });
    const Configure = Opcua.method({
      objectId: "ns=1;s=Commands",
      methodId: "ns=1;s=Commands.Configure",
      input: {
        configuration: Opcua.arg({ codec: RunConfiguration }),
      },
      output: {
        status: Opcua.arg({ codec: CommandStatus }),
      },
    });
    const configuration: Opcua.CodecType<typeof RunConfiguration> = {
      productName: "Water",
      targetFillVolumeMl: 250,
    };

    expect(OpcuaSession.call).type.toBeCallableWith(Configure, {
      configuration,
    });
    expect(OpcuaSession.callMany).type.toBeCallableWith({
      configure: [Configure, { configuration }],
    } as const);
    expect(OpcuaSession.call).type.not.toBeCallableWith(Configure, {
      configuration: {
        productName: "Water",
        targetFillVolumeMl: "wrong",
      },
    });
    expect(subscription.monitor).type.toBeCallableWith(
      { status: Status } as const,
      {
        startup: "strict" as const,
        validation: "strict" as const,
        samplingInterval: Duration.millis(250),
        queueSize: 1,
        discardOldest: true,
        filter: Opcua.MonitorFilter.statusValue(),
        timestamps: "source" as const,
        clientBuffer: Opcua.BufferPolicy.latest(),
      },
    );

    Effect.gen(function* () {
      const monitor = yield* subscription.monitor({ status: Status } as const, {
        startup: "strict" as const,
        validation: "strict" as const,
        samplingInterval: Duration.millis(250),
        queueSize: 1,
        discardOldest: true,
        filter: Opcua.MonitorFilter.statusValue(),
        timestamps: "source" as const,
        clientBuffer: Opcua.BufferPolicy.latest(),
      });

      yield* monitor.samples.pipe(
        Stream.runForEach((sample) =>
          Effect.sync(() => {
            if (sample._tag === "Value") {
              expect(sample.value).type.toBe<
                Opcua.CodecType<typeof CommandStatus>
              >();
            }
          }),
        ),
      );
    });
  });
});
