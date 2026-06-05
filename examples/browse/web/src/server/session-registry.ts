import {
  OpcuaClient,
  OpcuaError,
  OpcuaSession,
  type OpcuaSessionService,
  type OpcuaSubscription,
  type ReadableVariableDef,
} from "@effect-opcua/client";
import {
  UserTokenType,
  type UserIdentityInfo,
} from "@effect-opcua/client/node-opcua";
import { Context, Effect, Exit, Layer, Scope, Semaphore } from "effect";

import type { ConnectRequest } from "../shared/rpc.js";
import { WebRpcError, type WebRpcErrorCategory } from "../shared/rpc.js";

export type BrowserOpcuaSession = Pick<
  OpcuaSessionService,
  | "browseChildren"
  | "browseNext"
  | "releaseBrowseContinuation"
  | "readNodeMetadata"
  | "readManyNodeMetadata"
  | "readDataTypeDefinition"
  | "read"
  | "write"
  | "makeSubscription"
>;

export type BrowserBrowseContinuation = Parameters<
  BrowserOpcuaSession["browseNext"]
>[0];

export type SessionHandle = {
  readonly session: BrowserOpcuaSession;
  readonly close: Effect.Effect<void>;
};

export type SessionFactoryService = {
  readonly connect: (
    request: ConnectRequest,
  ) => Effect.Effect<SessionHandle, unknown>;
};

export class SessionFactory extends Context.Service<
  SessionFactory,
  SessionFactoryService
>()("@effect-opcua/web/SessionFactory") {
  static readonly live = Layer.succeed(
    SessionFactory,
    SessionFactory.of({
      connect: (request) =>
        Effect.gen(function* () {
          const scope = yield* Scope.make();
          const sessionLayer = OpcuaSession.layer({
            userIdentity: userIdentity(request.auth),
          }).pipe(
            Layer.provide(
              OpcuaClient.layer({
                endpointUrl: request.endpointUrl,
                clientOptions: { endpointMustExist: false },
              }),
            ),
          );
          const context = yield* Layer.build(sessionLayer).pipe(
            Scope.provide(scope),
          );
          const session = Context.get(context, OpcuaSession.OpcuaSession);
          return {
            session,
            close: Scope.close(scope, Exit.void),
          };
        }).pipe(
          Effect.withSpan("opcua.session.open", {
            attributes: {
              "opcua.endpoint_url": request.endpointUrl,
              "opcua.auth": request.auth._tag,
            },
          }),
        ),
    }),
  );
}

export type SessionRegistryService = {
  readonly connect: (
    clientId: number,
    request: ConnectRequest,
  ) => Effect.Effect<BrowserOpcuaSession, WebRpcError>;
  readonly get: (
    clientId: number,
  ) => Effect.Effect<BrowserOpcuaSession, WebRpcError>;
  readonly disconnect: (clientId: number) => Effect.Effect<boolean>;
  readonly cleanup: (clientId: number) => Effect.Effect<void>;
  readonly storeContinuation: (
    clientId: number,
    continuation: BrowserBrowseContinuation,
  ) => Effect.Effect<string, WebRpcError>;
  readonly takeContinuation: (
    clientId: number,
    token: string,
  ) => Effect.Effect<BrowserBrowseContinuation, WebRpcError>;
  readonly releaseContinuation: (
    clientId: number,
    token: string,
  ) => Effect.Effect<boolean, WebRpcError>;
  readonly releaseContinuations: (
    clientId: number,
    nodeId?: string,
  ) => Effect.Effect<void>;
  readonly size: Effect.Effect<number>;
};

type RegistryEntry = {
  readonly session: BrowserOpcuaSession;
  readonly close: Effect.Effect<void>;
  readonly endpointUrl: string;
  readonly continuations: Map<string, BrowserBrowseContinuation>;
};

export class SessionRegistry extends Context.Service<
  SessionRegistry,
  SessionRegistryService
