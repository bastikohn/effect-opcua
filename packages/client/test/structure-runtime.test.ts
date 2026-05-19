import { describe, expect, it } from "vitest";
import { DataType, coerceNodeId } from "node-opcua";
import { Schema } from "effect";

import { OpcuaStructure } from "../src/index.js";
import { validateStructureMetadata } from "../src/structure-runtime.js";

const ScanSettings = OpcuaStructure.make({
  name: "ScanSettings",
  dataTypeId: "ns=1;i=3010",
  schema: Schema.Struct({
    duration: Schema.Number,
    cycles: Schema.Number,
    dataAvailable: Schema.Boolean,
  }),
});

const metadata = (valueRank: number) => ({
  valueRank,
  raw: {
    declaredDataType: coerceNodeId("ns=1;i=3010"),
    builtInDataType: DataType.ExtensionObject,
  },
});

describe("structure runtime metadata validation", () => {
  it("accepts OPC-UA scalar-compatible ValueRanks", () => {
    for (const valueRank of [-1, -2, -3]) {
      expect(
        validateStructureMetadata(
          "test",
          "ns=1;s=Scalar",
          metadata(valueRank),
          ScanSettings,
        ),
      ).toBeUndefined();
    }
  });

  it("accepts OPC-UA one-dimensional array-compatible ValueRanks", () => {
    const structure = OpcuaStructure.array(ScanSettings);
    for (const valueRank of [1, 0, -2, -3]) {
      expect(
        validateStructureMetadata(
          "test",
          "ns=1;s=Array",
          metadata(valueRank),
          structure,
        ),
      ).toBeUndefined();
    }
  });

  it("normalizes NodeIds before declared DataType comparison", () => {
    expect(
      validateStructureMetadata(
        "test",
        "ns=1;s=Scalar",
        {
          valueRank: -1,
          raw: {
            declaredDataType: coerceNodeId(ScanSettings.dataTypeId),
            builtInDataType: DataType.ExtensionObject,
          },
        },
        ScanSettings,
      ),
    ).toBeUndefined();
  });
});
