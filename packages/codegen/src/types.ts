import type {
  OPCUAClientOptions,
  UserIdentityInfo,
} from "@effect-opcua/client/node-opcua";
import type { OpcuaDataTypeDefinitionResult } from "@effect-opcua/client/OpcuaSession";
import type { CodegenIssueCode, CodegenIssueSeverity } from "./issue-codes.js";

export type CodegenConfig = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
  readonly userIdentity?: UserIdentityInfo;
  readonly outputDir: string;
  readonly roots: readonly RootConfig[];
  readonly exclude?: readonly ExcludeRuleConfig[];
  readonly discovery?: DiscoveryConfig;
  readonly diagnostics?: {
    readonly warningsAsErrors?: boolean;
    readonly unsupportedTypes?: "error" | "warn-dynamic";
  };
};

export type RootConfig =
  | {
      readonly path: readonly string[];
      readonly nodeId?: never;
      readonly exportPrefix?: string;
    }
  | {
      readonly path?: never;
      readonly nodeId: string;
      readonly exportPrefix: string;
    };

export type PathPatternSegment = string | RegExp;

export type ExcludeRuleConfig = {
  readonly path: readonly PathPatternSegment[];
  readonly mode: "prune" | "omit";
};

export type DiscoveryConfig = {
  readonly onBrowseFailure?: "warn" | "fail";
};

export type NormalizedCodegenConfig = {
  readonly endpointUrl: string;
  readonly clientOptions?: OPCUAClientOptions;
  readonly userIdentity?: UserIdentityInfo;
  readonly outputDir: string;
  readonly roots: readonly NormalizedRootConfig[];
  readonly exclude: readonly NormalizedExcludeRule[];
  readonly discovery: {
    readonly onBrowseFailure: "warn" | "fail";
  };
  readonly diagnostics: {
    readonly warningsAsErrors: boolean;
    readonly unsupportedTypes: "error" | "warn-dynamic";
  };
};

export type NormalizedRootConfig =
  | {
      readonly path: readonly string[];
      readonly nodeId?: never;
      readonly exportPrefix?: string;
    }
  | {
      readonly path?: never;
      readonly nodeId: string;
      readonly exportPrefix: string;
    };

export type NormalizedExcludeRule =
  | {
      readonly _tag: "Path";
      readonly path: readonly string[];
      readonly mode: "prune" | "omit";
    }
  | {
      readonly _tag: "PathPattern";
      readonly pathPattern: readonly PathPatternSegment[];
      readonly mode: "prune" | "omit";
    };

export type CodegenIssue = {
  readonly severity: CodegenIssueSeverity;
  readonly code: CodegenIssueCode;
  readonly message: string;
  readonly nodeId?: string;
  readonly path?: readonly string[];
  readonly generatedPath?: readonly string[];
  readonly file?: string;
  readonly cause?: unknown;
};

export type GeneratedFile = {
  readonly path: string;
  readonly contents: string;
};

export type GenerateResult = {
  readonly files: readonly GeneratedFile[];
  readonly issues: readonly CodegenIssue[];
  readonly writtenFiles: readonly string[];
};

export type CheckResult = {
  readonly files: readonly GeneratedFile[];
  readonly issues: readonly CodegenIssue[];
  readonly staleFiles: readonly string[];
  readonly missingFiles: readonly string[];
  readonly ok: boolean;
};

export type DiscoveryModel = {
  readonly roots: readonly DiscoveredRoot[];
  readonly nodes: ReadonlyMap<NodeKey, DiscoveredNode>;
  readonly references: readonly DiscoveredReference[];
  readonly dataTypeDefinitions: readonly OpcuaDataTypeDefinitionResult[];
  readonly issues: readonly CodegenIssue[];
};

export type NodeKey = string;

export type DiscoveredRoot = {
  readonly rootIndex: number;
  readonly nodeId: string;
  readonly path: readonly string[];
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

  readonly path: readonly string[];
  readonly allPaths: readonly (readonly string[])[];

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

export type CodegenModel = {
  readonly nodeIds: readonly NodeIdDefinition[];
  readonly dataTypeNodeIds: readonly DataTypeNodeIdDefinition[];
  readonly variables: readonly VariableDefinition[];
  readonly enums: readonly EnumDefinition[];
  readonly structures: readonly StructureDefinition[];
  readonly issues: readonly CodegenIssue[];
};

export type CodegenPlan = {
  readonly model: CodegenModel;
  readonly files: readonly GeneratedFile[];
  readonly issues: readonly CodegenIssue[];
};

export type NodeIdDefinition = {
  readonly nodeId: string;
  readonly path: readonly string[];
  readonly generatedPath: readonly string[];
};

export type DataTypeNodeIdDefinition = {
  readonly nodeId: string;
  readonly name: string;
};

export type VariableDefinition = {
  readonly path: readonly string[];
  readonly generatedPath: readonly string[];
  readonly nodeId: string;
  readonly codec: VariableCodecExpression;
  readonly access: "read" | "readWrite";
};

export type EnumDefinition = {
  readonly name: string;
  readonly dataTypeNodeId: string;
  readonly browseName: string;
  readonly members: readonly EnumMemberDefinition[];
};

export type EnumMemberDefinition = {
  readonly name: string;
  readonly value: number;
};

export type StructureDefinition = {
  readonly name: string;
  readonly dataTypeNodeId: string;
  readonly browseName: string;
  readonly fields: readonly StructureFieldDefinition[];
};

export type StructureFieldDefinition = {
  readonly name: string;
  readonly originalName: string;
  readonly schema: SchemaExpression;
  readonly optional: boolean;
};

export type ScalarSchema = "Boolean" | "Number" | "String" | "Date";

export type VariableCodecExpression =
  | {
      readonly _tag: "Schema";
      readonly schema: ScalarSchema;
    }
  | {
      readonly _tag: "SchemaArray";
      readonly element: ScalarSchema;
    }
  | {
      readonly _tag: "Enum";
      readonly name: string;
    }
  | {
      readonly _tag: "EnumArray";
      readonly name: string;
    }
  | {
      readonly _tag: "Structure";
      readonly name: string;
    }
  | {
      readonly _tag: "StructureArray";
      readonly name: string;
    }
  | {
      readonly _tag: "Dynamic";
    };

export type SchemaExpression =
  | {
      readonly _tag: "Scalar";
      readonly schema: ScalarSchema;
    }
  | {
      readonly _tag: "Array";
      readonly item: Exclude<SchemaExpression, { readonly _tag: "Array" }>;
    }
  | {
      readonly _tag: "Enum";
      readonly name: string;
    }
  | {
      readonly _tag: "Structure";
      readonly name: string;
    }
  | {
      readonly _tag: "Unknown";
    };

export type GeneratedPath = {
  readonly path: readonly string[];
  readonly generatedPath: readonly string[];
};
