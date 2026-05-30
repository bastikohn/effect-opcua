import { errorIssue } from "../diagnostics.js";
import type {
  CodegenIssue,
  CodegenModel,
  DataTypeNodeIdDefinition,
  SchemaExpression,
  StructureDefinition,
  VariableDefinition,
} from "../types.js";
import { displayPath, pathKey } from "./names.js";
import type { TypeGraph } from "./type-graph.js";

export const modelIssues = (
  variables: readonly VariableDefinition[],
  typeGraph: TypeGraph,
): readonly CodegenIssue[] => [
  ...generatedPathCollisionIssues(variables),
  ...branchLeafCollisionIssues(variables),
  ...reservedDataTypesCollisionIssues(variables, typeGraph),
];

export const assembleModel = (
  variables: readonly VariableDefinition[],
  typeGraph: TypeGraph,
  issues: readonly CodegenIssue[],
): CodegenModel => ({
  nodeIds: variables.map((variable) => ({
    nodeId: variable.nodeId,
    path: variable.path,
    generatedPath: variable.generatedPath,
  })),
  dataTypeNodeIds: dataTypeNodeIdDefinitions(typeGraph),
  variables: [...variables].sort((left, right) =>
    pathKey(left.generatedPath).localeCompare(pathKey(right.generatedPath)),
  ),
  enums: [...typeGraph.enums.values()].sort((left, right) =>
    left.name.localeCompare(right.name),
  ),
  structures: sortStructures([...typeGraph.structures.values()]),
  issues,
});

const generatedPathCollisionIssues = (
  variables: readonly VariableDefinition[],
): readonly CodegenIssue[] => {
  const groups = new Map<string, string[]>();
  for (const variable of variables) {
    const key = pathKey(variable.generatedPath);
    groups.set(key, [...(groups.get(key) ?? []), displayPath(variable.path)]);
  }
  return [...groups].flatMap(([key, candidates]) =>
    candidates.length > 1
      ? [
          errorIssue("path.generatedPathCollision", {
            message: "Two variables generate the same TypeScript path",
            generatedPath: key.split("."),
            cause: { candidates },
          }),
        ]
      : [],
  );
};

const branchLeafCollisionIssues = (
  variables: readonly VariableDefinition[],
): readonly CodegenIssue[] => {
  const byPath = new Map(
    variables.map((variable) => [pathKey(variable.generatedPath), variable]),
  );
  const issues: CodegenIssue[] = [];
  for (const variable of variables) {
    for (let index = 1; index < variable.generatedPath.length; index++) {
      const prefix = variable.generatedPath.slice(0, index);
      const parent = byPath.get(pathKey(prefix));
      if (!parent) continue;
      issues.push(
        errorIssue("path.branchLeafCollision", {
          message:
            "A generated variable path is both a leaf variable and an object branch",
          generatedPath: prefix,
          cause: {
            candidates: [displayPath(parent.path), displayPath(variable.path)],
          },
        }),
      );
    }
  }
  return issues;
};

const reservedDataTypesCollisionIssues = (
  variables: readonly VariableDefinition[],
  typeGraph: TypeGraph,
): readonly CodegenIssue[] => {
  if (
    !variables.some((variable) => variable.generatedPath[0] === "DataTypes") ||
    (typeGraph.enums.size === 0 && typeGraph.structures.size === 0)
  ) {
    return [];
  }
  return [
    errorIssue("path.topLevelExportCollision", {
      message:
        'A top-level browse path sanitizes to reserved generated group "DataTypes"',
      generatedPath: ["DataTypes"],
    }),
  ];
};

const dataTypeNodeIdDefinitions = (
  typeGraph: TypeGraph,
): readonly DataTypeNodeIdDefinition[] => {
  const entries = [
    ...[...typeGraph.enums.values()].map((item) => ({
      name: item.name,
      nodeId: item.dataTypeNodeId,
    })),
    ...[...typeGraph.structures.values()].map((item) => ({
      name: item.name,
      nodeId: item.dataTypeNodeId,
    })),
  ];
  return entries.sort((left, right) => left.name.localeCompare(right.name));
};

const sortStructures = (structures: readonly StructureDefinition[]) => {
  const byName = new Map(
    structures.map((structure) => [structure.name, structure]),
  );
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
  for (const structure of [...structures].sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    visit(structure);
  }
  return sorted;
};

const schemaStructureDependencies = (
  schema: SchemaExpression,
): readonly string[] => {
  switch (schema._tag) {
    case "Structure":
      return [schema.name];
    case "Array":
      return schemaStructureDependencies(schema.item);
    default:
      return [];
  }
};
