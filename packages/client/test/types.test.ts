import { Config, Schema } from "effect";
import { expect, it } from "vitest";

import {
  Capabilities,
  OpcuaClient,
  type OpcuaSession,
  type OpcuaValueHandle,
  type WritableOpcuaValueHandle,
} from "../src/index.js";

const expectWriteValuesTypes = (
  session: OpcuaSession,
  numberHandle: WritableOpcuaValueHandle<number>,
  readOnlyHandle: OpcuaValueHandle<number, typeof Capabilities.read>,
) => {
  session.writeValues([{ handle: numberHandle, value: 123 }]);

  // @ts-expect-error value must match the handle schema type
  session.writeValues([{ handle: numberHandle, value: "wrong" }]);

  // @ts-expect-error read-only handles are not accepted for writes
  session.writeValues([{ handle: readOnlyHandle, value: 123 }]);
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
