import { describe, expect, it } from "vitest";
import { Duration, Effect, Layer, Schema, Scope, Stream } from "effect";
import {
  BrowseDirection,
  NodeClass,
  NodeId,
  NodeIdType,
  StatusCodes,
  makeResultMask,
  type BrowseDescriptionOptions,
  type BrowseResult,
} from "node-opcua";

import {
  BrowseDirection as ExportedBrowseDirection,
  Capabilities,
  ClientBufferPolicy,
  MonitorValueDeadband,
  MonitorValueFilter,
  OpcuaClient,
  OpcuaConfigurationError,
  OpcuaNonGoodStatusError,
  OpcuaServiceError,
  OpcuaSession,
  capabilities,
  makeResultMask as exportedMakeResultMask,
} from "../src/index.js";

const endpointUrl =
  process.env.OPCUA_TEST_ENDPOINT_URL ?? "opc.tcp://192.168.100.166:4842";
const testIfEndpoint = endpointUrl ? it : it.skip;

const serverStatusNodeId = "ns=0;i=2256";
const currentTimeNodeId = "ns=0;i=2258";
const secondsTillShutdownNodeId = "ns=0;i=2259";

const makeLiveLayer = () =>
  OpcuaSession.layer().pipe(
    Layer.provideMerge(OpcuaClient.layer({ endpointUrl: endpointUrl! })),
  );

const runLive = <A, E>(
  effect: Effect.Effect<A, E, OpcuaSession | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(makeLiveLayer()),
      Effect.timeout("10 seconds"),
    ),
  );

type FakeRawSession = {
  requestedMaxReferencesPerNode: number;
  browse: (input: unknown) => Promise<BrowseResult>;
  browseNext: (
    continuation: unknown,
    release: boolean,
  ) => Promise<BrowseResult>;
  close: (deleteSubscriptions: boolean) => Promise<void>;
  on: (event: string, handler: (...args: Array<unknown>) => void) => unknown;
};

const runWithRawSession = <A, E>(
  rawSession: FakeRawSession,
  effect: Effect.Effect<A, E, OpcuaSession | Scope.Scope>,
) =>
  Effect.runPromise(
    Effect.scoped(effect).pipe(
      Effect.provide(OpcuaSession.layer()),
      Effect.provideService(OpcuaClient, {
        events: Stream.empty,
        raw: {
          createSession: async () => rawSession,
        } as never,
      }),
    ),
  );

const goodBrowseResult = (options: Partial<BrowseResult> = {}): BrowseResult =>
  ({
    statusCode: StatusCodes.Good,
    references: [],
    continuationPoint: undefined,
    ...options,
  }) as BrowseResult;

const fakeSession = (overrides: Partial<FakeRawSession> = {}) =>
  ({
    requestedMaxReferencesPerNode: 10000,
    browse: async () => goodBrowseResult(),
    browseNext: async () => goodBrowseResult(),
    close: async () => undefined,
    on: () => undefined,
    ...overrides,
  }) as FakeRawSession;

describe("capabilities", () => {
  it("returns the provided capabilities without widening the value", () => {
    expect(capabilities("read", "write")).toEqual(["read", "write"]);
  });

  it("exposes common capability presets", () => {
    expect(Capabilities.read).toEqual(["read"]);
    expect(Capabilities.write).toEqual(["write"]);
    expect(Capabilities.readWrite).toEqual(["read", "write"]);
  });
});

describe("client options", () => {
  it("builds buffer policies", () => {
    expect(ClientBufferPolicy.latest()).toEqual({
      _tag: "Sliding",
      capacity: 1,
    });
    expect(ClientBufferPolicy.sliding(3)).toEqual({
      _tag: "Sliding",
      capacity: 3,
    });
    expect(ClientBufferPolicy.dropping(2)).toEqual({
      _tag: "Dropping",
      capacity: 2,
    });
  });

  it("builds monitor filters", () => {
    expect(MonitorValueDeadband.none()).toEqual({ _tag: "None" });
    expect(MonitorValueDeadband.absolute(0.5)).toEqual({
      _tag: "Absolute",
      value: 0.5,
    });
    expect(MonitorValueDeadband.percent(10)).toEqual({
      _tag: "Percent",
      value: 10,
    });
    expect(MonitorValueFilter.none()).toEqual({ _tag: "None" });
    expect(MonitorValueFilter.status()).toEqual({ _tag: "Status" });
    expect(
      MonitorValueFilter.statusValue(MonitorValueDeadband.absolute(1)),
    ).toEqual({
      _tag: "StatusValue",
      deadband: { _tag: "Absolute", value: 1 },
    });
    expect(MonitorValueFilter.statusValueTimestamp()).toEqual({
      _tag: "StatusValueTimestamp",
      deadband: { _tag: "None" },
    });
  });
});

