import type { ClientSession, UserIdentityInfo } from "node-opcua";
import {
  Context,
  Layer,
  type Duration,
  type Effect,
  type Scope,
  type Stream,
} from "effect";

import {
  OpcuaVariable,
  OpcuaMethod,
  OpcuaSubscription,
  OpcuaError,
} from "@effect-opcua/client";

import type {
  OpcuaBrowseChildrenOptions,
  OpcuaBrowseChildrenResult,
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaBrowseResult,
} from "./internal/browse.js";
import type { OpcuaSessionEvent } from "./internal/events.js";
import type {
  OpcuaAccessBits,
  OpcuaMetadataReadFailure,
  OpcuaNodeMetadata,
  OpcuaNodeMetadataResult,
} from "./internal/metadata.js";
import type { NodeIdString } from "./internal/capabilities.js";
import type {
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaEnumDefinition,
  OpcuaEnumField,
  OpcuaStructureDefinition,
  OpcuaStructureField,
} from "./internal/data-type-definition.js";
import { make } from "./internal/opcua-session.js";

export type {
  OpcuaBrowseChildrenOptions,
  OpcuaBrowseChildrenResult,
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaBrowseReference,
  OpcuaBrowseResult,
} from "./internal/browse.js";
export type {
  OpcuaAccessBits,
  OpcuaMetadataReadFailure,
  OpcuaNodeMetadata,
  OpcuaNodeMetadataResult,
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaEnumDefinition,
  OpcuaEnumField,
  OpcuaStructureDefinition,
  OpcuaStructureField,
};

export type ReadManyServiceOptions = {
  readonly maxNodesPerRead?: number;
  readonly maxConcurrentRequests?: number;
};

export type WriteManyServiceOptions = {
  readonly maxNodesPerWrite?: number;
  readonly maxConcurrentRequests?: number;
};

export type CallManyServiceOptions = {
  readonly maxMethodsPerCall?: number;
  readonly maxConcurrentRequests?: number;
};

export type OpcuaSessionBatchingOptions = {
  readonly read?: ReadManyServiceOptions;
  readonly write?: WriteManyServiceOptions;
  readonly call?: CallManyServiceOptions;
};

export type Options = {
  readonly userIdentity?: UserIdentityInfo;
  readonly batching?: OpcuaSessionBatchingOptions;
};

export type OpcuaSubscriptionOptions = {
  readonly publishingInterval: Duration.Duration;
  readonly lifetimeCount?: number;
  readonly maxKeepAliveCount?: number;
  readonly maxNotificationsPerPublish?: number;
  readonly publishingEnabled?: boolean;
  readonly priority?: number;
};

export type ReadManyOptions = {
  readonly validation?: "strict" | "none";
  readonly service?: ReadManyServiceOptions;
};

export type WriteManyOptions = {
  readonly service?: WriteManyServiceOptions;
};

export type CallManyOptions = {
  readonly service?: CallManyServiceOptions;
};

export type ReadManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends OpcuaVariable.VariableDef<
    infer Id,
    infer A,
    "read" | "readWrite"
  >
    ? OpcuaVariable.ReadResult<A, Id>
    : never;
};

export type WriteManyItem<
  Def extends OpcuaVariable.WritableVariableDef =
    OpcuaVariable.WritableVariableDef,
> = readonly [def: Def, value: OpcuaVariable.ValueOfVariableDef<Def>];

type AnyWriteManyRecord = Record<
  string,
  readonly [OpcuaVariable.WritableVariableDef, unknown]
>;

export type WriteManyInput<Items extends AnyWriteManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends OpcuaVariable.WritableVariableDef,
    unknown,
  ]
    ? readonly [def: Def, value: OpcuaVariable.ValueOfVariableDef<Def>]
    : never;
};

export type WriteManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends OpcuaVariable.WritableVariableDef,
    unknown,
  ]
    ? Def extends OpcuaVariable.VariableDef<
        infer Id,
        unknown,
        OpcuaVariable.VariableAccess
      >
      ? OpcuaVariable.WriteResult<Id>
      : never
    : never;
};

export type CallManyItem<
  Def extends OpcuaMethod.AnyMethodDef = OpcuaMethod.AnyMethodDef,
