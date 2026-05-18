import { Config, Schema } from "effect";
import { expect, it } from "vitest";

import {
  Capabilities,
  OpcuaClient,
  type OpcuaSession,
  type OpcuaMethodSpec,
  type OpcuaValueHandle,
  type OpcuaWriteValueSpec,
  type WritableOpcuaValueHandle,
} from "../src/index.js";

const expectWriteHandleValuesTypes = (
  session: OpcuaSession,
  numberHandle: WritableOpcuaValueHandle<number>,
  readOnlyHandle: OpcuaValueHandle<number, typeof Capabilities.read>,
) => {
  session.writeHandleValues([{ handle: numberHandle, value: 123 }]);

  // @ts-expect-error value must match the handle schema type
  session.writeHandleValues([{ handle: numberHandle, value: "wrong" }]);

  // @ts-expect-error read-only handles are not accepted for writes
  session.writeHandleValues([{ handle: readOnlyHandle, value: 123 }]);
};

void expectWriteHandleValuesTypes;

const expectWriteValuesTypes = (session: OpcuaSession) => {
  const spec = {
    nodeId: "ns=1;s=Number",
    schema: Schema.Number,
    value: 123,
  } satisfies OpcuaWriteValueSpec<"ns=1;s=Number", typeof Schema.Number>;

  session.writeValues([spec]);

  const badSpec = {
    nodeId: "ns=1;s=Number",
    schema: Schema.Number,
    value: "wrong",
  };

  // @ts-expect-error schema-backed values must match the schema type
  session.writeValues([badSpec]);
};

void expectWriteValuesTypes;

const expectReadValueTypes = (session: OpcuaSession) => {
  session.readValue({ nodeId: "ns=1;s=Dynamic" });
  session.readValue({ nodeId: "ns=1;s=Number", schema: Schema.Number });
  session.readValues([
    { nodeId: "ns=1;s=Dynamic" },
    { nodeId: "ns=1;s=Number", schema: Schema.Number },
  ] as const);
};

void expectReadValueTypes;

const expectMethodTypes = (session: OpcuaSession) => {
  const start = {
    objectId: "ns=1;s=MyMachine",
    methodId: "ns=1;s=MyMachine.Start",
    inputSchema: Schema.Struct({
      StartSpeed: Schema.Number,
      Force: Schema.Boolean,
    }),
    outputSchema: Schema.Struct({
      Accepted: Schema.Boolean,
    }),
  } as const satisfies OpcuaMethodSpec;

  session.callMethod({
    ...start,
    input: { StartSpeed: 1, Force: false },
  });

  // @ts-expect-error method input must match the input schema
  session.callMethod({ ...start, input: { StartSpeed: "wrong", Force: false } });
};

void expectMethodTypes;

const expectLayerConfigTypes = () => {
  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
  });

  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
    clientOptions: {},
  });

  OpcuaClient.layerConfig({
    endpointUrl: Config.string("OPCUA_ENDPOINT_URL"),
    clientOptions: Config.succeed({}),
  });

  // @ts-expect-error endpointUrl must be a Config value
  OpcuaClient.layerConfig({ endpointUrl: "opc.tcp://localhost:4840" });
};

void expectLayerConfigTypes;

it("keeps compile-time API checks", () => {
  expect(true).toBe(true);
});
