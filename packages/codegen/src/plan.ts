import { Effect, Layer, Scope } from "effect";
import { OpcuaClient, OpcuaSession } from "@effect-opcua/client";
import type { OpcuaError } from "@effect-opcua/client/OpcuaError";

import { compile } from "./compile.js";
import { enforceIssuePolicy } from "./diagnostics.js";
import { discover } from "./discover.js";
import { emit } from "./emit.js";
import type {
  CodegenPlan,
  DiscoveryModel,
  NormalizedCodegenConfig,
} from "./types.js";

export const planFromDiscovery = (
  config: NormalizedCodegenConfig,
  discovery: DiscoveryModel,
): Effect.Effect<CodegenPlan, import("./errors.js").CodegenError> =>
  Effect.gen(function* () {
    const model = yield* compile(config, discovery);
    const issues = yield* enforceIssuePolicy(
      config.diagnostics.warningsAsErrors,
      model.issues,
    );
    return {
      model,
      files: emit(model),
      issues,
    };
  });

export const discoverFromServer = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  DiscoveryModel,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  discover(config).pipe(
    Effect.provide(
      OpcuaSession.layer({
        userIdentity: config.userIdentity,
      }).pipe(
        Layer.provideMerge(
          OpcuaClient.layer({
            endpointUrl: config.endpointUrl,
            clientOptions: config.clientOptions,
          }),
        ),
      ),
    ),
  );

export const planFromServer = (
  config: NormalizedCodegenConfig,
): Effect.Effect<
  CodegenPlan,
  import("./errors.js").CodegenError | OpcuaError,
  Scope.Scope
> =>
  Effect.gen(function* () {
    const discovery = yield* discoverFromServer(config);
    return yield* planFromDiscovery(config, discovery);
  });
