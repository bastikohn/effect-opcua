import { DataType, NodeId, type DataValue, type Variant } from "node-opcua";

import type { NodeIdString } from "./internal/common/node-id.js";
import {
  dynamic,
  type AnySchema,
  type CodecType,
  type OpcuaCodec,
} from "./internal/values/codec.js";
import {
  type OpcuaDynamicValue,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
  type OpcuaVariantInfo,
} from "./internal/values/normalize.js";

export type { AnySchema, CodecType, OpcuaCodec };
export type {
  NodeIdString,
  ExpandedNodeIdString,
} from "./internal/common/node-id.js";
export type { OpcuaDynamicValue } from "./internal/values/normalize.js";

export type VariableAccess = "read" | "write" | "readWrite";

export type VariableDef<
  Id extends string = string,
  A = OpcuaDynamicValue,
  Access extends VariableAccess = "read",
> = {
  readonly _tag: "VariableDef";
  readonly nodeId: Id;
  readonly codec: OpcuaCodec<A>;
  readonly access: Access;
  readonly includeRaw?: boolean;
};

export type AnyVariableDef = VariableDef<string, unknown, VariableAccess>;
export type ReadableVariableDef =
  | VariableDef<string, unknown, "read">
  | VariableDef<string, unknown, "readWrite">;
export type WritableVariableDef =
  | VariableDef<string, unknown, "write">
  | VariableDef<string, unknown, "readWrite">;

export type ValueOfVariableDef<Def> =
  Def extends VariableDef<string, infer A, VariableAccess> ? A : never;

export type AccessOfVariableDef<Def> =
  Def extends VariableDef<string, unknown, infer Access> ? Access : never;

export type NodeIdOfVariableDef<Def> =
  Def extends VariableDef<infer Id, unknown, VariableAccess> ? Id : never;

export type ReadResult<A, Id extends string = string> =
  | {
      readonly _tag: "Value";
      readonly nodeId: Id;
      readonly value: A;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    }
  | {
      readonly _tag: "DecodeError";
      readonly nodeId: Id;
      readonly error: unknown;
      readonly status: OpcuaStatusInfo;
      readonly sourceTimestamp?: string;
      readonly serverTimestamp?: string;
      readonly variant?: OpcuaVariantInfo;
      readonly unsafeRaw?: {
        readonly dataValue: DataValue;
        readonly variant?: Variant;
      };
    };

export type AnyReadResult =
  | ReadResult<unknown, string>
  | ReadResult<OpcuaDynamicValue, string>;

export type ReadManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends VariableDef<
    infer Id,
    infer A,
    "read" | "readWrite"
  >
    ? ReadResult<A, Id>
    : never;
};

export type WriteResult<Id extends string = string> =
  | {
      readonly _tag: "Written";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: Id;
      readonly status: OpcuaStatusInfo;
    };

export type WriteManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends WritableVariableDef,
    unknown,
  ]
    ? Def extends VariableDef<infer Id, unknown, VariableAccess>
      ? WriteResult<Id>
      : never
    : never;
};

export type WriteManyItem<
  Def extends WritableVariableDef = WritableVariableDef,
> = readonly [def: Def, value: ValueOfVariableDef<Def>];

export type AnyWriteManyRecord = Record<
  string,
  readonly [WritableVariableDef, unknown]
>;

export type WriteManyInput<Items extends AnyWriteManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends WritableVariableDef,
    unknown,
  ]
    ? readonly [def: Def, value: ValueOfVariableDef<Def>]
    : never;
};

export type VariableMetadata = {
  readonly nodeId: NodeIdString;
  readonly declaredDataType: OpcuaNodeIdInfo;
  readonly builtInDataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly accessLevel: number;
  readonly userAccessLevel?: number;
  readonly access: {
    readonly readable: boolean;
    readonly writable: boolean;
    readonly userReadable: boolean;
    readonly userWritable: boolean;
  };
  readonly unsafeRaw: {
    readonly declaredDataType: NodeId;
    readonly builtInDataType: DataType;
  };
};

export const makeVariableDef = <
  const Id extends string,
  C extends OpcuaCodec<unknown> = OpcuaCodec<OpcuaDynamicValue>,
  const Access extends VariableAccess = "read",
>(options: {
  readonly nodeId: Id;
  readonly codec?: C;
  readonly access?: Access;
  readonly includeRaw?: boolean;
}): VariableDef<Id, CodecType<C>, Access> => ({
  _tag: "VariableDef",
  nodeId: options.nodeId,
  codec: (options.codec ?? dynamic()) as unknown as OpcuaCodec<CodecType<C>>,
  access: (options.access ?? "read") as Access,
  includeRaw: options.includeRaw,
});

export const make = makeVariableDef;