> =
  | readonly [def: Def, input: OpcuaMethod.InputOfMethodDef<Def>]
  | readonly [
      def: Def,
      input: OpcuaMethod.InputOfMethodDef<Def>,
      options: OpcuaMethod.MethodCallOptions,
    ];

type AnyCallManyRecord = Record<
  string,
  | readonly [OpcuaMethod.AnyMethodDef, unknown]
  | readonly [OpcuaMethod.AnyMethodDef, unknown, OpcuaMethod.MethodCallOptions]
>;

export type CallManyInput<Items extends AnyCallManyRecord> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends OpcuaMethod.AnyMethodDef,
    unknown,
    OpcuaMethod.MethodCallOptions,
  ]
    ? readonly [
        def: Def,
        input: OpcuaMethod.InputOfMethodDef<Def>,
        options: OpcuaMethod.MethodCallOptions,
      ]
    : Items[Key] extends readonly [
          infer Def extends OpcuaMethod.AnyMethodDef,
          unknown,
        ]
      ? readonly [def: Def, input: OpcuaMethod.InputOfMethodDef<Def>]
      : never;
};

export type CallManyResult<Items> = {
  readonly [Key in keyof Items]: Items[Key] extends readonly [
    infer Def extends OpcuaMethod.AnyMethodDef,
    unknown,
    ...ReadonlyArray<unknown>,
  ]
    ? OpcuaMethod.MethodCallResult<
        OpcuaMethod.OutputOfMethodDef<Def>,
        Def["objectId"],
        Def["methodId"]
      >
    : never;
};

export type Service = {
  readonly read: <const Def extends OpcuaVariable.ReadableVariableDef>(
    def: Def,
  ) => Effect.Effect<
    OpcuaVariable.ReadResult<
      OpcuaVariable.ValueOfVariableDef<Def>,
      OpcuaVariable.NodeIdOfVariableDef<Def>
    >,
    OpcuaError.OpcuaError
  >;
  readonly write: <const Def extends OpcuaVariable.WritableVariableDef>(
    def: Def,
    value: OpcuaVariable.ValueOfVariableDef<Def>,
  ) => Effect.Effect<
    OpcuaVariable.WriteResult<OpcuaVariable.NodeIdOfVariableDef<Def>>,
    OpcuaError.OpcuaError
  >;
  readonly call: <const Spec extends OpcuaMethod.AnyMethodDef>(
    def: Spec,
    input: OpcuaMethod.InputOfMethodDef<Spec>,
    options?: OpcuaMethod.MethodCallOptions,
  ) => Effect.Effect<
    OpcuaMethod.MethodCallResult<
      OpcuaMethod.OutputOfMethodDef<Spec>,
      Spec["objectId"],
      Spec["methodId"]
    >,
    OpcuaError.OpcuaError
  >;
  readonly readMany: <
    const Items extends Record<string, OpcuaVariable.ReadableVariableDef>,
  >(
    items: Items,
    options?: ReadManyOptions,
  ) => Effect.Effect<ReadManyResult<Items>, OpcuaError.OpcuaError>;
  readonly writeMany: <const Items extends AnyWriteManyRecord>(
    items: Items & WriteManyInput<Items>,
    options?: WriteManyOptions,
  ) => Effect.Effect<WriteManyResult<Items>, OpcuaError.OpcuaError>;
  readonly callMany: <const Items extends AnyCallManyRecord>(
    items: Items & CallManyInput<Items>,
    options?: CallManyOptions,
  ) => Effect.Effect<CallManyResult<Items>, OpcuaError.OpcuaError>;
  readonly browse: (
    input: OpcuaBrowseOptions,
  ) => Effect.Effect<OpcuaBrowseResult, OpcuaError.OpcuaError>;
  readonly browseNext: (
    continuation: OpcuaBrowseContinuation & { readonly includeRaw?: boolean },
  ) => Effect.Effect<OpcuaBrowseResult, OpcuaError.OpcuaError>;
  readonly releaseBrowseContinuation: (
    continuation: OpcuaBrowseContinuation,
  ) => Effect.Effect<void, OpcuaError.OpcuaError>;
  readonly browseChildren: (
    nodeId: NodeIdString,
    options?: OpcuaBrowseChildrenOptions,
  ) => Effect.Effect<OpcuaBrowseChildrenResult, OpcuaError.OpcuaError>;
  readonly readNamespaceArray: () => Effect.Effect<
    readonly string[],
    OpcuaError.OpcuaError
  >;
  readonly readNodeMetadata: (
    nodeId: string,
  ) => Effect.Effect<OpcuaNodeMetadata, OpcuaError.OpcuaError>;
  readonly readManyNodeMetadata: (
    nodeIds: readonly string[],
  ) => Effect.Effect<readonly OpcuaNodeMetadataResult[], OpcuaError.OpcuaError>;
  readonly readDataTypeDefinition: (
    dataTypeNodeId: string,
  ) => Effect.Effect<OpcuaDataTypeDefinitionResult, OpcuaError.OpcuaError>;
  readonly readManyDataTypeDefinitions: (
    dataTypeNodeIds: readonly string[],
  ) => Effect.Effect<
    readonly OpcuaDataTypeDefinitionResult[],
    OpcuaError.OpcuaError
  >;
  readonly makeSubscription: (
    options: OpcuaSubscriptionOptions,
  ) => Effect.Effect<
    OpcuaSubscription.OpcuaSubscription,
    OpcuaError.OpcuaError,
    Scope.Scope
  >;
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly unsafeRaw: ClientSession;
};

