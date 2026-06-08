import { resolveNodeId, type ClientSession } from "node-opcua";
import { Effect, PubSub, Scope, Semaphore, Stream } from "effect";

import * as OpcuaError from "../../OpcuaError.js";
import * as OpcuaMethod from "../../OpcuaMethod.js";
import * as OpcuaSession from "../../OpcuaSession.js";
import * as OpcuaVariable from "../../OpcuaVariable.js";
import * as MethodOperations from "../method/operations.js";
import * as VariableOperations from "../variable/operations.js";

import {
  browseContinuationError,
  browseOptionsError,
  browseWithMaxReferences,
  normalizeBrowseResult,
} from "../browse/operations.js";
import { type OpcuaSessionEvent } from "../events/model.js";
import { makeMetadataService } from "../metadata/service.js";
import { makeStructureRuntime } from "../structures/runtime.js";
import {
  callManyWithState,
  readManyWithState,
  writeManyWithState,
  type SessionOperationsState,
} from "../batch/operations.js";
import { makeSubscriptionRuntime } from "../subscription/runtime.js";
import {
  readDataTypeDefinition as readDataTypeDefinitionImpl,
  readManyDataTypeDefinitions as readManyDataTypeDefinitionsImpl,
} from "../data-types/read.js";

import {
  DEFAULT_BROWSE_DIRECTION,
  DEFAULT_BROWSE_INCLUDE_SUBTYPES,
  DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
  DEFAULT_BROWSE_NODE_CLASS_MASK,
  DEFAULT_BROWSE_REFERENCE_TYPE_ID,
  DEFAULT_BROWSE_RESULT_MASK,
} from "../common/constants.js";

