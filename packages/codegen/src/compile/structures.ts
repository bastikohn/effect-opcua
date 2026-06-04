import type {
  OpcuaDataTypeDefinition,
  OpcuaStructureDefinition,
} from "@effect-opcua/client";

import { issue } from "../diagnostics.js";
import type { CodegenIssue } from "../types.js";
import type {
  EnumDefinition,
  NormalizedCodegenConfig,
  SchemaExpression,
  StructureDefinition,
  StructureFieldDefinition,
} from "../internal/types.js";
import {
  isDynamicScalarDataType,
  isUnsupportedArrayRank,
  scalarSchema,
} from "./builtin-types.js";
import { nodeOpcuaFieldName, sanitizeCamel, sanitizePascal } from "./names.js";
import { typeFallbackSeverity } from "./policy.js";

export type StructureGraph = {
  readonly structures: ReadonlyMap<string, StructureDefinition>;
  readonly invalidStructures: ReadonlySet<string>;
  readonly issues: readonly CodegenIssue[];
};

export const compileStructures = (
  config: NormalizedCodegenConfig,
  definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>,
  enums: ReadonlyMap<string, EnumDefinition>,
  invalidEnums: ReadonlySet<string>,
): StructureGraph => {
  const issues: CodegenIssue[] = [];
  const unsupportedSeverity = typeFallbackSeverity(config);
  const rawStructures = new Map<string, OpcuaStructureDefinition>();
  const invalidStructures = new Set<string>();
  const structureNames = new Map<string, string>();
  const nameGroups = new Map<string, string[]>();

  for (const [nodeId, definition] of definitions) {
    if (definition._tag !== "Structure") continue;
    rawStructures.set(nodeId, definition);
    const name = sanitizePascal(definition.name);
    if (!name) {
      invalidStructures.add(nodeId);
      issues.push(
        issue("structure.emptyName", {
          severity: "error",
          message: `Structure ${nodeId} has no usable generated name`,
          nodeId,
        }),
      );
      continue;
    }
    structureNames.set(nodeId, name);
    nameGroups.set(name, [...(nameGroups.get(name) ?? []), nodeId]);
  }

  for (const [name, nodeIds] of nameGroups) {
    if (nodeIds.length > 1) {
      for (const nodeId of nodeIds) invalidStructures.add(nodeId);
      issues.push(
        issue("structure.nameCollision", {
          severity: "error",
          message: `Multiple structure DataTypes generate ${name}`,
          generatedPath: [name],
          cause: { candidates: nodeIds },
        }),
      );
    }
  }

  for (const [nodeId, definition] of rawStructures) {
    const name = structureNames.get(nodeId) ?? nodeId;
    if (definition.structureType === "Union") {
      invalidStructures.add(nodeId);
      issues.push(
        issue("datatype.unionUnsupported", {
          severity: unsupportedSeverity,
          message: `Union DataType ${name} is not generated`,
          nodeId,
          generatedPath: [name],
        }),
      );
    }
    if (definition.structureType === "Unknown") {
      invalidStructures.add(nodeId);
      issues.push(
        issue("datatype.definitionUnsupported", {
          severity: unsupportedSeverity,
          message: `Structure DataType ${name} has unsupported structure type`,
          nodeId,
          generatedPath: [name],
        }),
      );
    }
  }

  const validFieldNames = new Map<string, readonly string[]>();
  for (const [nodeId, definition] of rawStructures) {
    if (invalidStructures.has(nodeId)) continue;
    const name = structureNames.get(nodeId)!;
    const generatedNames = new Map<string, string[]>();
    const fieldNames: string[] = [];
    for (const [index, field] of definition.fields.entries()) {
      let fieldName = sanitizeCamel(field.name);
      if (!fieldName) {
        fieldName = `_field${index + 1}`;
        issues.push(
          issue("structure.fieldEmptyName", {
            message: `Structure ${name} has a field without a usable generated name`,
            nodeId,
            generatedPath: [name, fieldName],
          }),
        );
      }
      generatedNames.set(fieldName, [
        ...(generatedNames.get(fieldName) ?? []),
        field.name,
      ]);
      fieldNames.push(fieldName);
    }
    const collision = [...generatedNames].find(
      ([, candidates]) => candidates.length > 1,
    );
    if (collision) {
      invalidStructures.add(nodeId);
      issues.push(
        issue("structure.fieldNameCollision", {
          severity: "error",
          message: `Structure ${name} has colliding generated field ${collision[0]}`,
          nodeId,
          generatedPath: [name, collision[0]],
          cause: { candidates: collision[1] },
        }),
      );
      continue;
    }
    validFieldNames.set(nodeId, fieldNames);
  }

  const recursiveFields = recursiveStructureFields(rawStructures);
  const structures = new Map<string, StructureDefinition>();
  for (const [nodeId, definition] of rawStructures) {
    if (invalidStructures.has(nodeId)) continue;
    const name = structureNames.get(nodeId)!;
    const fieldNames = validFieldNames.get(nodeId)!;
    const fields: StructureFieldDefinition[] = definition.fields.map(
      (field, index) => {
        const fieldName = fieldNames[index]!;
        const recursive = recursiveFields
          .get(nodeId)
          ?.has(field.dataTypeNodeId);
        if (recursive) {
          issues.push(
            issue("structure.recursiveField", {
              severity: unsupportedSeverity,
              message: `Structure ${name} has recursive field ${field.name}`,
              nodeId,
              generatedPath: [name, fieldName],
            }),
          );
        }
        return {
          name: fieldName,
          encodedName: nodeOpcuaFieldName(field.name),
          originalName: field.name,
          optional: field.isOptional === true,
          schema: recursive
            ? { _tag: "Unknown" }
            : fieldSchema({
                ownerNodeId: nodeId,
                fieldNodeId: field.dataTypeNodeId,
                valueRank: field.valueRank,
                definitions,
                rawStructures,
                structureNames,
                invalidStructures,
                enums,
                invalidEnums,
                issues,
                unsupportedSeverity,
              }),
        };
      },
    );
    structures.set(nodeId, {
      name,
      dataTypeNodeId: nodeId,
      browseName: definition.name,
      fields,
    });
  }

  return { structures, invalidStructures, issues };
};

