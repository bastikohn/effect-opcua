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
  BrowseDirection,
  BrowseResult,
  ReferenceDescription,
} from "node-opcua";
import type { OpcuaSessionEvent } from "./internal/events/model.js";
import type {
  NodeIdString,
  OpcuaExpandedNodeIdInfo,
  OpcuaLocalizedTextInfo,
  OpcuaQualifiedNameInfo,
  OpcuaStatusInfo,
} from "./OpcuaVariable.js";
import { make } from "./internal/session/make.js";

export type ServiceLimits = {
  readonly maxNodesPerRequest: number;
  readonly maxConcurrentRequests: number;
};

export type ServiceOptions = {
  readonly service?: Partial<ServiceLimits>;
  readonly serviceLimitsOverrides?: Partial<ServiceLimits>;
};

export type ReadManyOptions = ServiceOptions & {
  readonly validation?: "strict" | "none";
};

export type WriteManyOptions = ServiceOptions;
export type CallManyOptions = ServiceOptions;

export type SessionBatchingOptions = {
  readonly readLimits?: Partial<ServiceLimits>;
  readonly writeLimits?: Partial<ServiceLimits>;
  readonly callLimits?: Partial<ServiceLimits>;
};

export type OpcuaBrowseReference = {
  readonly nodeId: OpcuaExpandedNodeIdInfo;
  readonly referenceTypeId?: NodeIdString;
  readonly isForward?: boolean;
  readonly nodeClass?: string;
  readonly browseName?: OpcuaQualifiedNameInfo;
  readonly displayName?: OpcuaLocalizedTextInfo;
  readonly typeDefinition?: OpcuaExpandedNodeIdInfo;
  readonly unsafeRaw?: ReferenceDescription;
};

export type OpcuaBrowseContinuation = {
  readonly nodeId: NodeIdString;
  readonly unsafeRaw: Buffer;
};

export type OpcuaBrowseResult =
  | {
      readonly _tag: "Browsed";
      readonly nodeId: NodeIdString;
      readonly status: OpcuaStatusInfo;
      readonly references: ReadonlyArray<OpcuaBrowseReference>;
      readonly continuation?: OpcuaBrowseContinuation;
      readonly unsafeRaw?: BrowseResult;
    }
  | {
      readonly _tag: "NonGoodStatus";
      readonly nodeId: NodeIdString;
      readonly status: OpcuaStatusInfo;
      readonly unsafeRaw?: BrowseResult;
    };

export type OpcuaBrowseChildrenResult = OpcuaBrowseResult;

export type OpcuaBrowseOptions = {
  readonly nodeId: NodeIdString;
  readonly referenceTypeId?: NodeIdString;
  readonly browseDirection?: BrowseDirection;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly resultMask?: number;
  readonly maxReferencesPerNode?: number;
  readonly includeRaw?: boolean;
};

export type OpcuaBrowseChildrenOptions = {
  readonly mode?: "all" | "page";
  readonly maxReferencesPerNode?: number;
  readonly referenceTypeId?: string;
  readonly includeSubtypes?: boolean;
  readonly nodeClassMask?: number;
  readonly includeRaw?: boolean;
};

export type OpcuaAccessBits = {
  readonly readable: boolean;
  readonly writable: boolean;
};

export type OpcuaNodeMetadata = {
  readonly nodeId: string;

  readonly nodeClass?: string;
  readonly browseName?: string;
  readonly browseNameNamespaceIndex?: number;

  readonly displayName?: string;
  readonly description?: string;

  readonly dataType?: string;
  readonly valueRank?: number;
  readonly arrayDimensions?: readonly number[];

  readonly accessLevel?: OpcuaAccessBits;
  readonly userAccessLevel?: OpcuaAccessBits;

  readonly namespaceIndex?: number;
  readonly namespaceUri?: string;
};

export type OpcuaMetadataAttribute =
  | "NodeClass"
  | "BrowseName"
  | "DisplayName"
  | "Description"
  | "DataType"
  | "ValueRank"
  | "ArrayDimensions"
  | "AccessLevel"
  | "UserAccessLevel";

export type OpcuaMetadataReadFailure =
  | {
      readonly _tag: "NonGoodStatus";
      readonly attribute: OpcuaMetadataAttribute;
      readonly status: OpcuaStatusInfo;
    }
  | {
      readonly _tag: "InvalidValue";
      readonly attribute: OpcuaMetadataAttribute;
      readonly message: string;
    };

export type OpcuaNodeMetadataResult =
  | {
      readonly _tag: "Success";
      readonly nodeId: string;
      readonly metadata: OpcuaNodeMetadata;
    }
  | {
      readonly _tag: "Failure";
      readonly nodeId: string;
      readonly reason: OpcuaMetadataReadFailure;
    };

export type OpcuaDataTypeDefinitionResult =
  | {
      readonly _tag: "Success";
      readonly dataTypeNodeId: string;
      readonly definition: OpcuaDataTypeDefinition;
    }
  | {
      readonly _tag: "Missing";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "Unsupported";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    }
  | {
      readonly _tag: "Failure";
      readonly dataTypeNodeId: string;
      readonly reason: string;
    };

export type OpcuaDataTypeDefinition =
  | OpcuaStructureDefinition
  | OpcuaEnumDefinition;

export type OpcuaStructureDefinition = {
  readonly _tag: "Structure";
  readonly dataTypeNodeId: string;
  readonly name: string;
  readonly structureType:
    | "Structure"
    | "StructureWithOptionalFields"
    | "Union"
    | "Unknown";
  readonly fields: readonly OpcuaStructureField[];
};

export type OpcuaStructureField = {
  readonly name: string;
  readonly dataTypeNodeId: string;
  readonly valueRank?: number;
  readonly arrayDimensions?: readonly number[];
  readonly isOptional?: boolean;
  readonly description?: string;
};

export type OpcuaEnumDefinition = {
  readonly _tag: "Enum";
  readonly dataTypeNodeId: string;
  readonly name: string;
  readonly fields: readonly OpcuaEnumField[];
};

export type OpcuaEnumField = {
  readonly name: string;
  readonly value: number;
  readonly description?: string;
};

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