export const makeSession: (
  unsafeRaw: ClientSession,
  events: PubSub.PubSub<OpcuaSessionEvent>,
  options?: Pick<OpcuaSession.SessionOptions, "batching">,
) => Effect.Effect<OpcuaSession.SessionService, never, Scope.Scope> =
  Effect.fnUntraced(function* (unsafeRaw, events, options) {
    const browseSemaphore = Semaphore.makeUnsafe(1);
    const structureRuntime = makeStructureRuntime(unsafeRaw);
    const metadata = makeMetadataService(unsafeRaw, structureRuntime);
    const state: SessionOperationsState = {
      unsafeRaw,
      metadata,
      structureRuntime,
      batching: options?.batching,
    };
    yield* Effect.acquireRelease(
      Effect.sync(() => {
        const listener = () => {
          Effect.runSync(
            metadata.invalidate.pipe(
              Effect.andThen(structureRuntime.invalidate),
            ),
          );
        };
        unsafeRaw.on("session_restored", listener);
        return listener;
      }),
      (listener) =>
        Effect.sync(() => {
          if ("off" in unsafeRaw && typeof unsafeRaw.off === "function") {
            unsafeRaw.off("session_restored", listener);
          } else {
            unsafeRaw.removeListener("session_restored", listener);
          }
        }),
    );

    const read: OpcuaSession.SessionService["read"] = (def) =>
      Effect.gen(function* () {
        yield* metadata.variable(def);
        const result = yield* VariableOperations.readVariable(
          unsafeRaw,
          def,
          structureRuntime,
        );
        return result as OpcuaVariable.ReadResult<
          OpcuaVariable.ValueOfVariableDef<typeof def>,
          OpcuaVariable.NodeIdOfVariableDef<typeof def>
        >;
      }).pipe(
        Effect.withSpan("opcua.session.read", {
          attributes: { "opcua.node_id": def.nodeId },
          kind: "client",
        }),
      );

    const write: OpcuaSession.SessionService["write"] = (def, value) =>
      Effect.gen(function* () {
        const variableMetadata = yield* metadata.variable(def);
        const result = yield* VariableOperations.writeVariable(
          unsafeRaw,
          def,
          variableMetadata,
          value,
          structureRuntime,
        );
        return result as OpcuaVariable.WriteResult<
          OpcuaVariable.NodeIdOfVariableDef<typeof def>
        >;
      }).pipe(
        Effect.withSpan("opcua.session.write", {
          attributes: { "opcua.node_id": def.nodeId },
          kind: "client",
        }),
      );

    const readMany: OpcuaSession.SessionService["readMany"] = (
      items,
      options,
    ) =>
      readManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.readMany", {
          attributes: { "opcua.node_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const writeMany: OpcuaSession.SessionService["writeMany"] = (
      items,
      options,
    ) =>
      writeManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.writeMany", {
          attributes: { "opcua.node_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const makeSubscription: OpcuaSession.SessionService["makeSubscription"] = (
      options,
    ) =>
      makeSubscriptionRuntime(unsafeRaw, options, structureRuntime, (def) =>
        metadata.variable(def),
      );

    const call: OpcuaSession.SessionService["call"] = (def, input, options) =>
      Effect.gen(function* () {
        const methodMetadata = yield* metadata.method(def);
        const method = yield* MethodOperations.resolveMethod(
          def,
          methodMetadata,
        );
        return yield* MethodOperations.callResolvedMethod(
          unsafeRaw,
          method,
          input,
          structureRuntime,
          options,
        );
      }).pipe(
        Effect.withSpan("opcua.session.call", {
          attributes: {
            "opcua.object_id": def.objectId,
            "opcua.method_id": def.methodId,
          },
          kind: "client",
        }),
      );

    const callMany: OpcuaSession.SessionService["callMany"] = (
      items,
      options,
    ) =>
      callManyWithState(state, items, options).pipe(
        Effect.withSpan("opcua.session.callMany", {
          attributes: { "opcua.method_count": Object.keys(items).length },
          kind: "client",
        }),
      );

    const browse: OpcuaSession.SessionService["browse"] = (input) =>
      Effect.gen(function* () {
        const validationError = browseOptionsError(input);
        if (validationError) return yield* Effect.fail(validationError);

        const result = yield* Effect.tryPromise({
          try: () =>
            browseWithMaxReferences(
              unsafeRaw,
              {
                nodeId: resolveNodeId(input.nodeId),
                referenceTypeId: resolveNodeId(
                  input.referenceTypeId ?? DEFAULT_BROWSE_REFERENCE_TYPE_ID,
                ),
                browseDirection:
                  input.browseDirection ?? DEFAULT_BROWSE_DIRECTION,
                includeSubtypes:
                  input.includeSubtypes ?? DEFAULT_BROWSE_INCLUDE_SUBTYPES,
                nodeClassMask:
                  input.nodeClassMask ?? DEFAULT_BROWSE_NODE_CLASS_MASK,
                resultMask: input.resultMask ?? DEFAULT_BROWSE_RESULT_MASK,
              },
              input.maxReferencesPerNode ??
                DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
            ),
          catch: (cause) =>
            OpcuaError.serviceError({
              operation: "browse",
              nodeId: input.nodeId,
              cause,
            }),
        }).pipe(browseSemaphore.withPermits(1));

        return normalizeBrowseResult(
          input.nodeId,
          result,
          input.includeRaw ?? false,
        );
      }).pipe(
        Effect.withSpan("opcua.session.browse", {
          attributes: {
            "opcua.node_id": input.nodeId,
            "opcua.max_references_per_node":
              input.maxReferencesPerNode ??
              DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
          },
          kind: "client",
        }),
      );

    const browseNext: OpcuaSession.SessionService["browseNext"] = (
      continuation,
    ) =>
      Effect.gen(function* () {
        const validationError = browseContinuationError(
          "browseNext",
          continuation,
        );
        if (validationError) return yield* Effect.fail(validationError);

        const result = yield* Effect.tryPromise({
          try: () => unsafeRaw.browseNext(continuation.unsafeRaw, false),
          catch: (cause) =>
            OpcuaError.serviceError({
              operation: "browseNext",
              nodeId: continuation.nodeId,
              cause,
            }),
        });

        return normalizeBrowseResult(
          continuation.nodeId,
          result,
          continuation.includeRaw ?? false,
        );
      }).pipe(
        Effect.withSpan("opcua.session.browseNext", {
          attributes: { "opcua.node_id": continuation.nodeId },
          kind: "client",
        }),
      );

    const releaseBrowseContinuation: OpcuaSession.SessionService["releaseBrowseContinuation"] =
      (continuation) =>
        Effect.gen(function* () {
          const validationError = browseContinuationError(
            "releaseBrowseContinuation",
            continuation,
          );
          if (validationError) return yield* Effect.fail(validationError);

          yield* Effect.tryPromise({
            try: () => unsafeRaw.browseNext(continuation.unsafeRaw, true),
            catch: (cause) =>
              OpcuaError.serviceError({
                operation: "releaseBrowseContinuation",
                nodeId: continuation.nodeId,
                cause,
              }),
          });
        }).pipe(
          Effect.withSpan("opcua.session.releaseBrowseContinuation", {
            attributes: { "opcua.node_id": continuation.nodeId },
            kind: "client",
          }),
        );

    const browseChildren: OpcuaSession.SessionService["browseChildren"] = (
      nodeId,
      options,
    ) =>
      Effect.gen(function* () {
        const mode = options?.mode ?? "all";
        const first = yield* browse({
          nodeId,
          referenceTypeId:
            options?.referenceTypeId ?? DEFAULT_BROWSE_REFERENCE_TYPE_ID,
          includeSubtypes:
            options?.includeSubtypes ?? DEFAULT_BROWSE_INCLUDE_SUBTYPES,
          nodeClassMask:
            options?.nodeClassMask ?? DEFAULT_BROWSE_NODE_CLASS_MASK,
          maxReferencesPerNode:
            options?.maxReferencesPerNode ??
            DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE,
          includeRaw: options?.includeRaw,
        });
        if (first._tag === "NonGoodStatus") return first;
        if (mode === "page") {
          return {
            _tag: "Browsed" as const,
            nodeId,
            status: first.status,
            references: first.references,
            continuation: first.continuation,
          };
        }

        const references = [...first.references];
        let continuation = first.continuation;
        while (continuation) {
          const next = yield* browseNext({
            ...continuation,
            includeRaw: options?.includeRaw,
          });
          if (next._tag === "NonGoodStatus") return next;
          references.push(...next.references);
          continuation = next.continuation;
        }
        return {
          _tag: "Browsed" as const,
          nodeId,
          status: first.status,
          references,
        };
      }).pipe(
        Effect.withSpan("opcua.session.browseChildren", {
          attributes: {
            "opcua.node_id": nodeId,
            "opcua.browse_mode": options?.mode ?? "all",
          },
          kind: "client",
        }),
      );

    const readNamespaceArray: OpcuaSession.SessionService["readNamespaceArray"] =
      () => metadata.namespaceArray();

    const readNodeMetadata: OpcuaSession.SessionService["readNodeMetadata"] = (
      nodeId,
    ) => metadata.node(nodeId);

    const readManyNodeMetadata: OpcuaSession.SessionService["readManyNodeMetadata"] =
      (nodeIds) => metadata.nodes(nodeIds);

    const readDataTypeDefinition: OpcuaSession.SessionService["readDataTypeDefinition"] =
      (dataTypeNodeId) =>
        readDataTypeDefinitionImpl(unsafeRaw, metadata, dataTypeNodeId);

    const readManyDataTypeDefinitions: OpcuaSession.SessionService["readManyDataTypeDefinitions"] =
      (dataTypeNodeIds) =>
        readManyDataTypeDefinitionsImpl(unsafeRaw, metadata, dataTypeNodeIds);

    return OpcuaSession.Session.of({
      read,
      write,
      readMany,
      writeMany,
      makeSubscription,
      call,
      callMany,
      browse,
      browseNext,
      releaseBrowseContinuation,
      browseChildren,
      readNamespaceArray,
      readNodeMetadata,
      readManyNodeMetadata,
      readDataTypeDefinition,
      readManyDataTypeDefinitions,
      events: Stream.fromPubSub(events),
      unsafeRaw,
    });
  });