export class OpcuaSession extends Context.Service<OpcuaSession, Service>()(
  "@effect-opcua/client/OpcuaSession",
) {}

export const read = <const Def extends OpcuaVariable.ReadableVariableDef>(
  def: Def,
) => OpcuaSession.use((session) => session.read(def));

export const write = <const Def extends OpcuaVariable.WritableVariableDef>(
  def: Def,
  value: OpcuaVariable.ValueOfVariableDef<Def>,
) => OpcuaSession.use((session) => session.write(def, value));

export const call = <const Spec extends OpcuaMethod.AnyMethodDef>(
  def: Spec,
  input: OpcuaMethod.InputOfMethodDef<Spec>,
  options?: OpcuaMethod.MethodCallOptions,
) => OpcuaSession.use((session) => session.call(def, input, options));

export const readMany = <
  const Items extends Record<string, OpcuaVariable.ReadableVariableDef>,
>(
  items: Items,
  options?: ReadManyOptions,
) => OpcuaSession.use((session) => session.readMany(items, options));

export const writeMany = <const Items extends AnyWriteManyRecord>(
  items: Items & WriteManyInput<Items>,
  options?: WriteManyOptions,
) => OpcuaSession.use((session) => session.writeMany(items, options));

export const callMany = <const Items extends AnyCallManyRecord>(
  items: Items & CallManyInput<Items>,
  options?: CallManyOptions,
) => OpcuaSession.use((session) => session.callMany(items, options));

export const makeSubscription = (
  options: Parameters<Service["makeSubscription"]>[0],
) => OpcuaSession.use((session) => session.makeSubscription(options));

export const browse = (input: OpcuaBrowseOptions) =>
  OpcuaSession.use((session) => session.browse(input));

export const browseNext = (
  continuation: Parameters<Service["browseNext"]>[0],
) => OpcuaSession.use((session) => session.browseNext(continuation));

export const releaseBrowseContinuation = (
  continuation: OpcuaBrowseContinuation,
) =>
  OpcuaSession.use((session) =>
    session.releaseBrowseContinuation(continuation),
  );

export const browseChildren = (
  nodeId: NodeIdString,
  options?: OpcuaBrowseChildrenOptions,
) => OpcuaSession.use((session) => session.browseChildren(nodeId, options));

export const readNamespaceArray = () =>
  OpcuaSession.use((session) => session.readNamespaceArray());

export const readNodeMetadata = (nodeId: string) =>
  OpcuaSession.use((session) => session.readNodeMetadata(nodeId));

export const readManyNodeMetadata = (nodeIds: readonly string[]) =>
  OpcuaSession.use((session) => session.readManyNodeMetadata(nodeIds));

export const readDataTypeDefinition = (dataTypeNodeId: string) =>
  OpcuaSession.use((session) => session.readDataTypeDefinition(dataTypeNodeId));

export const readManyDataTypeDefinitions = (
  dataTypeNodeIds: readonly string[],
) =>
  OpcuaSession.use((session) =>
    session.readManyDataTypeDefinitions(dataTypeNodeIds),
  );

export const layer = (options?: Options) =>
  Layer.effect(OpcuaSession, make(options));