const fieldSchema = (input: {
  readonly ownerNodeId: string;
  readonly fieldNodeId: string;
  readonly valueRank?: number;
  readonly definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>;
  readonly rawStructures: ReadonlyMap<string, OpcuaStructureDefinition>;
  readonly structureNames: ReadonlyMap<string, string>;
  readonly invalidStructures: ReadonlySet<string>;
  readonly enums: ReadonlyMap<string, EnumDefinition>;
  readonly invalidEnums: ReadonlySet<string>;
  readonly issues: CodegenIssue[];
  readonly unsupportedSeverity: "error" | "warning";
}): SchemaExpression => {
  if (isUnsupportedArrayRank(input.valueRank)) {
    input.issues.push(
      issue("structure.unsupportedField", {
        severity: input.unsupportedSeverity,
        message: `Structure field has unsupported array rank ${input.valueRank}`,
        nodeId: input.ownerNodeId,
      }),
    );
    return { _tag: "Unknown" };
  }

  const isArray = input.valueRank === 1;
  const wrapArray = (
    schema: Exclude<SchemaExpression, { readonly _tag: "Array" }>,
  ) => (isArray ? ({ _tag: "Array", item: schema } as const) : schema);
  const scalar = scalarSchema(input.fieldNodeId);
  if (scalar) return wrapArray({ _tag: "Scalar", schema: scalar });

  const enumDefinition = input.enums.get(input.fieldNodeId);
  if (enumDefinition) {
    return wrapArray({ _tag: "Enum", name: enumDefinition.name });
  }
  if (input.invalidEnums.has(input.fieldNodeId)) {
    return wrapArray({ _tag: "Scalar", schema: "Number" });
  }

  const structureName = input.structureNames.get(input.fieldNodeId);
  if (structureName && !input.invalidStructures.has(input.fieldNodeId)) {
    return wrapArray({ _tag: "Structure", name: structureName });
  }

  if (isDynamicScalarDataType(input.fieldNodeId)) {
    input.issues.push(
      issue("structure.unsupportedField", {
        severity: input.unsupportedSeverity,
        message: `Structure field references dynamic scalar DataType ${input.fieldNodeId}`,
        nodeId: input.ownerNodeId,
      }),
    );
    return wrapArray({ _tag: "Unknown" });
  }

  if (
    input.rawStructures.get(input.fieldNodeId)?.structureType === "Union" ||
    input.invalidStructures.has(input.fieldNodeId)
  ) {
    input.issues.push(
      issue("structure.unsupportedField", {
        severity: input.unsupportedSeverity,
        message: `Structure field references unsupported DataType ${input.fieldNodeId}`,
        nodeId: input.ownerNodeId,
      }),
    );
    return { _tag: "Unknown" };
  }

  if (!input.definitions.has(input.fieldNodeId)) {
    input.issues.push(
      issue("structure.unsupportedField", {
        severity: input.unsupportedSeverity,
        message: `Structure field references DataType without definition ${input.fieldNodeId}`,
        nodeId: input.ownerNodeId,
      }),
    );
  }
  return { _tag: "Unknown" };
};

const recursiveStructureFields = (
  structures: ReadonlyMap<string, OpcuaStructureDefinition>,
) => {
  const result = new Map<string, Set<string>>();
  const dependencies = new Map<string, readonly string[]>();
  for (const [nodeId, structure] of structures) {
    dependencies.set(
      nodeId,
      structure.fields
        .map((field) => field.dataTypeNodeId)
        .filter((fieldNodeId) => structures.has(fieldNodeId)),
    );
  }
  for (const [nodeId, structure] of structures) {
    for (const field of structure.fields) {
      if (!structures.has(field.dataTypeNodeId)) continue;
      if (reaches(field.dataTypeNodeId, nodeId, dependencies, new Set())) {
        const set = result.get(nodeId) ?? new Set<string>();
        set.add(field.dataTypeNodeId);
        result.set(nodeId, set);
      }
    }
  }
  return result;
};

const reaches = (
  current: string,
  target: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
  seen: Set<string>,
): boolean => {
  if (current === target) return true;
  if (seen.has(current)) return false;
  seen.add(current);
  return (dependencies.get(current) ?? []).some((next) =>
    reaches(next, target, dependencies, seen),
  );
};
