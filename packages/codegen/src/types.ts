import type { OPCUAClientOptions } from "@effect-opcua/client/node-opcua";

export type CodegenConfig = {
  readonly connection?: {
    readonly endpointUrl?: string;
    readonly clientOptions?: OPCUAClientOptions;
  };
  readonly outputDir?: string;
  readonly roots?: readonly RootConfig[];
  readonly exclude?: readonly ExcludeRuleConfig[];
  readonly naming?: {
    readonly rootStripping?: boolean;
    readonly case?: "pascal";
  };
  readonly diagnostics?: {
    readonly warningsAsErrors?: boolean;
  };
};

export type RootConfig = {
  readonly browsePath?: string;
  readonly nodeId?: string;
  readonly exportPrefix?: string;
};

export type ExcludeRuleConfig = {
  readonly browsePath?: string | RegExp;
  readonly mode?: "prune" | "omit";
};

export type NormalizedCodegenConfig = {
  readonly connection: {
    readonly endpointUrl: string;
    readonly clientOptions?: OPCUAClientOptions;
  };
  readonly outputDir: string;
  readonly roots: readonly NormalizedRootConfig[];
  readonly exclude: readonly NormalizedExcludeRule[];
  readonly naming: {
    readonly rootStripping: boolean;
    readonly case: "pascal";
  };
  readonly diagnostics: {
    readonly warningsAsErrors: boolean;
  };
};

export type NormalizedRootConfig =
  | {
      readonly browsePath: string;
      readonly browsePathSegments: readonly string[];
      readonly nodeId?: never;
      readonly exportPrefix?: string;
    }
  | {
      readonly browsePath?: never;
      readonly browsePathSegments?: never;
      readonly nodeId: string;
      readonly exportPrefix?: string;
    };

export type NormalizedExcludeRule = {
  readonly browsePath: string | RegExp;
  readonly mode: "prune" | "omit";
};

export type CodegenDiagnostic = {
  readonly severity: "info" | "warning";
  readonly code: CodegenDiagnosticCode;
  readonly message: string;
  readonly browsePath?: string;
  readonly nodeId?: string;
  readonly file?: string;
};

export type CodegenDiagnosticCode =
  | "node.omitted"
  | "branch.pruned"
  | "node.multiPath"
  | "codec.dynamicFallback"
  | "codec.unsupportedArrayRank"
  | "variable.writeOnlySkipped"
  | "method.malformedArgumentsSkipped"
  | "enum.metadataMissing"
  | "enum.memberNameCollision"
  | "file.written"
  | "file.checked";

export type GeneratedFile = {
  readonly path: string;
  readonly contents: string;
};

export type GenerateOpcuaClientResult = {
  readonly ir: CodegenIr;
  readonly files: readonly GeneratedFile[];
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly writtenFiles: readonly string[];
};

export type CheckOpcuaClientGeneratedResult = {
  readonly ir: CodegenIr;
  readonly files: readonly GeneratedFile[];
  readonly diagnostics: readonly CodegenDiagnostic[];
  readonly staleFiles: readonly string[];
  readonly missingFiles: readonly string[];
  readonly ok: boolean;
};

export type DiscoveredAddressSpace = {
  readonly roots: readonly DiscoveredRoot[];
  readonly nodes: ReadonlyMap<NodeKey, DiscoveredNode>;
  readonly references: readonly DiscoveredReference[];
  readonly diagnostics: readonly CodegenDiagnostic[];
};

export type NodeKey = string;

export type DiscoveredRoot = {
  readonly rootIndex: number;
  readonly nodeId: string;
  readonly browsePath: string;
  readonly browsePathSegments: readonly string[];
  readonly exportPrefix?: string;
};

export type ParsedNodeId = {
  readonly namespaceIndex: number;
  readonly identifier: string;
};

export type AccessBits = {
  readonly readable: boolean;
  readonly writable: boolean;
};

export type DiscoveredNode = {
  readonly key: NodeKey;
  readonly nodeId: string;
  readonly parsedNodeId: ParsedNodeId;
  readonly namespaceIndex: number;
  readonly namespaceUri?: string;

  readonly browseName: string;
  readonly browseNameNamespaceIndex?: number;

  readonly browsePath: string;
  readonly browsePathSegments: readonly string[];
  readonly allBrowsePaths: readonly string[];

  readonly nodeClass:
    | "Object"
    | "Variable"
    | "Method"
    | "DataType"
    | "ObjectType"
    | "VariableType"
    | "ReferenceType";

  readonly displayName?: string;
  readonly description?: string;

  readonly dataTypeNodeId?: string;
  readonly valueRank?: number;
  readonly arrayDimensions?: readonly number[];

  readonly accessLevel?: AccessBits;
  readonly userAccessLevel?: AccessBits;

  readonly parentNodeId?: string;
  readonly rootIndex?: number;
};

export type DiscoveredReference = {
  readonly sourceNodeId: string;
  readonly targetNodeId: string;
  readonly referenceType: string;
  readonly isForward: boolean;
  readonly browseName: string;
};

export type CodegenIr = {
  readonly nodeIds: readonly NodeIdDefinition[];
  readonly variables: readonly VariableDefinition[];
  readonly methods: readonly MethodDefinition[];
  readonly enums: readonly EnumDefinition[];
  readonly structures: readonly StructureDefinition[];
  readonly diagnostics: readonly CodegenDiagnostic[];
};

export type NodeIdDefinition = {
  readonly nodeId: string;
  readonly browsePath: string;
  readonly browsePathSegments: readonly string[];
};

export type VariableDefinition = {
  readonly exportName: string;
  readonly nodeIdPath: readonly string[];
  readonly browsePath: string;
  readonly nodeId: string;
  readonly codec: CodecExpression;
  readonly access: "read" | "readWrite";
};

export type MethodDefinition = {
  readonly exportName: string;
  readonly objectNodeIdPath: readonly string[];
  readonly methodNodeIdPath: readonly string[];
  readonly browsePath: string;
  readonly input: readonly MethodArgumentDefinition[];
  readonly output: readonly MethodArgumentDefinition[];
};

export type MethodArgumentDefinition = {
  readonly name: string;
  readonly codec: CodecExpression;
};

export type EnumDefinition = {
  readonly exportName: string;
  readonly dataTypeNodeId: string;
  readonly browseName: string;
  readonly members: readonly EnumMemberDefinition[];
};

export type EnumMemberDefinition = {
  readonly name: string;
  readonly value: number;
};

export type StructureDefinition = {
  readonly exportName: string;
  readonly dataTypeNodeId: string;
  readonly browseName: string;
  readonly fields: readonly StructureFieldDefinition[];
};

export type StructureFieldDefinition = {
  readonly name: string;
  readonly codec: CodecExpression;
};

export type CodecExpression =
  | {
      readonly _tag: "Schema";
      readonly schema: "Boolean" | "Number" | "String" | "Date";
    }
  | {
      readonly _tag: "SchemaArray";
      readonly element: "Boolean" | "Number" | "String" | "Date";
    }
  | {
      readonly _tag: "Dynamic";
    };
