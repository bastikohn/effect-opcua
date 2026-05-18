export type NodeIdString = string;
export type ExpandedNodeIdString = string;
export type Capability = "read" | "write" | "call";
export type CapabilitySet = ReadonlyArray<Capability>;

export const capabilities = <
  const Capabilities extends ReadonlyArray<Capability>,
>(
  ...capabilities: Capabilities
): Capabilities => capabilities;

export const Capabilities = {
  read: capabilities("read"),
  write: capabilities("write"),
  call: capabilities("call"),
  readWrite: capabilities("read", "write"),
  readCall: capabilities("read", "call"),
  writeCall: capabilities("write", "call"),
  readWriteCall: capabilities("read", "write", "call"),
} as const;
