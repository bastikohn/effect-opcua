import {
  DataType,
  type Argument,
  type CallMethodRequestLike,
  type CallMethodResult,
  type NodeId,
} from "node-opcua";

import type { NodeIdString } from "./internal/common/node-id.js";
import {
  dynamic,
  type CodecType,
  type OpcuaCodec,
} from "./internal/values/codec.js";
import {
  type OpcuaDynamicValue,
  type OpcuaLocalizedTextInfo,
  type OpcuaNodeIdInfo,
  type OpcuaStatusInfo,
} from "./internal/values/normalize.js";
import type { MethodCallOptions } from "./internal/session-operations.js";

export type { MethodCallOptions };

export type MethodArgSelector =
  | { readonly _tag: "Name"; readonly name: string }
  | { readonly _tag: "Index"; readonly index: number };

export type MethodArg<A> = {
  readonly _tag: "MethodArg";
  readonly codec: OpcuaCodec<unknown>;
  readonly selector?: MethodArgSelector;
  readonly _A?: A;
};

export type MethodArgRecord = Readonly<Record<string, MethodArg<unknown>>>;

export type MethodDef<
  ObjectId extends string = string,
  MethodId extends string = string,
  Input extends MethodArgRecord | undefined = MethodArgRecord | undefined,
  Output extends MethodArgRecord | undefined = MethodArgRecord | undefined,
> = {
  readonly _tag: "MethodDef";
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly input?: Input;
  readonly output?: Output;
  readonly includeRaw?: boolean;
};

export type AnyMethodDef = MethodDef<
  string,
  string,
  MethodArgRecord | undefined,
  MethodArgRecord | undefined
>;

export type ArgType<Arg> = Arg extends MethodArg<infer A> ? A : never;

export type InputOfMethodDef<Spec> = Spec extends {
  readonly input?: infer Input;
}
  ? Input extends MethodArgRecord
    ? { readonly [Key in keyof Input]: ArgType<Input[Key]> }
    : Record<never, never>
  : Record<never, never>;

export type OutputOfMethodDef<Spec> = Spec extends {
  readonly output?: infer Output;
}
  ? Output extends MethodArgRecord
    ? { readonly [Key in keyof Output]: ArgType<Output[Key]> }
    : Record<never, never>
  : Record<never, never>;

export type MethodMetadata = {
  readonly objectId: NodeIdString;
  readonly methodId: NodeIdString;
  readonly executable: boolean;
  readonly userExecutable?: boolean;
  readonly inputArguments: ReadonlyArray<MethodArgumentMetadata>;
  readonly outputArguments: ReadonlyArray<MethodArgumentMetadata>;
  readonly inputMapping: ReadonlyArray<MethodArgumentMapping>;
  readonly outputMapping: ReadonlyArray<MethodArgumentMapping>;
};

export type MethodArgumentMapping = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
  readonly arg: MethodArg<unknown>;
};

export type MethodArgumentMetadata = {
  readonly name: string;
  readonly description?: OpcuaLocalizedTextInfo;
  readonly declaredDataType: OpcuaNodeIdInfo;
  readonly builtInDataType: string;
  readonly valueRank: number;
  readonly arrayDimensions?: ReadonlyArray<number>;
  readonly unsafeRaw: {
    readonly argument: Argument;
    readonly declaredDataType: NodeId;
    readonly builtInDataType: DataType;
  };
};

export type MethodCallRaw = {
  readonly request: CallMethodRequestLike;
  readonly result: CallMethodResult;
};

export type MethodArgumentResult = {
  readonly key: string;
  readonly index: number;
  readonly argumentName: string;
  readonly status: OpcuaStatusInfo;
  readonly diagnosticInfo?: unknown;
};

export type MethodCallResult<
  Output,
  ObjectId extends string,
  MethodId extends string,