>()("@effect-opcua/web/SessionRegistry") {
  static readonly layer = Layer.effect(
    SessionRegistry,
    Effect.gen(function* () {
      const factory = yield* SessionFactory;
      const lock = yield* Semaphore.make(1);
      const sessions = new Map<number, RegistryEntry>();
      let nextContinuationId = 1;

      const closeExisting = (clientId: number) =>
        Effect.sync(() => sessions.get(clientId)).pipe(
          Effect.flatMap((entry) =>
            entry
              ? releaseEntryContinuations(entry).pipe(
                  Effect.andThen(entry.close),
                  Effect.ignore,
                  Effect.andThen(Effect.sync(() => sessions.delete(clientId))),
                )
              : Effect.void,
          ),
        );

      const missingContinuation = (token: string) =>
        new WebRpcError({
          category: "Session",
          message: "Browse continuation is no longer available",
          operation: "BrowseContinuation",
          nodeId: token,
        });

      return SessionRegistry.of({
        connect: (clientId, request) =>
          lock.withPermit(
            Effect.gen(function* () {
              yield* closeExisting(clientId);
              const handle = yield* factory
                .connect(request)
                .pipe(
                  Effect.mapError((cause) =>
                    rpcError("Connect", undefined, cause),
                  ),
                );
              sessions.set(clientId, {
                ...handle,
                endpointUrl: request.endpointUrl,
                continuations: new Map(),
              });
              return handle.session;
            }).pipe(
              Effect.withSpan("web.session.connect", {
                attributes: {
                  "rpc.client_id": clientId,
                  "opcua.endpoint_url": request.endpointUrl,
                },
              }),
            ),
          ),
        get: (clientId) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            return entry
              ? Effect.succeed(entry.session)
              : Effect.fail(
                  new WebRpcError({
                    category: "Session",
                    message: "No active OPC UA session for this browser tab",
                    operation: "Session",
                  }),
                );
          }),
        disconnect: (clientId) =>
          lock.withPermit(
            Effect.sync(() => sessions.has(clientId)).pipe(
              Effect.tap(() => closeExisting(clientId)),
            ),
          ),
        cleanup: (clientId) => closeExisting(clientId).pipe(Effect.ignore),
        storeContinuation: (clientId, continuation) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            if (!entry) {
              return Effect.fail(
                new WebRpcError({
                  category: "Session",
                  message: "No active OPC UA session for this browser tab",
                  operation: "BrowseContinuation",
                }),
              );
            }
            const token = `c${nextContinuationId++}`;
            entry.continuations.set(token, continuation);
            return Effect.succeed(token);
          }),
        takeContinuation: (clientId, token) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            const continuation = entry?.continuations.get(token);
            if (!entry || !continuation) {
              return Effect.fail(missingContinuation(token));
            }
            entry.continuations.delete(token);
            return Effect.succeed(continuation);
          }),
        releaseContinuation: (clientId, token) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            const continuation = entry?.continuations.get(token);
            if (!entry || !continuation) return Effect.succeed(false);
            entry.continuations.delete(token);
            return entry.session
              .releaseBrowseContinuation(continuation)
              .pipe(Effect.ignore, Effect.as(true));
          }),
        releaseContinuations: (clientId, nodeId) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            return entry
              ? releaseEntryContinuations(entry, nodeId)
              : Effect.void;
          }),
        size: Effect.sync(() => sessions.size),
      });
    }),
  );

  static readonly live = SessionRegistry.layer.pipe(
    Layer.provide(SessionFactory.live),
  );
}

export const rpcError = (
  operation: string,
  nodeId: string | undefined,
  cause: unknown,
) =>
  new WebRpcError({
    category: errorCategory(cause),
    message: safeErrorMessage(cause),
    operation,
    nodeId,
  });

const errorCategory = (cause: unknown): WebRpcErrorCategory => {
  if (cause instanceof WebRpcError) return cause.category;
  if (!OpcuaError.isOpcuaError(cause)) return "Unexpected";
  switch (cause.reason._tag) {
    case "Configuration":
    case "MonitorConfiguration":
    case "AccessDenied":
    case "Encode":
    case "MethodInput":
    case "MethodNotExecutable":
      return "Configuration";
    case "Connect":
    case "Disconnect":
      return "Transport";
    case "SessionCreate":
    case "SessionClose":
      return "Session";
    case "Service":
    case "Decode":
    case "SubscriptionCreate":
    case "MonitorCreate":
    case "MonitorStartup":
    case "MonitorRuntime":
      return "Service";
  }
};

const safeErrorMessage = (cause: unknown): string => {
  if (cause instanceof WebRpcError) return cause.message;
  if (OpcuaError.isOpcuaError(cause)) return opcuaErrorMessage(cause.reason);
  if (cause instanceof Error) return cause.message || cause.name;
  if (typeof cause === "string") return cause;
  return "Unexpected failure";
};

const opcuaErrorMessage = (reason: OpcuaError.OpcuaErrorReason): string => {
  switch (reason._tag) {
    case "Configuration":
    case "MonitorConfiguration":
      return (
        stringCause(reason.cause) ?? `${reason.operation} configuration error`
      );
    case "Service":
      return reason.status?.text ?? `${reason.operation} service error`;
    case "Connect":
      return `Could not connect to ${reason.endpointUrl}`;
    case "Disconnect":
      return "OPC UA disconnect failed";
    case "SessionCreate":
      return "OPC UA session creation failed";
    case "SessionClose":
      return "OPC UA session close failed";
    case "SubscriptionCreate":
      return "OPC UA subscription creation failed";
    case "AccessDenied":
      return `Access denied for ${reason.nodeId}`;
    case "Encode":
      return `Could not encode value for ${reason.nodeId}`;
    case "Decode":
      return `Could not decode value for ${reason.nodeId}`;
    case "MethodInput":
      return `Invalid method input for ${reason.methodId}`;
    case "MethodNotExecutable":
      return `Method ${reason.methodId} is not executable`;
    case "MonitorCreate":
      return "OPC UA monitor creation failed";
    case "MonitorStartup":
      return `OPC UA monitor startup failed for ${reason.nodeId}`;
    case "MonitorRuntime":
      return "OPC UA monitor stream failed";
  }
};

const stringCause = (cause: unknown): string | undefined =>
  typeof cause === "string" && cause.length > 0 ? cause : undefined;

const releaseEntryContinuations = (
  entry: RegistryEntry,
  nodeId?: string,
): Effect.Effect<void> => {
  const continuations = [...entry.continuations.entries()].filter(
    ([, continuation]) =>
      nodeId === undefined || continuation.nodeId === nodeId,
  );
  for (const [token] of continuations) entry.continuations.delete(token);
  return Effect.forEach(
    continuations,
    ([, continuation]) =>
      entry.session.releaseBrowseContinuation(continuation).pipe(Effect.ignore),
    { discard: true },
  );
};

const userIdentity = (auth: ConnectRequest["auth"]): UserIdentityInfo =>
  auth._tag === "UserPassword"
    ? {
        type: UserTokenType.UserName,
        userName: auth.username,
        password: auth.password,
      }
    : { type: UserTokenType.Anonymous };

export type MonitorableSession = Pick<OpcuaSubscription, "monitor">;

export type ReadableVariable = ReadableVariableDef;