describe("browse", () => {
  it("uses default hierarchical forward browse options", async () => {
    let request: BrowseDescriptionOptions | undefined;
    let maxReferencesPerNode: number | undefined;
    const raw = fakeSession({
      browse: async (input) => {
        request = input as BrowseDescriptionOptions;
        maxReferencesPerNode = raw.requestedMaxReferencesPerNode;
        return goodBrowseResult();
      },
    });

    await runWithRawSession(
      raw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({ nodeId: "ObjectsFolder" });
      }),
    );

    expect(request?.nodeId?.toString()).toBe("ns=0;i=85");
    expect(request?.referenceTypeId?.toString()).toBe("ns=0;i=33");
    expect(request?.browseDirection).toBe(BrowseDirection.Forward);
    expect(request?.includeSubtypes).toBe(true);
    expect(request?.nodeClassMask).toBe(0);
    expect(request?.resultMask).toBe(
      makeResultMask(
        "ReferenceType | IsForward | NodeClass | BrowseName | DisplayName | TypeDefinition",
      ),
    );
    expect(maxReferencesPerNode).toBe(0);
    expect(raw.requestedMaxReferencesPerNode).toBe(10000);
  });

  it("returns normalized browse results and continuations", async () => {
    const continuationPoint = Buffer.from("next");
    const rawReference = {
      nodeId: new NodeId(NodeIdType.STRING, "Child", 2),
      referenceTypeId: new NodeId(NodeIdType.NUMERIC, 35, 0),
      isForward: true,
      nodeClass: NodeClass.Variable,
      browseName: {
        namespaceIndex: 2,
        name: "Child",
        toString: () => "2:Child",
      },
      displayName: { text: "Child display", locale: "en" },
      typeDefinition: new NodeId(NodeIdType.NUMERIC, 63, 0),
    };
    const raw = fakeSession({
      browse: async () =>
        goodBrowseResult({
          references: [rawReference],
          continuationPoint,
        } as Partial<BrowseResult>),
    });

    const result = await runWithRawSession(
      raw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({ nodeId: "ObjectsFolder" });
      }),
    );

    expect(result.nodeId).toBe("ObjectsFolder");
    expect(result.statusCode).toBe(StatusCodes.Good);
    expect(result.references).toHaveLength(1);
    expect(result.references[0]).toMatchObject({
      nodeId: {
        text: "ns=2;s=Child",
        namespace: 2,
        value: "Child",
      },
      referenceTypeId: "ns=0;i=35",
      isForward: true,
      nodeClass: NodeClass.Variable,
      browseName: {
        namespaceIndex: 2,
        name: "Child",
        text: "2:Child",
      },
      displayName: {
        text: "Child display",
        locale: "en",
      },
      typeDefinition: {
        text: "ns=0;i=63",
      },
    });
    expect(result.continuation).toEqual({
      nodeId: "ObjectsFolder",
      raw: continuationPoint,
    });
  });

  it("keeps references as an array and leaves masked fields undefined", async () => {
    const emptyRaw = fakeSession({
      browse: async () =>
        goodBrowseResult({ references: undefined } as Partial<BrowseResult>),
    });
    const emptyResult = await runWithRawSession(
      emptyRaw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({ nodeId: "ObjectsFolder" });
      }),
    );
    expect(emptyResult.references).toEqual([]);

    const maskedRaw = fakeSession({
      browse: async () =>
        goodBrowseResult({
          references: [
            {
              nodeId: new NodeId(NodeIdType.NUMERIC, 1, 0),
            },
          ],
        } as Partial<BrowseResult>),
    });

    const result = await runWithRawSession(
      maskedRaw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({
          nodeId: "ObjectsFolder",
          resultMask: makeResultMask("NodeId"),
        });
      }),
    );

    expect(Array.isArray(result.references)).toBe(true);
    expect(result.references[0]?.browseName).toBeUndefined();
    expect(result.references[0]?.displayName).toBeUndefined();
    expect(result.references[0]?.referenceTypeId).toBeUndefined();
  });

  it("honors custom result masks exactly", async () => {
    let request: BrowseDescriptionOptions | undefined;
    const customMask = makeResultMask("BrowseName");
    const raw = fakeSession({
      browse: async (input) => {
        request = input as BrowseDescriptionOptions;
        return goodBrowseResult();
      },
    });

    await runWithRawSession(
      raw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browse({
          nodeId: "ObjectsFolder",
          resultMask: customMask,
        });
      }),
    );

    expect(request?.resultMask).toBe(customMask);
  });

  it("fails non-good status and rejected browse calls", async () => {
    const nonGoodRaw = fakeSession({
      browse: async () =>
        goodBrowseResult({ statusCode: StatusCodes.BadNodeIdUnknown }),
    });
    await expect(
      runWithRawSession(
        nonGoodRaw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: "ns=1;s=missing" });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaNonGoodStatusError);

    const serviceRaw = fakeSession({
      browse: async () => {
        throw new Error("browse failed");
      },
    });
    await expect(
      runWithRawSession(
        serviceRaw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: "ObjectsFolder" });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaServiceError);
  });

  it("validates browse inputs before calling node-opcua", async () => {
    let called = false;
    const raw = fakeSession({
      browse: async () => {
        called = true;
        return goodBrowseResult();
      },
    });

    await expect(
      runWithRawSession(
        raw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({ nodeId: " " });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runWithRawSession(
        raw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browse({
            nodeId: "ObjectsFolder",
            maxReferencesPerNode: -1,
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);
    expect(called).toBe(false);
  });

  it("uses browseNext continuations and can release them", async () => {
    const firstContinuation = Buffer.from("first");
    const secondContinuation = Buffer.from("second");
    const calls: Array<{ raw: Buffer; release: boolean }> = [];
    const raw = fakeSession({
      browseNext: async (continuation, release) => {
        calls.push({ raw: continuation as Buffer, release });
        return goodBrowseResult({
          references: [],
          continuationPoint: release ? undefined : secondContinuation,
        });
      },
    });

    const next = await runWithRawSession(
      raw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.browseNext({
          nodeId: "ObjectsFolder",
          raw: firstContinuation,
        });
      }),
    );
    const released = await runWithRawSession(
      raw,
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        return yield* session.releaseBrowseContinuation({
          nodeId: "ObjectsFolder",
          raw: secondContinuation,
        });
      }),
    );

    expect(next.nodeId).toBe("ObjectsFolder");
    expect(next.continuation).toEqual({
      nodeId: "ObjectsFolder",
      raw: secondContinuation,
    });
    expect(released).toBeUndefined();
    expect(calls).toEqual([
      { raw: firstContinuation, release: false },
      { raw: secondContinuation, release: true },
    ]);
  });

  it("validates continuations and fails release non-good status", async () => {
    const raw = fakeSession({
      browseNext: async () =>
        goodBrowseResult({
          statusCode: StatusCodes.BadContinuationPointInvalid,
        }),
    });

    await expect(
      runWithRawSession(
        raw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.browseNext({
            nodeId: "ObjectsFolder",
            raw: Buffer.alloc(0),
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaConfigurationError);

    await expect(
      runWithRawSession(
        raw,
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.releaseBrowseContinuation({
            nodeId: "ObjectsFolder",
            raw: Buffer.from("bad"),
          });
        }),
      ),
    ).rejects.toBeInstanceOf(OpcuaNonGoodStatusError);
  });

  it("re-exports browse helpers from the package entrypoint", () => {
    expect(ExportedBrowseDirection.Forward).toBe(BrowseDirection.Forward);
    expect(exportedMakeResultMask("BrowseName")).toBe(
      makeResultMask("BrowseName"),
    );
  });
});

