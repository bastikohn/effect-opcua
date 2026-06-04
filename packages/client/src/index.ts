import {
  OpcuaClient as OpcuaClientService,
  layer as clientLayer,
  layerConfig as clientLayerConfig,
} from "./OpcuaClient.js";
import type { OpcuaClient as OpcuaClientServiceType } from "./OpcuaClient.js";
import {
  OpcuaSession as OpcuaSessionService,
  browse,
  browseChildren,
  browseNext,
  call,
  callMany,
  layer as sessionLayer,
  makeSubscription,
  read,
  readDataTypeDefinition,
  readMany,
  readManyDataTypeDefinitions,
  readManyNodeMetadata,
  readNamespaceArray,
  readNodeMetadata,
  releaseBrowseContinuation,
  write,
  writeMany,
} from "./OpcuaSession.js";
import type { OpcuaSession as OpcuaSessionServiceType } from "./OpcuaSession.js";

export * as Opcua from "./Opcua.js";

export const OpcuaClient = Object.assign(OpcuaClientService, {
  OpcuaClient: OpcuaClientService,
  layer: clientLayer,
  layerConfig: clientLayerConfig,
});

export const OpcuaSession = Object.assign(OpcuaSessionService, {
  OpcuaSession: OpcuaSessionService,
  layer: sessionLayer,
  read,
  write,
  call,
  readMany,
  writeMany,
  callMany,
  browse,
  makeSubscription,
  readNamespaceArray,
  readNodeMetadata,
  readManyNodeMetadata,
  readDataTypeDefinition,
  readManyDataTypeDefinitions,
  browseChildren,
  browseNext,
  releaseBrowseContinuation,
});

export * as OpcuaError from "./OpcuaError.js";

export type OpcuaClient = OpcuaClientServiceType;

export type OpcuaSession = OpcuaSessionServiceType;

export {
  BufferPolicy,
  MonitorDeadband,
  MonitorFilter,
} from "./OpcuaSubscription.js";

export type {
  OpcuaClientLayerConfig,
  OpcuaClientLayerOptions,
} from "./OpcuaClient.js";
export type {
  ActiveMonitor,
  AnyVariableDefinition,
  BufferPolicy as BufferPolicyType,
  EffectiveMonitorItemOptions,
  MonitorCreateOptions,
  MonitorDeadband as MonitorDeadbandType,
  MonitorFilter as MonitorFilterType,
  MonitorItemDictionary,
  MonitorItemOverride,
  MonitorOptions,
  MonitorSample,
  MonitorStartup,
  MonitorStartupFailure,
  MonitorStartupReport,
  MonitorStarted,
  MonitorTimestamps,
  MonitorValidation,
  OpcuaSubscription,
  RevisedMonitorItemOptions,
} from "./OpcuaSubscription.js";
export type {
  CallManyItem,
  CallManyServiceOptions,
  CallManyOptions,
  CallManyInput,
  CallManyResult,
  OpcuaBrowseChildrenOptions,
  OpcuaBrowseChildrenResult,
  OpcuaBrowseContinuation,
  OpcuaBrowseOptions,
  OpcuaAccessBits,
  OpcuaBrowseReference,
  OpcuaBrowseResult,
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaEnumDefinition,
  OpcuaEnumField,
  OpcuaMetadataReadFailure,
  OpcuaNodeMetadata,
  OpcuaNodeMetadataResult,
  OpcuaSessionBatchingOptions,
  OpcuaSessionOptions,
  OpcuaSubscriptionOptions,
  OpcuaStructureDefinition,
  OpcuaStructureField,
  ReadManyOptions,
  ReadManyResult,
  ReadManyServiceOptions,
  WriteManyItem,
  WriteManyInput,
  WriteManyOptions,
  WriteManyResult,
  WriteManyServiceOptions,
} from "./OpcuaSession.js";
export type {
  AnyReadResult,
  AnyVariableDef,
  NodeIdOfVariableDef,
  NodeIdString,
  OpcuaDynamicValue,
  ReadResult,
  ReadableVariableDef,
  ValueOfVariableDef,
  VariableAccess,
  VariableDef,
  WritableVariableDef,
  WriteResult,
} from "./OpcuaVariable.js";
