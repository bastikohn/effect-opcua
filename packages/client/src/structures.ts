import { Schema } from "effect";

import type { NodeIdString } from "./capabilities.js";

export type OpcuaStructureCodec<A> = {
  readonly _tag: "OpcuaStructureCodec";
  readonly name: string;
  readonly dataTypeId: NodeIdString;
  readonly binaryEncodingId?: NodeIdString;
  readonly schema: Schema.Codec<unknown, A, never, never>;
};

export type OpcuaStructureArrayCodec<A> = {
  readonly _tag: "OpcuaStructureArrayCodec";
  readonly item: OpcuaStructureCodec<A>;
};

export const OpcuaStructure = {
  make: <A>(options: {
    readonly name: string;
    readonly dataTypeId: NodeIdString;
    readonly binaryEncodingId?: NodeIdString;
    readonly schema: Schema.Codec<unknown, A, never, never>;
  }): OpcuaStructureCodec<A> => ({
    _tag: "OpcuaStructureCodec",
    ...options,
  }),

  array: <A>(item: OpcuaStructureCodec<A>): OpcuaStructureArrayCodec<A> => ({
    _tag: "OpcuaStructureArrayCodec",
    item,
  }),
};

export const isOpcuaStructureCodec = (
  value: unknown,
): value is OpcuaStructureCodec<unknown> =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { readonly _tag?: string })._tag === "OpcuaStructureCodec",
  );

export const isOpcuaStructureArrayCodec = (
  value: unknown,
): value is OpcuaStructureArrayCodec<unknown> =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { readonly _tag?: string })._tag === "OpcuaStructureArrayCodec",
  );

export type AnyStructureSpec =
  | OpcuaStructureCodec<unknown>
  | OpcuaStructureArrayCodec<unknown>;
