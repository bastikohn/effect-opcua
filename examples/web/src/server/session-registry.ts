import {
  OpcuaClient,
  OpcuaSession,
  type OpcuaSubscription,
  type OpcuaVariable,
} from "@effect-opcua/client";
import { Context, Effect, Exit, Layer, Scope, Semaphore } from "effect";
import { UserTokenType, type UserIdentityInfo } from "node-opcua";

import type { ConnectRequest } from "../shared/rpc.js";
import { WebRpcError } from "../shared/rpc.js";
import { errorMessage, toJsonValue } from "../shared/value.js";

export type BrowserOpcuaSession = Pick<
  OpcuaSession.OpcuaSession,
  | "browseChildren"
  | "readNodeMetadata"
  | "readManyNodeMetadata"
  | "readDataTypeDefinition"
  | "read"
  | "write"
  | "makeSubscription"
>;

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
          const sessionLayer = OpcuaSession.OpcuaSession.layer({
            userIdentity: userIdentity(request.auth),
          }).pipe(
            Layer.provide(
              OpcuaClient.OpcuaClient.layer({
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
        }),
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
  readonly size: Effect.Effect<number>;
};

type RegistryEntry = {
  readonly session: BrowserOpcuaSession;
  readonly close: Effect.Effect<void>;
  readonly endpointUrl: string;
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

      const closeExisting = (clientId: number) =>
        Effect.sync(() => sessions.get(clientId)).pipe(
          Effect.flatMap((entry) =>
            entry
              ? entry.close.pipe(
                  Effect.ignore,
                  Effect.andThen(Effect.sync(() => sessions.delete(clientId))),
                )
              : Effect.void,
          ),
        );

      return SessionRegistry.of({
        connect: (clientId, request) =>
          lock.withPermit(
            Effect.gen(function* () {
              yield* closeExisting(clientId);
              const handle = yield* factory.connect(request).pipe(
                Effect.mapError((cause) =>
                  rpcError("Connect", undefined, cause),
                ),
              );
              sessions.set(clientId, {
                ...handle,
                endpointUrl: request.endpointUrl,
              });
              return handle.session;
            }),
          ),
        get: (clientId) =>
          Effect.suspend(() => {
            const entry = sessions.get(clientId);
            return entry
              ? Effect.succeed(entry.session)
              : Effect.fail(
                  new WebRpcError({
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
    message: errorMessage(cause),
    operation,
    nodeId,
    cause: toJsonValue(cause),
  });

const userIdentity = (auth: ConnectRequest["auth"]): UserIdentityInfo =>
  auth._tag === "UserPassword"
    ? {
        type: UserTokenType.UserName,
        userName: auth.username,
        password: auth.password,
      }
    : { type: UserTokenType.Anonymous };

export type MonitorableSession = Pick<
  OpcuaSubscription.OpcuaSubscription,
  "monitor"
>;

export type ReadableVariable = OpcuaVariable.ReadableVariableDef;
