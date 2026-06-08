import { Schema } from "effect";

import type { NodeIdString } from "./common/node-id.js";

export type StructureDef<A> = {
  readonly _tag: "Structure";
  readonly name: string;
  readonly dataTypeId: NodeIdString;
  readonly schema: Schema.Codec<unknown, A, never, never>;
};

export type StructureArrayDef<A> = {
  readonly _tag: "StructureArray";
  readonly item: StructureDef<A>;
};

export type AnyStructureDef =
  | StructureDef<unknown>
  | StructureArrayDef<unknown>;

export const isStructureDef = (
  value: unknown,
): value is StructureDef<unknown> =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { readonly _tag?: string })._tag === "Structure",
  );

export const isStructureArrayDef = (
  value: unknown,
): value is StructureArrayDef<unknown> =>
  Boolean(
    value &&
    typeof value === "object" &&
    (value as { readonly _tag?: string })._tag === "StructureArray",
  );
