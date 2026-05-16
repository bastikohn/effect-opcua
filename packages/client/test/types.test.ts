import { expect, it } from "vitest";

import {
  Capabilities,
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

it("keeps compile-time writeValues checks", () => {
  expect(true).toBe(true);
});
