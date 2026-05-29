import { Effect } from "effect";
import type {
  OpcuaDataTypeDefinition,
  OpcuaDataTypeDefinitionResult,
  OpcuaStructureDefinition,
} from "@effect-opcua/client/OpcuaSession";

import { errorIssue, issue, sortIssues } from "./diagnostics.js";
import { codegenError } from "./errors.js";
import type {
  CodegenIssue,
  CodegenModel,
  DataTypeNodeIdDefinition,
  DiscoveredNode,
  DiscoveryModel,
  EnumDefinition,
  EnumMemberDefinition,
  GeneratedPath,
  NormalizedCodegenConfig,
  ScalarSchema,
  SchemaExpression,
  StructureDefinition,
  StructureFieldDefinition,
  VariableCodecExpression,
  VariableDefinition,
} from "./types.js";

const numericDataTypeNodeIds = new Set([
  "i=2",
  "i=3",
  "i=4",
  "i=5",
  "i=6",
  "i=7",
  "i=10",
  "i=11",
  "i=26",
  "i=27",
  "i=28",
  "i=29",
]);

const dynamicScalarDataTypeNodeIds = new Set(["i=8", "i=9"]);

type Reachability = {
  readonly enums: ReadonlyMap<string, EnumDefinition>;
  readonly structures: ReadonlyMap<string, StructureDefinition>;
  readonly invalidEnums: ReadonlySet<string>;
  readonly invalidStructures: ReadonlySet<string>;
  readonly issues: readonly CodegenIssue[];
};

export const compile = (
  config: NormalizedCodegenConfig,
  discovery: DiscoveryModel,
): Effect.Effect<CodegenModel, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const issues: CodegenIssue[] = [...discovery.issues];
    const surfaceNodes = [...discovery.nodes.values()]
      .map((node) => ({ node, ...relativeGeneratedPath(config, discovery, node) }))
      .filter((item) => item.path.length > 0)
      .sort((left, right) => pathKey(left.path).localeCompare(pathKey(right.path)));

    issues.push(...pathIssues(surfaceNodes));
    const fatalPathIssues = issues.filter((item) => item.severity === "error");
    if (fatalPathIssues.length > 0) {
      return yield* Effect.fail(
        codegenError({ _tag: "CompileFailed" }, sortIssues(fatalPathIssues)),
      );
    }

    const dataTypeResults = dataTypeResultMap(discovery.dataTypeDefinitions);
    const variables: VariableDefinition[] = [];
    const variableNodes = surfaceNodes.filter(
      (item) => item.node.nodeClass === "Variable",
    );
    const reachability = compileReachableTypes(variableNodes, dataTypeResults);
    issues.push(...reachability.issues);

    for (const item of variableNodes) {
      const access = variableAccess(item.node);
      if (access === "writeOnly") {
        issues.push(
          issue("variable.writeOnlySkipped", {
            message: `Skipped write-only variable ${displayPath(item.path)}`,
            path: item.path,
            generatedPath: item.generatedPath,
            nodeId: item.node.nodeId,
          }),
        );
        continue;
      }
      const codec = variableCodec(item.node, reachability, dataTypeResults);
      if (codec.issue) issues.push({ ...codec.issue, path: item.path, generatedPath: item.generatedPath, nodeId: item.node.nodeId });
      variables.push({
        path: item.path,
        generatedPath: item.generatedPath,
        nodeId: item.node.nodeId,
        codec: codec.codec,
        access,
      });
    }

    const generatedPathCollision = firstGeneratedPathCollision(variables);
    if (generatedPathCollision) {
      issues.push(
        errorIssue("path.generatedPathCollision", {
          message: "Two variables generate the same TypeScript path",
          generatedPath: generatedPathCollision.generatedPath,
          cause: { candidates: generatedPathCollision.candidates },
        }),
      );
    }

    const topLevelDataTypesCollision =
      variables.some((variable) => variable.generatedPath[0] === "DataTypes") &&
      (reachability.enums.size > 0 || reachability.structures.size > 0);
    if (topLevelDataTypesCollision) {
      issues.push(
        errorIssue("path.topLevelExportCollision", {
          message:
            'A top-level browse path sanitizes to reserved generated group "DataTypes"',
          generatedPath: ["DataTypes"],
        }),
      );
    }

    const fatalIssues = issues.filter((item) => item.severity === "error");
    if (fatalIssues.length > 0) {
      return yield* Effect.fail(
        codegenError({ _tag: "CompileFailed" }, sortIssues(issues)),
      );
    }

    const dataTypeNodeIds = dataTypeNodeIdDefinitions(reachability);
    return {
      nodeIds: variables.map((variable) => ({
        nodeId: variable.nodeId,
        path: variable.path,
        generatedPath: variable.generatedPath,
      })),
      dataTypeNodeIds,
      variables: variables.sort((left, right) =>
        pathKey(left.generatedPath).localeCompare(pathKey(right.generatedPath)),
      ),
      enums: [...reachability.enums.values()].sort((left, right) =>
        left.name.localeCompare(right.name),
      ),
      structures: sortStructures([...reachability.structures.values()]),
      issues: sortIssues(issues),
    };
  });

