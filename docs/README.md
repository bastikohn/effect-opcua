# effect-opcua documentation

This directory has two tracks:

- User docs explain how to use the library with small examples.
- Contributor docs explain how each feature works internally and where its tests
  live.

## User docs

- [Getting started](users/getting-started.md): install, connect, and run the
  first program.
- [Code generation](users/codegen.md): generate NodeIds, variables, enums, and
  structures from an OPC UA server.
- [Core concepts](users/core-concepts.md): definitions, codecs, layers, result
  shapes, and raw access.
- [Recipes](users/recipes.md): common read, write, method, monitor, browse, and
  structure tasks.
- [Demo](users/demo.md): run the demo server, demo client, and TUI.

## Contributor docs

- [Architecture](contributors/architecture.md)
- [Client and session lifecycle](contributors/client-session.md)
- [Variables and codecs](contributors/variables-codecs.md)
- [Batch operations](contributors/batch-operations.md)
- [Methods](contributors/methods.md)
- [Monitoring](contributors/monitoring.md)
- [Browsing](contributors/browsing.md)
- [Errors and events](contributors/errors-events.md)
- [Demo machine](contributors/demo-machine.md)
- [Testing](contributors/testing.md)
