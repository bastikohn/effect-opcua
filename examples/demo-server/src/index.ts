import {
  DataType,
  OPCUAServer,
  StatusCodes,
  Variant,
  nodesets,
  type AddressSpace,
  type CallMethodResultOptions,
  type CallbackT,
  type ISessionContext,
  type UAMethod,
} from "node-opcua";

export type DemoOpcuaServer = {
  readonly server: OPCUAServer;
  readonly endpointUrl: string;
  readonly stop: () => Promise<void>;
};

export type DemoOpcuaServerOptions = {
  readonly port?: number;
  readonly resourcePath?: string;
};

type MutableValue = {
  value: number | boolean | string | Date | ReadonlyArray<number> | Buffer;
};

export const startDemoOpcuaServer = async (
  options: DemoOpcuaServerOptions = {},
): Promise<DemoOpcuaServer> => {
  const port = options.port ?? 4840;
  const resourcePath = options.resourcePath ?? "/UA/effect-opcua-demo";
  const server = new OPCUAServer({
    port,
    resourcePath,
    nodeset_filename: [nodesets.standard],
    buildInfo: {
      productName: "effect-opcua-demo-server",
      buildNumber: "1",
      buildDate: new Date(),
    },
  });

  await server.initialize();
  installDemoAddressSpace(server.engine.addressSpace!);

  const timer = setInterval(() => {
    const now = Date.now();
    changing.temperature.value = 40 + Math.sin(now / 1_500) * 5;
    changing.axis1Position.value =
      (Number(changing.axis1Position.value) + 1) % 360;
    changing.axis2Position.value =
      (Number(changing.axis2Position.value) + 0.5) % 360;
    changing.highFrequency.value = Number(changing.highFrequency.value) + 1;
  }, 100);
  timer.unref();

  await server.start();

  return {
    server,
    endpointUrl: `opc.tcp://127.0.0.1:${port}${resourcePath}`,
    stop: async () => {
      clearInterval(timer);
      await server.shutdown(1_000);
    },
  };
};

const changing = {
  temperature: { value: 42 },
  axis1Position: { value: 0 },
  axis2Position: { value: 180 },
  highFrequency: { value: 0 },
} satisfies Record<string, MutableValue>;

const installDemoAddressSpace = (addressSpace: AddressSpace) => {
  const namespace = addressSpace.getOwnNamespace();

  const machine = namespace.addObject({
    browseName: "MyMachine",
    nodeId: "s=MyMachine",
    organizedBy: addressSpace.rootFolder.objects,
  });

  const axis1 = namespace.addObject({
    browseName: "Axis1",
    nodeId: "s=MyMachine.Axis1",
    componentOf: machine,
  });
  const axis2 = namespace.addObject({
    browseName: "Axis2",
    nodeId: "s=MyMachine.Axis2",
    componentOf: machine,
  });

  addNumber(
    namespace,
    axis1,
    "Position",
    "s=MyMachine.Axis1.Position",
    changing.axis1Position,
  );
  addNumber(namespace, axis1, "Speed", "s=MyMachine.Axis1.Speed", {
    value: 1000,
  });
  addBoolean(
    namespace,
    axis1,
    "Enabled",
    "s=MyMachine.Axis1.Enabled",
    { value: true },
    true,
  );

  addNumber(
    namespace,
    axis2,
    "Position",
    "s=MyMachine.Axis2.Position",
    changing.axis2Position,
  );
  addNumber(namespace, axis2, "Speed", "s=MyMachine.Axis2.Speed", {
    value: 750,
  });

  addNumber(
    namespace,
    machine,
    "Temperature",
    "s=MyMachine.Temperature",
    changing.temperature,
  );
  addBoolean(namespace, machine, "IsRunning", "s=MyMachine.IsRunning", {
    value: true,
  });
  addNumber(
    namespace,
    machine,
    "SpeedSetpoint",
    "s=MyMachine.SpeedSetpoint",
    { value: 900 },
    true,
  );
  addNumber(
    namespace,
    machine,
    "ReadOnlyNumber",
    "s=MyMachine.ReadOnlyNumber",
    { value: 123 },
  );
  addNumberArray(namespace, machine, "NumberArray", "s=MyMachine.NumberArray", {
    value: [1, 2, 3],
  });
  addDateTime(
    namespace,
    machine,
    "CurrentDateTime",
    "s=MyMachine.CurrentDateTime",
    { value: new Date() },
  );
  addByteString(namespace, machine, "Payload", "s=MyMachine.Payload", {
    value: Buffer.from("effect-opcua"),
  });
  addNumber(
    namespace,
    machine,
    "HighFrequency",
    "s=MyMachine.HighFrequency",
    changing.highFrequency,
  );

  addStartMethod(namespace, machine);
  addResetMethod(namespace, machine);
  addEchoMethod(namespace, machine);
  addRejectIfNegativeMethod(namespace, machine);
  addDisabledCommandMethod(namespace, machine);
  addInvalidArgumentNameMethods(namespace, machine);

  const large = namespace.addObject({
    browseName: "LargeFolder",
    nodeId: "s=MyMachine.LargeFolder",
    componentOf: machine,
  });
  for (let index = 0; index < 50; index++) {
    addNumber(
      namespace,
      large,
      `Item${index}`,
      `s=MyMachine.LargeFolder.Item${index}`,
      {
        value: index,
      },
    );
  }
};

