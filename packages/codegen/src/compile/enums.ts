import type { OpcuaDataTypeDefinition } from "@effect-opcua/client/OpcuaSession";

import { issue } from "../diagnostics.js";
import type {
  CodegenIssue,
  EnumDefinition,
  EnumMemberDefinition,
  NormalizedCodegenConfig,
} from "../types.js";
import { sanitizePascal } from "./names.js";
import { unsupportedTypeSeverity } from "./policy.js";

export type EnumGraph = {
  readonly enums: ReadonlyMap<string, EnumDefinition>;
  readonly invalidEnums: ReadonlySet<string>;
  readonly issues: readonly CodegenIssue[];
};

export const compileEnums = (
  config: NormalizedCodegenConfig,
  definitions: ReadonlyMap<string, OpcuaDataTypeDefinition>,
): EnumGraph => {
  const issues: CodegenIssue[] = [];
  const enums = new Map<string, EnumDefinition>();
  const invalidEnums = new Set<string>();
  const names = new Map<string, string[]>();
  const unsupportedSeverity = unsupportedTypeSeverity(config);

  for (const [nodeId, definition] of definitions) {
    if (definition._tag !== "Enum") continue;
    const name = sanitizePascal(definition.name);
    if (!name) {
      invalidEnums.add(nodeId);
      issues.push(
        issue("enum.emptyName", {
          severity: unsupportedSeverity,
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
          severity: unsupportedSeverity,
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
          severity: unsupportedSeverity,
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
        (left, right) =>
          left.value - right.value || left.name.localeCompare(right.name),
      ),
    });
  }

  return { enums, invalidEnums, issues };
};
