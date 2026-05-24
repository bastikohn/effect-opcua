import { describe, expect, it } from "vitest";
import { Effect, Schema } from "effect";

import { GlobalCommandKind } from "../../../examples/demo-server/src/index.js";
import * as Opcua from "../src/Opcua.js";
import * as OpcuaSession from "../src/OpcuaSession.js";
import { DataType, StatusCodes, VariantArrayType } from "../src/node-opcua.js";
import { makeLiveTestContext } from "./live.js";
import {
  GlobalCommandSubmitRequest,
  MachineConfigurePayload,
  MoveAxisToPositionPayload,
  defaultRunConfiguration,
  demoNodeId,
} from "./support/demo-model.js";
import {
  fakeExtensionObject,
  makeFakeSession,
  variantDataValue,
} from "./support/fake-session.js";

const { runLive } = makeLiveTestContext("values", 2);

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

describe("values", () => {
  it("reads dynamic and schema-backed variables through definitions", async () => {
    const tankLevel = demoNodeId("Filling.Tank.LevelMl");
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return {
          dynamic: yield* session.read(Opcua.variable({ nodeId: tankLevel })),
          number: yield* session.read(
            Opcua.variable({
              nodeId: tankLevel,
              codec: Opcua.schema(Schema.Number),
            }),
          ),
          mismatch: yield* session.read(
            Opcua.variable({
              nodeId: tankLevel,
              codec: Opcua.schema(Schema.String),
            }),
          ),
        };
      }),
    );

    expect(result.dynamic).toMatchObject({
      _tag: "Value",
      nodeId: tankLevel,
      status: { isGood: true },
      variant: { dataType: "Double" },
    });
    expect(result.number).toMatchObject({
      _tag: "Value",
      value: expect.any(Number),
    });
    expect(result.mismatch).toMatchObject({
      _tag: "DecodeError",
      status: { isGood: true },
    });
  });

  it("reads and writes demo command structures", async () => {
    const commandId = "client-values-configure";
    const configure = Opcua.variable({
      nodeId: demoNodeId("Commands.Payloads.Machine.Configure"),
      codec: MachineConfigurePayload,
      access: "readWrite",
      includeRaw: true,
    });
    const submit = Opcua.variable({
      nodeId: demoNodeId("Commands.SubmitRequest"),
      codec: GlobalCommandSubmitRequest,
      access: "readWrite",
    });

    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        const writtenPayload = yield* session.write(configure, {
          commandId,
          configuration: defaultRunConfiguration,
        });
        const sample = yield* session.read(configure);
        const submitted = yield* session.write(submit, {
          commandId,
          commandKind: GlobalCommandKind.Machine_Configure,
          clientId: "client-values",
        });
        const productName = yield* session.read(
          Opcua.variable({
            nodeId: demoNodeId("State.Configuration.ProductName"),
            codec: Opcua.schema(Schema.String),
          }),
        );
        return { writtenPayload, sample, submitted, productName };
      }),
    );

    expect(result.writtenPayload).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({
      _tag: "Value",
      value: {
        commandId,
        configuration: {
          productName: defaultRunConfiguration.productName,
          batchSize: defaultRunConfiguration.batchSize,
        },
      },
    });
    expect(
      result.sample._tag === "Value" && result.sample.unsafeRaw?.variant,
    ).toBeDefined();
    expect(result.submitted).toMatchObject({ _tag: "Written" });
    expect(result.productName).toMatchObject({
      _tag: "Value",
      value: defaultRunConfiguration.productName,
    });
  });

  it("returns write statuses as data", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession.OpcuaSession;
        return yield* session.write(
          Opcua.variable({
            nodeId: demoNodeId("Commands.SubmitRequest"),
            codec: GlobalCommandSubmitRequest,
            access: "readWrite",
          }),
          { commandId: "", commandKind: GlobalCommandKind.None, clientId: "" },
        );
      }),
    );

    expect(result).toMatchObject({
      _tag: "Written",
      status: { text: StatusCodes.Good.toString() },
    });
  });

  it("keeps keyed batch helpers thin and ordered", async () => {
    const configureNodeId = demoNodeId("Commands.Payloads.Machine.Configure");
    const moveNodeId = demoNodeId(
      "Commands.Payloads.Maintenance.MoveXAxisToPosition",
    );
    const result = await runLive(
      Effect.gen(function* () {
        return yield* OpcuaSession.writeMany({
          configure: [
            Opcua.variable({
              nodeId: configureNodeId,
              codec: MachineConfigurePayload,
              access: "readWrite",
            }),
            {
              commandId: "batch-configure",
              configuration: defaultRunConfiguration,
            },
          ],
          move: [
            Opcua.variable({
              nodeId: moveNodeId,
              codec: MoveAxisToPositionPayload,
              access: "readWrite",
            }),
            {
              commandId: "batch-move",
              targetPositionMm: 100,
              velocityMmPerSecond: 25,
            },
          ],
        } as const);
      }),
    );

    expect(result).toMatchObject({
      configure: { _tag: "Written", nodeId: configureNodeId },
      move: { _tag: "Written", nodeId: moveNodeId },
    });
  });

  it("enforces read/write access before direct writes", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.write(
            Opcua.variable({
              nodeId: demoNodeId("Filling.Tank.LevelMl"),
              access: "readWrite",
            }),
            1,
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "AccessDenied", requestedCapability: "write" },
    });
  });

  it("reads and writes structure arrays with a test-local session", async () => {
    const queueNodeId = "ns=1;s=MyMachine.ScanSettingsQueue";
    const values = [
      { duration: 10, cycles: 1, dataAvailable: true },
      { duration: 20, cycles: 2, dataAvailable: false },
    ];
    let current: ReadonlyArray<unknown> = values.map((value) =>
      fakeExtensionObject("ns=1;i=3010", value),
    );

    const result = await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          const fake = yield* makeFakeSession({
            variableMetadata: {
              [queueNodeId]: {
                dataType: "ns=1;i=3010",
                valueRank: 1,
                accessLevel: 3,
                userAccessLevel: 3,
              },
            },
            dataTypeSuperTypes: { "ns=1;i=3010": "i=22" },
            readValues: () => [
              variantDataValue(
                DataType.ExtensionObject,
                [...current],
                StatusCodes.Good,
                VariantArrayType.Array,
              ),
            ],
            onWrite: (nodes) => {
              const value = nodes[0]?.value?.value?.value;
              current = Array.isArray(value) ? value : [];
            },
          });
          const queue = Opcua.variable({
            nodeId: queueNodeId,
            codec: ScanSettingsQueue,
            access: "readWrite",
          });
          const written = yield* fake.session.write(queue, values);
          const sample = yield* fake.session.read(queue);
          return { written, sample };
        }),
      ),
    );

    expect(result.written).toMatchObject({ _tag: "Written" });
    expect(result.sample).toMatchObject({ _tag: "Value", value: values });
  });

  it("rejects structure metadata mismatches before reads", async () => {
    await expect(
      runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession.OpcuaSession;
          return yield* session.read(
            Opcua.variable({
              nodeId: demoNodeId("Filling.Tank.LevelMl"),
              codec: MachineConfigurePayload,
            }),
          );
        }),
      ),
    ).rejects.toMatchObject({
      _tag: "OpcuaError",
      reason: { _tag: "Configuration" },
    });
  });
});