const addNumber = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: unknown,
  browseName: string,
  nodeId: string,
  state: MutableValue,
  writable = false,
) =>
  namespace.addVariable({
    componentOf: parent as never,
    browseName,
    nodeId,
    dataType: "Double",
    accessLevel: writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
    userAccessLevel: writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.Double,
          value: Number(state.value),
        }),
      set: writable
        ? (variant: Variant) => {
            state.value = Number(variant.value);
            return StatusCodes.Good;
          }
        : undefined,
    },
  });

const addBoolean = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: unknown,
  browseName: string,
  nodeId: string,
  state: MutableValue,
  writable = false,
) =>
  namespace.addVariable({
    componentOf: parent as never,
    browseName,
    nodeId,
    dataType: "Boolean",
    accessLevel: writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
    userAccessLevel: writable ? "CurrentRead | CurrentWrite" : "CurrentRead",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.Boolean,
          value: Boolean(state.value),
        }),
      set: writable
        ? (variant: Variant) => {
            state.value = Boolean(variant.value);
            return StatusCodes.Good;
          }
        : undefined,
    },
  });

const addNumberArray = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: unknown,
  browseName: string,
  nodeId: string,
  state: MutableValue,
) =>
  namespace.addVariable({
    componentOf: parent as never,
    browseName,
    nodeId,
    dataType: "Double",
    minimumSamplingInterval: 100,
    valueRank: 1,
    arrayDimensions: [3],
    value: {
      get: () =>
        new Variant({
          dataType: DataType.Double,
          arrayType: 1,
          value: state.value as ReadonlyArray<number>,
        }),
    },
  });

const addDateTime = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: unknown,
  browseName: string,
  nodeId: string,
  state: MutableValue,
) =>
  namespace.addVariable({
    componentOf: parent as never,
    browseName,
    nodeId,
    dataType: "DateTime",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.DateTime,
          value: state.value,
        }),
    },
  });

const addByteString = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: unknown,
  browseName: string,
  nodeId: string,
  state: MutableValue,
) =>
  namespace.addVariable({
    componentOf: parent as never,
    browseName,
    nodeId,
    dataType: "ByteString",
    minimumSamplingInterval: 100,
    value: {
      get: () =>
        new Variant({
          dataType: DataType.ByteString,
          value: state.value,
        }),
    },
  });

const addStartMethod = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  const method = namespace.addMethod(parent, {
    browseName: "Start",
    nodeId: "s=MyMachine.Start",
    inputArguments: [
      { name: "StartSpeed", dataType: DataType.Double },
      { name: "Force", dataType: DataType.Boolean },
    ],
    outputArguments: [
      { name: "Accepted", dataType: DataType.Boolean },
      { name: "JobId", dataType: DataType.String },
    ],
  });
  method.bindMethod(function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
    callback: CallbackT<CallMethodResultOptions>,
  ) {
    void context;
    const speed = Number(inputArguments[0]?.value ?? 0);
    const force = Boolean(inputArguments[1]?.value);
    callback(null, {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({ dataType: DataType.Boolean, value: speed > 0 || force }),
        new Variant({
          dataType: DataType.String,
          value: `job-${Math.trunc(speed)}`,
        }),
      ],
    });
  });
};

