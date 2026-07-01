---
"@effect-opcua/client": patch
---

Fix decoding of numeric array and Int64/UInt64 values. Typed-array variant
values (Float64Array, Int32Array, ...) now decode to plain arrays for both
dynamic and schema codecs, and Int64/UInt64 values arriving as [high, low]
pairs normalize to their tagged text representation instead of raw pairs.