export const normalizeToIr = compile;

const compileReachableTypes = (
  variableNodes: readonly (GeneratedPath & { readonly node: DiscoveredNode })[],
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
): Reachability => {
  const issues: CodegenIssue[] = [];
  const queue = variableNodes
    .flatMap((item) => (item.node.dataTypeNodeId ? [item.node.dataTypeNodeId] : []))
    .filter(requiresDataTypeDefinition);
  const seen = new Set<string>();
  const rawDefinitions = new Map<string, OpcuaDataTypeDefinition>();

  while (queue.length > 0) {
    const dataTypeNodeId = queue.shift()!;
    if (seen.has(dataTypeNodeId)) continue;
    seen.add(dataTypeNodeId);
    const result = dataTypeResults.get(dataTypeNodeId);
    if (!result) {
      issues.push(
        issue("datatype.definitionMissing", {
          message: `Missing DataTypeDefinition for ${dataTypeNodeId}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Missing") {
      issues.push(
        issue("datatype.definitionMissing", {
          message: `Missing DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Unsupported") {
      issues.push(
        issue("datatype.definitionUnsupported", {
          message: `Unsupported DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    if (result._tag === "Failure") {
      issues.push(
        issue("datatype.definitionFailure", {
          message: `Failed to read DataTypeDefinition for ${dataTypeNodeId}: ${result.reason}`,
          nodeId: dataTypeNodeId,
        }),
      );
      continue;
    }
    rawDefinitions.set(dataTypeNodeId, result.definition);
    if (result.definition._tag === "Structure") {
      for (const field of result.definition.fields) {
        if (requiresDataTypeDefinition(field.dataTypeNodeId)) {
          queue.push(field.dataTypeNodeId);
        }
      }
    }
  }

  const enumResults = compileEnums(rawDefinitions);
  const structureResults = compileStructures(
    rawDefinitions,
    enumResults.enums,
    enumResults.invalidEnums,
  );
  return {
    enums: enumResults.enums,
    structures: structureResults.structures,
    invalidEnums: enumResults.invalidEnums,
    invalidStructures: structureResults.invalidStructures,
    issues: [...issues, ...enumResults.issues, ...structureResults.issues],
  };
};

const compileEnums = (
  definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>,
) => {
  const issues: CodegenIssue[] = [];
  const enums = new Map<string, EnumDefinition>();
  const invalidEnums = new Set<string>();
  const names = new Map<string, string[]>();

  for (const [nodeId, definition] of definitions) {
    if (definition._tag !== "Enum") continue;
    const name = sanitizePascal(definition.name);
    if (!name) {
      invalidEnums.add(nodeId);
      issues.push(
        issue("enum.emptyName", {
          message: `Enum ${nodeId} has no usable generated name`,
          nodeId,
        }),
      );
      continue;
    }
    names.set(name, [...(names.get(name) ?? []), nodeId]);
  }
  for (const [name, nodeIds] of names) {
    if (nodeIds.length > 1) {
      for (const nodeId of nodeIds) invalidEnums.add(nodeId);
      issues.push(
        issue("enum.nameCollision", {
          message: `Multiple enum DataTypes generate ${name}`,
          generatedPath: [name],
          cause: { candidates: nodeIds },
        }),
      );
    }
  }

  for (const [nodeId, definition] of definitions) {
    if (definition._tag !== "Enum" || invalidEnums.has(nodeId)) continue;
    const name = sanitizePascal(definition.name)!;
    const memberGroups = new Map<string, string[]>();
    const members: EnumMemberDefinition[] = [];
    for (const field of definition.fields) {
      let memberName = sanitizePascal(field.name);
      if (!memberName) {
        memberName = `_Value${field.value}`;
        issues.push(
          issue("enum.memberEmptyName", {
            message: `Enum member for value ${field.value} has no usable generated name`,
            nodeId,
          }),
        );
      }
      memberGroups.set(memberName, [
        ...(memberGroups.get(memberName) ?? []),
        field.name,
      ]);
      members.push({ name: memberName, value: field.value });
    }
    const collision = [...memberGroups].find(
      ([, candidates]) => candidates.length > 1,
    );
    if (collision) {
      invalidEnums.add(nodeId);
      issues.push(
        issue("enum.memberNameCollision", {
          message: `Enum ${name} has colliding generated member ${collision[0]}`,
          nodeId,
          generatedPath: [name, collision[0]],
          cause: { candidates: collision[1] },
        }),
      );
      continue;
    }
    enums.set(nodeId, {
      name,
      dataTypeNodeId: nodeId,
      browseName: definition.name,
      members: members.sort(
        (left, right) => left.value - right.value || left.name.localeCompare(right.name),
      ),
    });
  }
  return { enums, invalidEnums, issues };
};

const compileStructures = (
  definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>,
  enums: ReadonlyMap<string, EnumDefinition>,
  invalidEnums: ReadonlySet<string>,
) => {
  const issues: CodegenIssue[] = [];
  const structures = new Map<string, StructureDefinition>();
  const invalidStructures = new Set<string>();
  const names = new Map<string, string[]>();

  for (const [nodeId, definition] of definitions) {
    if (definition._tag !== "Structure") continue;
    const name = sanitizePascal(definition.name);
    if (!name) {
      invalidStructures.add(nodeId);
      issues.push(
        issue("structure.emptyName", {
          message: `Structure ${nodeId} has no usable generated name`,
          nodeId,
        }),
      );
      continue;
    }
    names.set(name, [...(names.get(name) ?? []), nodeId]);
  }
  for (const [name, nodeIds] of names) {
    if (nodeIds.length > 1) {
      for (const nodeId of nodeIds) invalidStructures.add(nodeId);
      issues.push(
        issue("structure.nameCollision", {
          message: `Multiple structure DataTypes generate ${name}`,
          generatedPath: [name],
          cause: { candidates: nodeIds },
        }),
      );
    }
  }

  const rawStructures = new Map<string, OpcuaStructureDefinition>();
  for (const [nodeId, definition] of definitions) {
    if (definition._tag === "Structure") rawStructures.set(nodeId, definition);
  }
  const structureNames = new Map(
    [...rawStructures].flatMap(([nodeId, definition]) => {
      const name = sanitizePascal(definition.name);
      return name ? ([[nodeId, name]] as const) : [];
    }),
  );

  for (const [nodeId, definition] of rawStructures) {
    const name = structureNames.get(nodeId) ?? nodeId;
    if (definition.structureType === "Union") {
      invalidStructures.add(nodeId);
      issues.push(
        issue("datatype.unionUnsupported", {
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
          message: `Structure DataType ${name} has unsupported structure type`,
          nodeId,
          generatedPath: [name],
        }),
      );
    }
  }

  for (const [nodeId, definition] of rawStructures) {
    if (invalidStructures.has(nodeId)) continue;
    const name = sanitizePascal(definition.name)!;

    const fieldGroups = new Map<string, string[]>();
    const fields: StructureFieldDefinition[] = [];
    for (const field of definition.fields) {
      let fieldName = sanitizeCamel(field.name);
      if (!fieldName) {
        fieldName = `_field${fields.length + 1}`;
        issues.push(
          issue("structure.fieldEmptyName", {
            message: `Structure ${name} has a field without a usable generated name`,
            nodeId,
            generatedPath: [name, fieldName],
          }),
        );
      }
      fieldGroups.set(fieldName, [
        ...(fieldGroups.get(fieldName) ?? []),
        field.name,
      ]);
      fields.push({
        name: fieldName,
        originalName: field.name,
        optional: field.isOptional === true,
        schema: fieldSchema({
          ownerNodeId: nodeId,
          fieldNodeId: field.dataTypeNodeId,
          valueRank: field.valueRank,
          definitions,
          structures: rawStructures,
          structureNames,
          enums,
          invalidEnums,
          invalidStructures,
          issues,
        }),
      });
    }
    const collision = [...fieldGroups].find(
      ([, candidates]) => candidates.length > 1,
    );
    if (collision) {
      invalidStructures.add(nodeId);
      structures.delete(nodeId);
      issues.push(
        issue("structure.fieldNameCollision", {
          message: `Structure ${name} has colliding generated field ${collision[0]}`,
          nodeId,
          generatedPath: [name, collision[0]],
          cause: { candidates: collision[1] },
        }),
      );
      continue;
    }
    structures.set(nodeId, {
      name,
      dataTypeNodeId: nodeId,
      browseName: definition.name,
      fields,
    });
  }

  const recursiveFields = recursiveStructureFields(rawStructures);
  if (recursiveFields.size > 0) {
    for (const [nodeId, fieldNodeIds] of recursiveFields) {
      const structure = structures.get(nodeId);
      if (!structure) continue;
      structures.set(nodeId, {
        ...structure,
        fields: structure.fields.map((field) => {
          const rawField = rawStructures
            .get(nodeId)
            ?.fields.find((item) => sanitizeCamel(item.name) === field.name);
          if (!rawField || !fieldNodeIds.has(rawField.dataTypeNodeId)) return field;
          issues.push(
            issue("structure.recursiveField", {
              message: `Structure ${structure.name} has recursive field ${field.originalName}`,
              nodeId,
              generatedPath: [structure.name, field.name],
            }),
          );
          return { ...field, schema: { _tag: "Unknown" as const } };
        }),
      });
    }
  }

  return { structures, invalidStructures, issues };
};

const fieldSchema = (input: {
  readonly ownerNodeId: string;
  readonly fieldNodeId: string;
  readonly valueRank?: number;
  readonly definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>;
  readonly structures: ReadonlyMap<string, OpcuaStructureDefinition>;
  readonly structureNames: ReadonlyMap<string, string>;
  readonly enums: ReadonlyMap<string, EnumDefinition>;
  readonly invalidEnums: ReadonlySet<string>;
  readonly invalidStructures: ReadonlySet<string>;
  readonly issues: CodegenIssue[];
}): SchemaExpression => {
  if (isUnsupportedArrayRank(input.valueRank)) {
    input.issues.push(
      issue("structure.unsupportedField", {
        message: `Structure field has unsupported array rank ${input.valueRank}`,
        nodeId: input.ownerNodeId,
      }),
    );
    return { _tag: "Unknown" };
  }
  const scalar = scalarSchema(input.fieldNodeId);
  const isArray = input.valueRank === 1;
  if (dynamicScalarSchema(input.fieldNodeId)) {
    const schema = { _tag: "Unknown" as const };
    return isArray ? { _tag: "Array", item: schema } : schema;
  }
  if (scalar) {
    const schema: SchemaExpression = { _tag: "Scalar", schema: scalar };
    return isArray ? { _tag: "Array", item: schema } : schema;
  }
  const enumDefinition = input.enums.get(input.fieldNodeId);
  if (enumDefinition) {
    const schema: SchemaExpression = {
      _tag: "Enum",
      name: enumDefinition.name,
    };
    return isArray ? { _tag: "Array", item: schema } : schema;
  }
  if (input.invalidEnums.has(input.fieldNodeId)) {
    const schema: SchemaExpression = { _tag: "Scalar", schema: "Number" };
    return isArray ? { _tag: "Array", item: schema } : schema;
  }
  const structureName = input.structureNames.get(input.fieldNodeId);
  if (structureName && !input.invalidStructures.has(input.fieldNodeId)) {
    const schema: SchemaExpression = {
      _tag: "Structure",
      name: structureName,
    };
    return isArray ? { _tag: "Array", item: schema } : schema;
  }
  if (
    input.structures.get(input.fieldNodeId)?.structureType === "Union" ||
    input.invalidStructures.has(input.fieldNodeId)
  ) {
    input.issues.push(
      issue("structure.unsupportedField", {
        message: `Structure field references unsupported DataType ${input.fieldNodeId}`,
        nodeId: input.ownerNodeId,
      }),
    );
    return { _tag: "Unknown" };
  }
  if (!input.definitions.has(input.fieldNodeId)) {
    input.issues.push(
      issue("structure.unsupportedField", {
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

const variableCodec = (
  node: DiscoveredNode,
  reachability: Reachability,
  dataTypeResults: ReadonlyMap<string, OpcuaDataTypeDefinitionResult>,
): { readonly codec: VariableCodecExpression; readonly issue?: CodegenIssue } => {
  const dataTypeNodeId = node.dataTypeNodeId;
  const isArray = node.valueRank === 1;
  if (isUnsupportedArrayRank(node.valueRank)) {
    return {
      codec: { _tag: "Dynamic" },
      issue: issue("codec.unsupportedArrayRank", {
        message: `Variable has unsupported array rank ${node.valueRank}`,
      }),
    };
  }
  const scalar = scalarSchema(dataTypeNodeId);
  const structure = dataTypeNodeId
    ? reachability.structures.get(dataTypeNodeId)
    : undefined;
  if (structure) {
    return {
      codec: isArray
        ? { _tag: "StructureArray", name: structure.name }
        : { _tag: "Structure", name: structure.name },
    };
  }
  const enumDefinition = dataTypeNodeId
    ? reachability.enums.get(dataTypeNodeId)
    : undefined;
  if (enumDefinition) {
    return {
      codec: isArray
        ? { _tag: "EnumArray", name: enumDefinition.name }
        : { _tag: "Enum", name: enumDefinition.name },
    };
  }
  if (dataTypeNodeId && reachability.invalidEnums.has(dataTypeNodeId)) {
    return {
      codec: isArray
        ? { _tag: "SchemaArray", element: "Number" }
        : { _tag: "Schema", schema: "Number" },
    };
  }
  if (scalar) {
    return {
      codec: isArray
        ? { _tag: "SchemaArray", element: scalar }
        : { _tag: "Schema", schema: scalar },
    };
  }
  if (dynamicScalarSchema(dataTypeNodeId)) {
    return {
      codec: { _tag: "Dynamic" },
    };
  }
  const result = dataTypeNodeId ? dataTypeResults.get(dataTypeNodeId) : undefined;
  const directDefinition =
    result?._tag === "Success" ? result.definition : undefined;
  const message =
    directDefinition?._tag === "Structure" &&
    directDefinition.structureType === "Union"
      ? `Variable uses unsupported union DataType ${dataTypeNodeId}`
      : `Variable uses dynamic codec fallback for DataType ${dataTypeNodeId ?? "unknown"}`;
  return {
    codec: { _tag: "Dynamic" },
    issue: issue(
      directDefinition?._tag === "Structure" &&
        directDefinition.structureType === "Union"
        ? "datatype.unionUnsupported"
        : "codec.dynamicFallback",
      { message },
    ),
  };
};

const variableAccess = (
  node: DiscoveredNode,
): "read" | "readWrite" | "writeOnly" => {
  const effective = node.userAccessLevel ?? node.accessLevel;
  if (effective?.writable && !effective.readable) return "writeOnly";
  if (node.userAccessLevel?.writable) return "readWrite";
  if (node.accessLevel?.writable) return "readWrite";
  return "read";
};

const relativeGeneratedPath = (
  config: NormalizedCodegenConfig,
  discovery: DiscoveryModel,
  node: DiscoveredNode,
): GeneratedPath => {
  if (!config.naming.rootStripping) return generatedPath(node.path);
  const root = discovery.roots.find((item) => item.rootIndex === node.rootIndex);
  if (!root) return generatedPath(node.path);
  const stripped = node.path.slice(root.path.length);
  return generatedPath(root.exportPrefix ? [root.exportPrefix, ...stripped] : stripped);
};

const generatedPath = (path: readonly string[]): GeneratedPath => ({
  path,
  generatedPath: path.map((segment) => sanitizePascal(segment) ?? ""),
});

const pathIssues = (
  items: readonly (GeneratedPath & { readonly node: DiscoveredNode })[],
) => {
  const issues: CodegenIssue[] = [];
  for (const item of items) {
    const index = item.generatedPath.findIndex((segment) => segment === "");
    if (index >= 0) {
      issues.push(
        errorIssue("path.emptyGeneratedKey", {
          message: "BrowseName segment does not produce a TypeScript key",
          path: item.path,
          generatedPath: item.generatedPath,
          nodeId: item.node.nodeId,
          cause: { segment: item.path[index] },
        }),
      );
    }
  }
  for (const [, siblings] of groupByParent(items)) {
    const groups = new Map<string, string[]>();
    for (const item of siblings) {
      const key = item.generatedPath.at(-1);
      const original = item.path.at(-1);
      if (!key || !original) continue;
      groups.set(key, [...(groups.get(key) ?? []), original]);
    }
    for (const [generatedKey, candidates] of groups) {
      if (new Set(candidates).size > 1) {
        issues.push(
          errorIssue("path.generatedKeyCollision", {
            message:
              "Two sibling BrowseName segments generate the same TypeScript key",
            path: siblings[0]?.path.slice(0, -1),
            generatedPath: siblings[0]?.generatedPath.slice(0, -1),
            cause: { generatedKey, candidates },
          }),
        );
      }
    }
  }
  return issues;
};

const groupByParent = (
  items: readonly (GeneratedPath & { readonly node: DiscoveredNode })[],
) => {
  const groups = new Map<string, typeof items>();
  for (const item of items) {
    const key = item.path.slice(0, -1).join("\u0000");
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return groups;
};

const firstGeneratedPathCollision = (variables: readonly VariableDefinition[]) => {
  const groups = new Map<string, string[]>();
  for (const variable of variables) {
    const key = pathKey(variable.generatedPath);
    groups.set(key, [...(groups.get(key) ?? []), displayPath(variable.path)]);
  }
  for (const [key, candidates] of groups) {
    if (candidates.length > 1) {
      return { generatedPath: key.split("."), candidates };
    }
  }
  return undefined;
};

const dataTypeNodeIdDefinitions = (
  reachability: Reachability,
): readonly DataTypeNodeIdDefinition[] => {
  const entries = [
    ...[...reachability.enums.values()].map((item) => ({
      name: item.name,
      nodeId: item.dataTypeNodeId,
    })),
    ...[...reachability.structures.values()].map((item) => ({
      name: item.name,
      nodeId: item.dataTypeNodeId,
    })),
  ];
  return entries.sort((left, right) => left.name.localeCompare(right.name));
};

const sortStructures = (structures: readonly StructureDefinition[]) => {
  const byName = new Map(structures.map((structure) => [structure.name, structure]));
  const sorted: StructureDefinition[] = [];
  const seen = new Set<string>();
  const visit = (structure: StructureDefinition) => {
    if (seen.has(structure.name)) return;
    seen.add(structure.name);
    const dependencies = structure.fields.flatMap((field) =>
      schemaStructureDependencies(field.schema),
    );
    for (const dependency of dependencies.sort()) {
      const target = byName.get(dependency);
      if (target) visit(target);
    }
    sorted.push(structure);
  };
  for (const structure of [...structures].sort((left, right) => left.name.localeCompare(right.name))) {
    visit(structure);
  }
  return sorted;
};

const schemaStructureDependencies = (schema: SchemaExpression): readonly string[] => {
  switch (schema._tag) {
    case "Structure":
      return [schema.name];
    case "Array":
      return schemaStructureDependencies(schema.item);
    default:
      return [];
  }
};

const isUnsupportedArrayRank = (valueRank: number | undefined) =>
  valueRank !== undefined && valueRank >= 0 && valueRank !== 1;

const scalarSchema = (
  dataTypeNodeId: string | undefined,
): ScalarSchema | undefined => {
  const normalized = normalizeNamespaceZeroNodeId(dataTypeNodeId);
  switch (normalized) {
    case "i=1":
      return "Boolean";
    case "i=12":
    case "i=21":
      return "String";
    case "i=13":
      return "Date";
    default:
      return normalized && numericDataTypeNodeIds.has(normalized)
        ? "Number"
        : undefined;
  }
};

const dynamicScalarSchema = (dataTypeNodeId: string | undefined): boolean => {
  const normalized = normalizeNamespaceZeroNodeId(dataTypeNodeId);
  return normalized ? dynamicScalarDataTypeNodeIds.has(normalized) : false;
};

const requiresDataTypeDefinition = (
  dataTypeNodeId: string | undefined,
): dataTypeNodeId is string =>
  !!dataTypeNodeId &&
  !isNamespaceZeroNodeId(dataTypeNodeId) &&
  !scalarSchema(dataTypeNodeId) &&
  !dynamicScalarSchema(dataTypeNodeId);

const sanitizePascal = (value: string): string | undefined => {
  const parts = value.match(/[A-Za-z0-9]+/g) ?? [];
  if (parts.length === 0) return undefined;
  const joined = parts.map(capitalize).join("");
  return /^[0-9]/.test(joined) ? `_${joined}` : joined;
};

const sanitizeCamel = (value: string): string | undefined => {
  const pascal = sanitizePascal(value);
  if (!pascal) return undefined;
  return pascal.startsWith("_")
    ? pascal
    : `${pascal.charAt(0).toLowerCase()}${pascal.slice(1)}`;
};

const capitalize = (word: string) =>
  word.length === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`;

const dataTypeResultMap = (
  results: readonly OpcuaDataTypeDefinitionResult[],
) => new Map(results.map((result) => [result.dataTypeNodeId, result]));

const pathKey = (path: readonly string[]) => path.join(".");

const displayPath = (path: readonly string[]) => path.join(" / ");

const normalizeNamespaceZeroNodeId = (nodeId: string | undefined) =>
  nodeId?.startsWith("ns=0;") ? nodeId.slice("ns=0;".length) : nodeId;

const isNamespaceZeroNodeId = (nodeId: string) =>
  /^i=\d+$/.test(nodeId) || /^ns=0;i=\d+$/.test(nodeId);
