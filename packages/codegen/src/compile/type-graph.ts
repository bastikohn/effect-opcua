import type { OpcuaSession } from "@effect-opcua/client";

import { issue } from "../diagnostics.js";
import type { CodegenIssue } from "../types.js";
import type {
  EnumDefinition,
  NormalizedCodegenConfig,
  StructureDefinition,
} from "../internal/types.js";
import { requiresDataTypeDefinition } from "./builtin-types.js";
import { compileEnums } from "./enums.js";
import type { SurfaceNode } from "./names.js";
import { typeFallbackSeverity } from "./policy.js";
import { compileStructures } from "./structures.js";

type OpcuaDataTypeDefinition = OpcuaSession.OpcuaDataTypeDefinition;
type OpcuaDataTypeDefinitionResult = OpcuaSession.OpcuaDataTypeDefinitionResult;

export type TypeGraph = {
  readonly enums: ReadonlyMap<string, EnumDefinition>;
  readonly structures: ReadonlyMap<string, StructureDefinition>;
  readonly invalidEnums: ReadonlySet<string>;
  readonly invalidStructures: ReadonlySet<string>;
  readonly issues: readonly CodegenIssue[];
};

export const compileReachableTypes = (
  config: NormalizedCodegenConfig,
  variableNodes: readonly SurfaceNode[],
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
): TypeGraph => {
  const issues: CodegenIssue[] = [];
  const rawDefinitions = reachableDefinitions(
    config,
    variableNodes,
    dataTypeResults,
    issues,
  );
  const enumGraph = compileEnums(rawDefinitions);
  const structureGraph = compileStructures(
    config,
    rawDefinitions,
    enumGraph.enums,
    enumGraph.invalidEnums,
  );
  return {
    enums: enumGraph.enums,
    structures: structureGraph.structures,
    invalidEnums: enumGraph.invalidEnums,
    invalidStructures: structureGraph.invalidStructures,
    issues: [...issues, ...enumGraph.issues, ...structureGraph.issues],
  };
};

export const dataTypeResultMap = (
  results: readonly OpcuaDataTypeDefinitionResult[],
) => new Map(results.map((result) => [result.dataTypeNodeId, result]));

const reachableDefinitions = (
  config: NormalizedCodegenConfig,
  variableNodes: readonly SurfaceNode[],
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
  issues: CodegenIssue[],
): ReadonlyMap<string, OpcuaDataTypeDefinition> => {
  const unsupportedSeverity = typeFallbackSeverity(config);
  const queue = variableNodes
    .flatMap((item) =>
      item.node.dataTypeNodeId !== undefined ? [item.node.dataTypeNodeId] : [],
    )
    .filter(requiresDataTypeDefinition);
  const seen = new Set<string>();
  const definitions = new Map<string, OpcuaDataTypeDefinition>();

  while (queue.length > 0) {
    const dataTypeNodeId = queue.shift()!;
    if (seen.has(dataTypeNodeId)) continue;
    seen.add(dataTypeNodeId);
    const result = dataTypeResults.get(dataTypeNodeId);
    if (!result) {
      issues.push(
        issue("datatype.definitionMissing", {
          severity: unsupportedSeverity,
          message: `Missing DataTypeDefinition for ${dataTypeNodeId}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Missing") {
      issues.push(
        issue("datatype.definitionMissing", {
          severity: unsupportedSeverity,
          message: `Missing DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Unsupported") {
      issues.push(
        issue("datatype.definitionUnsupported", {
          severity: unsupportedSeverity,
          message: `Unsupported DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Failure") {
      issues.push(
        issue("datatype.definitionFailure", {
          severity: unsupportedSeverity,
          message: `Failed to read DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    definitions.set(dataTypeNodeId, result.definition);
    if (result.definition._tag === "Structure") {
      for (const field of result.definition.fields) {
        if (requiresDataTypeDefinition(field.dataTypeNodeId)) {
          queue.push(field.dataTypeNodeId);
        }
      }
    }
  }

  return definitions;
};
