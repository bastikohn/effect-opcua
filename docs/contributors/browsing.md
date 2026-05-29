# Browsing

Browsing is session-based rather than definition-based because browse targets
are discovery inputs, not predeclared variable or method definitions.

## browse

`session.browse(input)` and `OpcuaSession.browse(input)` accept:

- `nodeId`
- optional `referenceTypeId`
- optional `browseDirection`
- optional `includeSubtypes`
- optional `nodeClassMask`
- optional `resultMask`
- optional `maxReferencesPerNode`
- optional `includeRaw`

Defaults come from `internal/constants.ts`.

Validation rejects empty `nodeId` values and non-integer or negative
`maxReferencesPerNode` values.

Implementation detail: node-opcua stores `requestedMaxReferencesPerNode` on the
session. The wrapper sets it for the browse call and restores the previous value
in a `finally` block. Browse calls are guarded by a one-permit semaphore so
concurrent browse operations do not race on that mutable session field.

## Results

Good browse responses return:

- `_tag: "Browsed"`
- normalized status
- normalized references
- optional continuation
- optional raw result

Non-good browse responses return `_tag: "NonGoodStatus"` as data.

References normalize node ids, browse names, display names, node class, type
definition, reference type, and direction. Raw references are included only when
`includeRaw` is true.

## Continuations

`browseNext(continuation)` fetches the next page.

`releaseBrowseContinuation(continuation)` releases the server continuation
point without returning references.

Continuation validation rejects empty continuation node ids and empty raw
continuation buffers.

## browseChildren

`browseChildren(nodeId, options)` is a convenience helper around `browse`:

- `mode: "all"` follows continuations until exhausted.
- `mode: "page"` returns only the first page and its continuation.

It uses child-oriented browse defaults but allows reference type, subtype,
node-class, page-size, and raw-result options.

Relevant tests:

- `packages/client/test/browse.test.ts`
- `packages/client/test/exports.test.ts`