const addResetMethod = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  const method = namespace.addMethod(parent, {
    browseName: "Reset",
    nodeId: "s=MyMachine.Reset",
    inputArguments: [],
    outputArguments: [{ name: "Accepted", dataType: DataType.Boolean }],
  });
  method.bindMethod(async function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
  ): Promise<CallMethodResultOptions> {
    void this;
    void inputArguments;
    void context;
    return {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({ dataType: DataType.Boolean, value: true }),
      ],
    };
  });
};

const addEchoMethod = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  const method = namespace.addMethod(parent, {
    browseName: "Echo",
    nodeId: "s=MyMachine.Echo",
    inputArguments: [{ name: "Value", dataType: DataType.String }],
    outputArguments: [{ name: "Value", dataType: DataType.String }],
  });
  method.bindMethod(async function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
  ): Promise<CallMethodResultOptions> {
    void this;
    void context;
    return {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({
          dataType: DataType.String,
          value: String(inputArguments[0]?.value ?? ""),
        }),
      ],
    };
  });
};

const addRejectIfNegativeMethod = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  const method = namespace.addMethod(parent, {
    browseName: "RejectIfNegative",
    nodeId: "s=MyMachine.RejectIfNegative",
    inputArguments: [{ name: "Value", dataType: DataType.Double }],
    outputArguments: [{ name: "Accepted", dataType: DataType.Boolean }],
  });
  method.bindMethod(async function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
  ): Promise<CallMethodResultOptions> {
    void this;
    void context;
    const value = Number(inputArguments[0]?.value ?? 0);
    if (value < 0) {
      return { statusCode: StatusCodes.BadInvalidArgument };
    }
    return {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({ dataType: DataType.Boolean, value: true }),
      ],
    };
  });
};

const addDisabledCommandMethod = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  namespace.addMethod(parent, {
    browseName: "DisabledCommand",
    nodeId: "s=MyMachine.DisabledCommand",
    executable: true,
    inputArguments: [],
    outputArguments: [{ name: "Accepted", dataType: DataType.Boolean }],
  });
};

const addInvalidArgumentNameMethods = (
  namespace: ReturnType<AddressSpace["getOwnNamespace"]>,
  parent: Parameters<typeof namespace.addMethod>[0],
) => {
  const unnamed = namespace.addMethod(parent, {
    browseName: "UnnamedArguments",
    nodeId: "s=MyMachine.UnnamedArguments",
    inputArguments: [
      { name: "", dataType: DataType.String },
      { name: "Named", dataType: DataType.String },
    ],
    outputArguments: [{ name: "Result", dataType: DataType.String }],
  });
  unnamed.bindMethod(async function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
  ): Promise<CallMethodResultOptions> {
    void this;
    void context;
    return {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({
          dataType: DataType.String,
          value: `${inputArguments[0]?.value ?? ""}${inputArguments[1]?.value ?? ""}`,
        }),
      ],
    };
  });

  const duplicate = namespace.addMethod(parent, {
    browseName: "DuplicateArguments",
    nodeId: "s=MyMachine.DuplicateArguments",
    inputArguments: [
      { name: "Value", dataType: DataType.String },
      { name: "Value", dataType: DataType.String },
    ],
    outputArguments: [{ name: "Value", dataType: DataType.String }],
  });
  duplicate.bindMethod(async function (
    this: UAMethod,
    inputArguments: ReadonlyArray<Variant>,
    context: ISessionContext,
  ): Promise<CallMethodResultOptions> {
    void this;
    void context;
    return {
      statusCode: StatusCodes.Good,
      outputArguments: [
        new Variant({
          dataType: DataType.String,
          value: `${inputArguments[0]?.value ?? ""}${inputArguments[1]?.value ?? ""}`,
        }),
      ],
    };
  });
};
