import type { ClientSession, UserIdentityInfo } from "node-opcua";
import {
  Context,
  Layer,
  type Duration,
  type Effect,
  type Scope,
  type Stream,
} from "effect";

import type * as OpcuaError from "./OpcuaError.js";
import type * as OpcuaMethod from "./OpcuaMethod.js";
import type * as OpcuaSubscription from "./OpcuaSubscription.js";
import type * as OpcuaVariable from "./OpcuaVariable.js";

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
import type { NodeIdString } from "./internal/common/node-id.js";
import type {
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaEnumDefinition,
  OpcuaEnumField,
  OpcuaStructureDefinition,
  OpcuaStructureField,
} from "./internal/data-type-definition.js";
import { make } from "./internal/opcua-session.js";
import type {
  CallManyOptions,
  ReadManyOptions,
  SessionBatchingOptions,
  WriteManyOptions,
} from "./internal/batch/operations.js";

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

export type { SessionBatchingOptions };

interface VariableService {
  readonly read: <const Def extends OpcuaVariable.ReadableVariableDef>(
    def: Def,
  ) => Effect.Effect<
    OpcuaVariable.ReadResult<
      OpcuaVariable.ValueOfVariableDef<Def>,
      OpcuaVariable.NodeIdOfVariableDef<Def>
    >,
    OpcuaError.OpcuaError
  >;
  readonly readMany: <
    const Items extends Record<string, OpcuaVariable.ReadableVariableDef>,
  >(
    items: Items,
    options?: ReadManyOptions,
  ) => Effect.Effect<
    OpcuaVariable.ReadManyResult<Items>,
    OpcuaError.OpcuaError
  >;
  readonly write: <const Def extends OpcuaVariable.WritableVariableDef>(
    def: Def,
    value: OpcuaVariable.ValueOfVariableDef<Def>,
  ) => Effect.Effect<
    OpcuaVariable.WriteResult<OpcuaVariable.NodeIdOfVariableDef<Def>>,
    OpcuaError.OpcuaError
  >;
  readonly writeMany: <const Items extends OpcuaVariable.AnyWriteManyRecord>(
    items: Items & OpcuaVariable.WriteManyInput<Items>,
    options?: WriteManyOptions,
  ) => Effect.Effect<
    OpcuaVariable.WriteManyResult<Items>,
    OpcuaError.OpcuaError
  >;
}

export type SubscriptionOptions = {
  readonly publishingInterval: Duration.Duration;
  readonly lifetimeCount?: number;
  readonly maxKeepAliveCount?: number;
  readonly maxNotificationsPerPublish?: number;
  readonly publishingEnabled?: boolean;
  readonly priority?: number;
};

interface SubscriptionService {
  readonly makeSubscription: (
    options: SubscriptionOptions,
  ) => Effect.Effect<
    OpcuaSubscription.OpcuaSubscription,
    OpcuaError.OpcuaError,
    Scope.Scope
  >;
}

interface MethodService {
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
  readonly callMany: <const Items extends OpcuaMethod.AnyCallManyRecord>(
    items: Items & OpcuaMethod.CallManyInput<Items>,
    options?: CallManyOptions,
  ) => Effect.Effect<OpcuaMethod.CallManyResult<Items>, OpcuaError.OpcuaError>;
}

interface BrowseService {
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
}

interface MetadataService {
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
}

export interface SessionService
  extends
    VariableService,
    SubscriptionService,
    MethodService,
    BrowseService,
    MetadataService {
  readonly events: Stream.Stream<OpcuaSessionEvent>;
  readonly unsafeRaw: ClientSession;
}

export class Session extends Context.Service<Session, SessionService>()(
  "@effect-opcua/client/OpcuaSession",
) {}

export type Service = SessionService;
export type ReadManyResult<Items> = OpcuaVariable.ReadManyResult<Items>;
export { Session as OpcuaSession };

export const read = <const Def extends OpcuaVariable.ReadableVariableDef>(
  def: Def,
) => Session.use((session) => session.read(def));

export const readMany = <
  const Items extends Record<string, OpcuaVariable.ReadableVariableDef>,
>(
  items: Items,
  options?: ReadManyOptions,
) => Session.use((session) => session.readMany(items, options));

export const write = <const Def extends OpcuaVariable.WritableVariableDef>(
  def: Def,
  value: OpcuaVariable.ValueOfVariableDef<Def>,
) => Session.use((session) => session.write(def, value));

export const writeMany = <const Items extends OpcuaVariable.AnyWriteManyRecord>(
  items: Items & OpcuaVariable.WriteManyInput<Items>,
  options?: WriteManyOptions,
) => Session.use((session) => session.writeMany(items, options));

export const makeSubscription = (
  options: Parameters<SessionService["makeSubscription"]>[0],
) => Session.use((session) => session.makeSubscription(options));

export const callMany = <const Items extends OpcuaMethod.AnyCallManyRecord>(
  items: Items & OpcuaMethod.CallManyInput<Items>,
  options?: CallManyOptions,
) => Session.use((session) => session.callMany(items, options));

export const call = <const Spec extends OpcuaMethod.AnyMethodDef>(
  def: Spec,
  input: OpcuaMethod.InputOfMethodDef<Spec>,
  options?: OpcuaMethod.MethodCallOptions,
) => Session.use((session) => session.call(def, input, options));

export const browse = (input: OpcuaBrowseOptions) =>
  Session.use((session) => session.browse(input));

export const browseNext = (
  continuation: Parameters<SessionService["browseNext"]>[0],
) => Session.use((session) => session.browseNext(continuation));

export const releaseBrowseContinuation = (
  continuation: OpcuaBrowseContinuation,
) => Session.use((session) => session.releaseBrowseContinuation(continuation));

export const browseChildren = (
  nodeId: NodeIdString,
  options?: OpcuaBrowseChildrenOptions,
) => Session.use((session) => session.browseChildren(nodeId, options));

export const readNamespaceArray = () =>
  Session.use((session) => session.readNamespaceArray());

export const readNodeMetadata = (nodeId: string) =>
  Session.use((session) => session.readNodeMetadata(nodeId));

export const readManyNodeMetadata = (nodeIds: readonly string[]) =>
  Session.use((session) => session.readManyNodeMetadata(nodeIds));

export const readDataTypeDefinition = (dataTypeNodeId: string) =>
  Session.use((session) => session.readDataTypeDefinition(dataTypeNodeId));

export const readManyDataTypeDefinitions = (
  dataTypeNodeIds: readonly string[],
) =>
  Session.use((session) =>
    session.readManyDataTypeDefinitions(dataTypeNodeIds),
  );

export type SessionOptions = {
  readonly userIdentity?: UserIdentityInfo;
  readonly batching?: SessionBatchingOptions;
};

export const layer = (options?: SessionOptions) =>
  Layer.effect(Session, make(options));
