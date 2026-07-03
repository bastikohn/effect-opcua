# @effect-opcua/client

## 0.1.0-alpha.2

### Patch Changes

- 207c139: Bump the required `effect` peer dependency to `4.0.0-beta.92` (from `beta.79`).
  `@effect-opcua/codegen` also moves its `@effect/platform-node` dependency to
  `4.0.0-beta.92`. Effect versions are now managed through a pnpm catalog.

## 0.1.0-alpha.1

### Patch Changes

- 11e5a42: Fix decoding of numeric array and Int64/UInt64 values. Typed-array variant
  values (Float64Array, Int32Array, ...) now decode to plain arrays for both
  dynamic and schema codecs, and Int64/UInt64 values arriving as [high, low]
  pairs normalize to their tagged text representation instead of raw pairs.
- f1064d3: Hide the internal session construction helper from the root session namespace.
