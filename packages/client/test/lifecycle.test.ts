import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ClientSubscription,
  OPCUAClient,
  type ClientSession,
  type ClientSubscription as RawClientSubscription,
} from "node-opcua";
import {
  Context,
  Duration,
  Effect,
  Exit,
  Fiber,
  Layer,
  Scope,
  Stream,
} from "effect";

import { OpcuaClient, OpcuaError, OpcuaSession } from "@effect-opcua/client";
import { makeFakeSession } from "./support/fake-session.js";

const deferred = <A = void>() => {
  let resolve!: (value: A) => void;
  const promise = new Promise<A>((resume) => {
    resolve = resume;
  });
  return { promise, resolve };
};

const fakeRawClient = (overrides?: {
  readonly connect?: () => Promise<void>;
  readonly disconnect?: () => Promise<void>;
}) => {
  let disconnects = 0;
  const raw = Object.assign(new EventEmitter(), {
    connect: overrides?.connect ?? (async () => undefined),
    disconnect:
      overrides?.disconnect ??
      (async () => {
        disconnects++;
      }),
  }) as unknown as OPCUAClient;
  return { raw, disconnects: () => disconnects };
};

const fakeRawSession = (onClose?: () => void) =>
  Object.assign(new EventEmitter(), {
    close: async () => {
      onClose?.();
    },
  }) as unknown as ClientSession & EventEmitter;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("lifecycle", () => {
  it("disconnects the raw client when the client layer scope closes", async () => {
    const fake = fakeRawClient();
    vi.spyOn(OPCUAClient, "create").mockReturnValue(fake.raw);

    const scope = await Effect.runPromise(Scope.make());
    const context = await Effect.runPromise(
      Layer.build(
        OpcuaClient.layer({
          endpointUrl: "opc.tcp://localhost:4840",
          clientOptions: { endpointMustExist: false },
        }),
      ).pipe(Scope.provide(scope)),
    );
    const client = Context.get(context, OpcuaClient.OpcuaClient);
    const events = await Effect.runPromise(
      client.events.pipe(
        Stream.take(1),
        Stream.runCollect,
        Effect.timeout(Duration.seconds(1)),
      ),
    );

    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(events[0]).toEqual({
      _tag: "Connected",
      endpointUrl: "opc.tcp://localhost:4840",
    });
    expect(fake.disconnects()).toBe(1);
  });

  it("maps raw client construction failures to OpcuaError", async () => {
    const cause = new Error("invalid options");
    vi.spyOn(OPCUAClient, "create").mockImplementation(() => {
      throw cause;
    });
    const scope = await Effect.runPromise(Scope.make());

    const error = await Effect.runPromise(
      Layer.build(
        OpcuaClient.layer({
          endpointUrl: "opc.tcp://localhost:4840",
          clientOptions: { endpointMustExist: false },
        }),
      ).pipe(Scope.provide(scope), Effect.flip),
    );
    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(OpcuaError.isOpcuaError(error)).toBe(true);
    expect(OpcuaError.isOpcuaError(error) && error.reason).toEqual({
      _tag: "Connect",
      endpointUrl: "opc.tcp://localhost:4840",
      cause,
    });
  });

  it("disconnects if connect is interrupted and later resolves", async () => {
    const connectStarted = deferred();
    const releaseConnect = deferred();
    let disconnects = 0;
    const fake = fakeRawClient({
      connect: async () => {
        connectStarted.resolve();
        await releaseConnect.promise;
      },
      disconnect: async () => {
        disconnects++;
      },
    });
    vi.spyOn(OPCUAClient, "create").mockReturnValue(fake.raw);

    const scope = await Effect.runPromise(Scope.make());
    const fiber = Effect.runFork(
      Layer.build(
        OpcuaClient.layer({
          endpointUrl: "opc.tcp://localhost:4840",
          clientOptions: { endpointMustExist: false },
        }),
      ).pipe(Scope.provide(scope)),
    );

    await connectStarted.promise;
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
    releaseConnect.resolve();
    await interrupted;
    await new Promise((resolve) => setImmediate(resolve));
    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(disconnects).toBe(1);
  });

  it("closes the raw session when the session layer scope closes", async () => {
    let closes = 0;
    const rawSession = fakeRawSession(() => {
      closes++;
    });
    const rawClient = {
      createSession: async () => rawSession,
    };
    const client: OpcuaClient.Service = {
      events: Stream.empty,
      unsafeRaw: rawClient as never,
    };
    const scope = await Effect.runPromise(Scope.make());
    const sessionLayer = OpcuaSession.layer().pipe(
      Layer.provide(Layer.succeed(OpcuaClient.OpcuaClient, client)),
    );

    const context = await Effect.runPromise(
      Layer.build(sessionLayer).pipe(Scope.provide(scope)),
    );
    const session = Context.get(context, OpcuaSession.OpcuaSession);
    const events = Effect.runFork(Stream.runDrain(session.events));

    await Effect.runPromise(Scope.close(scope, Exit.void));
    await Effect.runPromise(
      Fiber.join(events).pipe(Effect.timeout("1 second")),
    );

    expect(closes).toBe(1);
  });

  it("closes a late-created raw session after session creation is interrupted", async () => {
    const createStarted = deferred();
    const releaseCreate = deferred();
    const closed = deferred();
    let closes = 0;
    const rawSession = fakeRawSession(() => {
      closes++;
      closed.resolve();
    });
    const rawClient = {
      createSession: async () => {
        createStarted.resolve();
        await releaseCreate.promise;
        return rawSession;
      },
    };
    const client: OpcuaClient.Service = {
      events: Stream.empty,
      unsafeRaw: rawClient as never,
    };
    const scope = await Effect.runPromise(Scope.make());
    const sessionLayer = OpcuaSession.layer().pipe(
      Layer.provide(Layer.succeed(OpcuaClient.OpcuaClient, client)),
    );

    const fiber = Effect.runFork(
      Layer.build(sessionLayer).pipe(Scope.provide(scope)),
    );

    await createStarted.promise;
    const interrupted = Effect.runPromise(Fiber.interrupt(fiber));
    releaseCreate.resolve();
    await closed.promise;
    await interrupted;
    await Effect.runPromise(Scope.close(scope, Exit.void));

    expect(closes).toBe(1);
  });

  it("terminates subscriptions and shuts down subscription event streams on scope close", async () => {
    let terminates = 0;
    const rawSubscription = Object.assign(new EventEmitter(), {
      subscriptionId: 123,
      terminate: async () => {
        terminates++;
      },
    }) as unknown as RawClientSubscription;
    vi.spyOn(ClientSubscription, "create").mockReturnValue(rawSubscription);

    const scope = await Effect.runPromise(Scope.make());
    const subscription = await Effect.runPromise(
      Effect.gen(function* () {
        const fake = yield* makeFakeSession();
        return yield* fake.session.makeSubscription({
          publishingInterval: Duration.millis(100),
        });
      }).pipe(Scope.provide(scope)),
    );
    const events = Effect.runFork(Stream.runDrain(subscription.events));

    await Effect.runPromise(Scope.close(scope, Exit.void));
    await Effect.runPromise(
      Fiber.join(events).pipe(Effect.timeout("1 second")),
    );

    expect(terminates).toBe(1);
  });
});