describe("browse (integration)", () => {
  it("browses well-known address space nodes", async () => {
    const result = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const page1 = yield* session.browse({
          nodeId: "RootFolder",
          maxReferencesPerNode: 10,
        });
        const page2 = page1.continuation
          ? yield* session.browseNext(page1.continuation)
          : undefined;

        if (page2?.continuation) {
          yield* session.releaseBrowseContinuation(page2.continuation);
        }

        return { page1, page2 };
      }),
    );

    console.dir({ result }, { depth: null });
    expect(result.page1).toMatchObject({
      nodeId: "RootFolder",
      statusCode: StatusCodes.Good,
    });
    expect(result.page1.references.length).toBeGreaterThan(0);
    expect(result.page1.references[0]).toMatchObject({
      nodeClass: NodeClass.Object,
      browseName: {
        text: expect.any(String),
      },
      nodeId: {
        text: expect.any(String),
      },
    });

    if (result.page1.continuation) {
      expect(result.page2).toBeDefined();
      expect(result.page2).toMatchObject({
        nodeId: "RootFolder",
        statusCode: StatusCodes.Good,
      });
    }
  }, 20_000);
});

describe("reading (integration)", () => {
  testIfEndpoint(
    "reads well-known server nodes",
    async () => {
      const values = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          return yield* session.readValues([
            { nodeId: currentTimeNodeId, schema: Schema.Date },
            { nodeId: secondsTillShutdownNodeId, schema: Schema.Number },
          ]);
        }),
      );

      expect(Object.keys(values)).toEqual([
        currentTimeNodeId,
        secondsTillShutdownNodeId,
      ]);
      expect(values[currentTimeNodeId]).toMatchObject({
        _tag: "Value",
        nodeId: currentTimeNodeId,
        value: expect.any(Date),
      });
      expect(values[secondsTillShutdownNodeId]).toMatchObject({
        _tag: "Value",
        nodeId: secondsTillShutdownNodeId,
        value: expect.any(Number),
      });
    },
    20_000,
  );

  it("rejects duplicate node ids before calling the server", async () => {
    const program = Effect.gen(function* () {
      const session = yield* OpcuaSession;
      return yield* session.readValues([
        { nodeId: serverStatusNodeId, schema: Schema.Unknown },
        { nodeId: serverStatusNodeId, schema: Schema.Unknown },
      ]);
    }).pipe(
      Effect.provideService(OpcuaSession, {
        readValue: () => Effect.die("not implemented"),
        readValues: (specs) =>
          Effect.fail({
            _tag: "OpcuaConfigurationError" as const,
            operation: "readValues",
            nodeId: specs[1]?.nodeId,
            cause: "Duplicate nodeId",
          } as never),
        valueHandle: () => Effect.die("not implemented"),
        writeValues: () => Effect.die("not implemented"),
        createSubscription: () => Effect.die("not implemented"),
        browse: () => Effect.die("not implemented"),
        browseNext: () => Effect.die("not implemented"),
        releaseBrowseContinuation: () => Effect.die("not implemented"),
        events: Stream.empty,
        raw: {} as never,
      }),
      Effect.flip,
    );

    await expect(Effect.runPromise(program)).resolves.toMatchObject({
      _tag: "OpcuaConfigurationError",
      operation: "readValues",
      nodeId: serverStatusNodeId,
      cause: "Duplicate nodeId",
    });
  });
});