> =
  | {
      readonly _tag: "Called";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly output: Output;
      readonly status: OpcuaStatusInfo;
      readonly inputArgumentResults?: ReadonlyArray<MethodArgumentResult>;
      readonly unsafeRaw?: MethodCallRaw;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly inputArgumentResults?: ReadonlyArray<MethodArgumentResult>;
      readonly unsafeRaw?: MethodCallRaw;
    }
  | {
      readonly _tag: "DecodeError";
      readonly objectId: ObjectId;
      readonly methodId: MethodId;
      readonly status: OpcuaStatusInfo;
      readonly error: unknown;
      readonly unsafeRaw?: MethodCallRaw;
    };

export type ResolvedMethod<Spec extends AnyMethodDef = AnyMethodDef> = {
  readonly _tag: "ResolvedMethod";
  readonly objectId: Spec["objectId"];
  readonly methodId: Spec["methodId"];
  readonly def: Spec;
  readonly metadata: MethodMetadata;
  readonly unsafeRaw: {
    readonly objectId: NodeId;
    readonly methodId: NodeId;
    readonly inputArguments: ReadonlyArray<Argument>;
    readonly outputArguments: ReadonlyArray<Argument>;
  };
};

export type CallManyItem<Def extends AnyMethodDef = AnyMethodDef> =
  | readonly [def: Def, input: InputOfMethodDef<Def>]
  | readonly [
      def: Def,
      input: InputOfMethodDef<Def>,
      options: MethodCallOptions,
    ];

export type AnyCallManyRecord = Record<
  string,
  | readonly [AnyMethodDef, unknown]
  | readonly [AnyMethodDef, unknown, MethodCallOptions]
>;

export type CallManyInput<Items extends AnyCallManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    MethodCallOptions,
  ]
    ? readonly [
        def: Def,
        input: InputOfMethodDef<Def>,
        options: MethodCallOptions,
      ]
    : Items[Key] extends readonly [infer Def extends AnyMethodDef, unknown]
      ? readonly [def: Def, input: InputOfMethodDef<Def>]
      : never;
};

export type CallManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends AnyMethodDef,
    unknown,
    ...ReadonlyArray<unknown>,
  ]
    ? MethodCallResult<OutputOfMethodDef<Def>, Def["objectId"], Def["methodId"]>
    : never;
};

export type AnyResolvedMethod = ResolvedMethod<AnyMethodDef>;

export type MethodCallEntry<M extends AnyResolvedMethod> = {
  readonly method: M;
  readonly input: InputOfResolvedMethod<M>;
  readonly options?: MethodCallOptions;
};

export type InputOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? InputOfMethodDef<Spec> : never;

export type OutputOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? OutputOfMethodDef<Spec> : never;

export type ObjectIdOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? Spec["objectId"] : never;

export type MethodIdOfResolvedMethod<M> =
  M extends ResolvedMethod<infer Spec> ? Spec["methodId"] : never;

export const makeMethodArg = <
  C extends OpcuaCodec<unknown> = OpcuaCodec<OpcuaDynamicValue>,
>(
  options: {
    readonly codec?: C;
    readonly name?: string;
    readonly index?: number;
  } = {},
): MethodArg<CodecType<C>> => {
  if (options.name !== undefined && options.index !== undefined) {
    throw new TypeError("name and index are mutually exclusive");
  }
  return {
    _tag: "MethodArg",
    codec: (options.codec ?? dynamic()) as unknown as OpcuaCodec<unknown>,
    selector:
      options.name !== undefined
        ? { _tag: "Name", name: options.name }
        : options.index !== undefined
          ? { _tag: "Index", index: options.index }
          : undefined,
  };
};

export const arg = makeMethodArg;

export const makeMethodDef = <
  const ObjectId extends string,
  const MethodId extends string,
  const Input extends MethodArgRecord | undefined = undefined,
  const Output extends MethodArgRecord | undefined = undefined,
>(options: {
  readonly objectId: ObjectId;
  readonly methodId: MethodId;
  readonly input?: Input;
  readonly output?: Output;
  readonly includeRaw?: boolean;
}): MethodDef<ObjectId, MethodId, Input, Output> => ({
  _tag: "MethodDef",
  objectId: options.objectId,
  methodId: options.methodId,
  input: options.input,
  output: options.output,
  includeRaw: options.includeRaw,
});

export const make = makeMethodDef;
