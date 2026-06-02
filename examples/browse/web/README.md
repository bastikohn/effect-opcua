# Effect OPC UA Web HMI Example

This package is a browser HMI reference example for Effect v4, Svelte 5, Vite,
and `@effect-opcua/client`.

## Development

Run the usable HMI in development mode:

```sh
pnpm --filter @effect-opcua/web dev
```

The dev script builds the RPC server, starts it on `127.0.0.1:4123`, and starts
Vite for the browser UI.

## Built Output

Build the server and browser bundles:

```sh
pnpm --filter @effect-opcua/web build
```

Start only the built RPC server:

```sh
pnpm --filter @effect-opcua/web start:rpc
```

`pnpm --filter @effect-opcua/web start` is kept as an alias for `start:rpc`.
The built browser assets are not served by this command; use `pnpm dev` for the
complete local HMI workflow.

## Configuration

Server environment variables:

```sh
EFFECT_OPCUA_WEB_HOST=127.0.0.1
EFFECT_OPCUA_WEB_PORT=4123
EFFECT_OPCUA_WEB_WRITES=enabled
```

Set `EFFECT_OPCUA_WEB_WRITES=disabled` to reject browser write requests at the
server boundary.

Browser/Vite environment variable:

```sh
VITE_EFFECT_OPCUA_RPC_URL=ws://127.0.0.1:4123/rpc
```

## Tracing

The RPC server can export Effect spans over OTLP/HTTP without extra packages.
Set either a base OTLP endpoint or a full traces URL before starting the server:

```sh
EFFECT_OPCUA_WEB_OTLP_ENDPOINT=http://127.0.0.1:4318
# or
EFFECT_OPCUA_WEB_OTLP_TRACES_URL=http://127.0.0.1:4318/v1/traces
```

`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_PROTOCOL`, and
`OTEL_SERVICE_NAME` are also honored. The default protocol is `http/protobuf`;
set `EFFECT_OPCUA_WEB_OTLP_PROTOCOL=http/json` for collectors expecting JSON.

Useful spans include browser RPC calls (`web.rpc.*`), session management
(`web.session.*`), and OPC UA client calls (`opcua.*`).
