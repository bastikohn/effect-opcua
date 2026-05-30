import { Effect } from "effect";

import { sortIssues } from "./diagnostics.js";
import { codegenError } from "./errors.js";
import { assembleModel, modelIssues } from "./compile/model.js";
import { pathIssues, surfaceNodes } from "./compile/names.js";
import {
  compileReachableTypes,
  dataTypeResultMap,
} from "./compile/type-graph.js";
import { compileVariables } from "./compile/variables.js";
import type {
  CodegenIssue,
  CodegenModel,
  DiscoveryModel,
  NormalizedCodegenConfig,
} from "./types.js";

export const compile = (
  config: NormalizedCodegenConfig,
  discovery: DiscoveryModel,
): Effect.Effect<CodegenModel, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const issues: CodegenIssue[] = [...discovery.issues];
    const nodes = surfaceNodes(discovery);
    issues.push(...pathIssues(nodes));
    yield* failOnFatalIssues(issues);

    const variableNodes = nodes.filter(
      (item) => item.node.nodeClass === "Variable",
    );
    const dataTypeResults = dataTypeResultMap(discovery.dataTypeDefinitions);
    const typeGraph = compileReachableTypes(
      config,
      variableNodes,
      dataTypeResults,
    );
    issues.push(...typeGraph.issues);

    const variableResult = compileVariables(
      config,
      variableNodes,
      typeGraph,
      dataTypeResults,
    );
    issues.push(...variableResult.issues);
    issues.push(...modelIssues(variableResult.variables, typeGraph));
    yield* failOnFatalIssues(issues);

    return assembleModel(
      variableResult.variables,
      typeGraph,
      sortIssues(issues),
    );
  });

export const normalizeToIr = compile;

const failOnFatalIssues = (issues: readonly CodegenIssue[]) =>
  issues.some((item) => item.severity === "error")
    ? Effect.fail(codegenError({ _tag: "CompileFailed" }, sortIssues(issues)))
    : Effect.void;
