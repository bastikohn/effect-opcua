import type { OpcuaSession } from "@effect-opcua/client";

import { issue } from "../diagnostics.js";
import type { CodegenIssue } from "../types.js";
import type {
  DiscoveredNode,
  NormalizedCodegenConfig,
  VariableCodecExpression,
  VariableDefinition,
} from "../internal/types.js";
import {
  isDynamicScalarDataType,
  isUnsupportedArrayRank,
  scalarSchema,
} from "./builtin-types.js";
import { displayPath } from "./names.js";
import type { SurfaceNode } from "./names.js";
import { typeFallbackSeverity } from "./policy.js";
import type { TypeGraph } from "./type-graph.js";

type OpcuaDataTypeDefinitionResult = OpcuaSession.OpcuaDataTypeDefinitionResult;

export const compileVariables = (
  config: NormalizedCodegenConfig,
  variableNodes: readonly SurfaceNode[],
  typeGraph: TypeGraph,
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
) => {
  const issues: CodegenIssue[] = [];
  const variables: VariableDefinition[] = [];
  for (const item of variableNodes) {
    const access = variableAccess(item.node);
    if (access._tag === "Skip") {
      issues.push(
        issue(access.issueCode, {
          message: `Skipped ${access.label} variable ${displayPath(item.path)}`,
          path: item.path,
          generatedPath: item.generatedPath,
          nodeId: item.node.nodeId,
        }),
      );
      continue;
    }

    const codec = variableCodec(config, item.node, typeGraph, dataTypeResults);
    if (codec.issue) {
      issues.push({
        ...codec.issue,
        path: item.path,
        generatedPath: item.generatedPath,
        nodeId: item.node.nodeId,
      });
    }
    variables.push({
      path: item.path,
      generatedPath: item.generatedPath,
      nodeId: item.node.nodeId,
      codec: codec.codec,
      access: access.value,
    });
  }
  return { variables, issues };
};

const variableCodec = (
  config: NormalizedCodegenConfig,
  node: DiscoveredNode,
  typeGraph: TypeGraph,
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
): {
  readonly codec: VariableCodecExpression;
  readonly issue?: CodegenIssue;
} => {
  const dataTypeNodeId = node.dataTypeNodeId;
  const isArray = node.valueRank === 1;
  const unsupportedSeverity = typeFallbackSeverity(config);
  if (isUnsupportedArrayRank(node.valueRank)) {
    return {
      codec: { _tag: "Dynamic" },
      issue: issue("codec.unsupportedArrayRank", {
        severity: unsupportedSeverity,
        message: `Variable has unsupported array rank ${node.valueRank}`,
      }),
    };
  }

  const structure = dataTypeNodeId
    ? typeGraph.structures.get(dataTypeNodeId)
    : undefined;
  if (structure) {
    return {
      codec: isArray
        ? { _tag: "StructureArray", name: structure.name }
        : { _tag: "Structure", name: structure.name },
    };
  }

  const enumDefinition = dataTypeNodeId
    ? typeGraph.enums.get(dataTypeNodeId)
    : undefined;
  if (enumDefinition) {
    return {
      codec: isArray
        ? { _tag: "EnumArray", name: enumDefinition.name }
        : { _tag: "Enum", name: enumDefinition.name },
    };
  }

  if (dataTypeNodeId && typeGraph.invalidEnums.has(dataTypeNodeId)) {
    return {
      codec: isArray
        ? { _tag: "SchemaArray", element: "Number" }
        : { _tag: "Schema", schema: "Number" },
    };
  }

  const scalar = scalarSchema(dataTypeNodeId);
  if (scalar) {
    return {
      codec: isArray
        ? { _tag: "SchemaArray", element: scalar }
        : { _tag: "Schema", schema: scalar },
    };
  }

  if (isDynamicScalarDataType(dataTypeNodeId)) {
    return { codec: { _tag: "Dynamic" } };
  }

  const result = dataTypeNodeId
    ? dataTypeResults.get(dataTypeNodeId)
    : undefined;
  const directDefinition =
    result?._tag === "Success" ? result.definition : undefined;
  const isUnion =
    directDefinition?._tag === "Structure" &&
    directDefinition.structureType === "Union";
  return {
    codec: { _tag: "Dynamic" },
    issue: issue(
      isUnion ? "datatype.unionUnsupported" : "codec.dynamicFallback",
      {
        severity: unsupportedSeverity,
        message: isUnion
          ? `Variable uses unsupported union DataType ${dataTypeNodeId}`
          : `Variable uses dynamic codec fallback for DataType ${dataTypeNodeId ?? "unknown"}`,
      },
    ),
  };
};

const variableAccess = (
  node: DiscoveredNode,
):
  | {
      readonly _tag: "Emit";
      readonly value: VariableDefinition["access"];
    }
  | {
      readonly _tag: "Skip";
      readonly label: "not-accessible";
      readonly issueCode: "variable.notAccessibleSkipped";
    } => {
  const effective = node.userAccessLevel ?? node.accessLevel;
  if (effective && !effective.readable && !effective.writable) {
    return {
      _tag: "Skip",
      label: "not-accessible",
      issueCode: "variable.notAccessibleSkipped",
    };
  }
  return {
    _tag: "Emit",
    value:
      effective?.writable === true
        ? effective.readable
          ? "readWrite"
          : "write"
        : "read",
  };
};
