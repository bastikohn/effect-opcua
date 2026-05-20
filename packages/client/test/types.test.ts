import { Config, Schema } from "effect";
import { expect, it } from "vitest";

import {
  Opcua,
  OpcuaClient,
  type OpcuaSession,
  type VariableHandle,
  type WritableVariableHandle,
} from "../src/index.js";

const expectVariableHandleTypes = (
  session: OpcuaSession,
  writable: WritableVariableHandle<number>,
  readOnly: VariableHandle<string, number, "read">,
) => {
  writable.write(123);

  // @ts-expect-error value must match the handle codec type
  writable.write("wrong");

  // @ts-expect-error read-only handles do not expose write
  readOnly.write(123);

  session.handle(
    Opcua.variable({
      nodeId: "ns=1;s=Number",
      codec: Opcua.schema(Schema.Number),
    }),
  );
};

void expectVariableHandleTypes;

const expectBatchTypes = (
  numberHandle: WritableVariableHandle<number>,
  booleanHandle: WritableVariableHandle<boolean>,
) => {
  Opcua.writeAll([
    { handle: numberHandle, value: 123 },
    { handle: booleanHandle, value: false },
  ] as const);

  Opcua.writeAll([
    {
      handle: numberHandle,
      // @ts-expect-error write values must match their handle type
      value: "wrong",
    },
  ] as const);
};

void expectBatchTypes;

const expectMethodTypes = (session: OpcuaSession) => {
  const start = Opcua.method({
    objectId: "ns=1;s=MyMachine",
    methodId: "ns=1;s=MyMachine.Start",
    input: {
      StartSpeed: Opcua.arg({ codec: Opcua.schema(Schema.Number) }),
      Force: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
    },
    output: {
      Accepted: Opcua.arg({ codec: Opcua.schema(Schema.Boolean) }),
    },
  });

  session.handle(start);
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