describe("subscriptions (integration)", () => {
  testIfEndpoint(
    "publishes MonitorItemsCreated for all requested node ids",
    async () => {
      const nodeIds = [currentTimeNodeId, secondsTillShutdownNodeId] as const;
      const events = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(250),
          });
          yield* subscription
            .monitorValues(
              [
                { nodeId: nodeIds[0], schema: Schema.Date },
                { nodeId: nodeIds[1], schema: Schema.Number },
              ],
              {
                samplingInterval: Duration.millis(250),
                queueSize: 1,
                discardOldest: true,
                clientBuffer: ClientBufferPolicy.latest(),
              },
            )
            .pipe(
              Stream.runDrain,
              Effect.forkScoped({ startImmediately: true }),
            );
          return yield* subscription.events.pipe(
            Stream.filter((event) => event._tag === "MonitorItemsCreated"),
            Stream.take(1),
            Stream.runCollect,
          );
        }),
      );

      expect(events[0]).toMatchObject({
        _tag: "MonitorItemsCreated",
        nodeIds: [...nodeIds],
      });
    },
    20_000,
  );

  it("value batching", async () => {
    const nodeIds = [currentTimeNodeId, secondsTillShutdownNodeId] as const;
    const values = await runLive(
      Effect.gen(function* () {
        const session = yield* OpcuaSession;
        const subscription = yield* session.createSubscription({
          publishingInterval: Duration.millis(500),
        });

        return yield* subscription
          .monitorValues(
            [
              { nodeId: nodeIds[0], schema: Schema.Date },
              { nodeId: nodeIds[1], schema: Schema.Number },
            ],
            {
              samplingInterval: Duration.millis(50),
              queueSize: 1,
              discardOldest: true,
              clientBuffer: ClientBufferPolicy.latest(),
            },
          )
          .pipe(Stream.take(5), Stream.runCollect);
      }),
    );
    expect(values).toHaveLength(5);
  }, 20_000);

  testIfEndpoint(
    "decodes monitored values with the requested schema",
    async () => {
      const values = await runLive(
        Effect.gen(function* () {
          const session = yield* OpcuaSession;
          const subscription = yield* session.createSubscription({
            publishingInterval: Duration.millis(500),
          });
          return yield* subscription
            .monitorValues(
              [{ nodeId: currentTimeNodeId, schema: Schema.Date }],
              {
                samplingInterval: Duration.millis(100),
                queueSize: 5,
                discardOldest: false,
                clientBuffer: ClientBufferPolicy.latest(),
              },
            )
            .pipe(Stream.take(5), Stream.runCollect);
        }),
      );

      expect(values).toHaveLength(5);
      expect(values).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            _tag: "Value",
            nodeId: currentTimeNodeId,
            value: expect.any(Date),
          }),
        ]),
      );
    },
    20_000,
  );
});
