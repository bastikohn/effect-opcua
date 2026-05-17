export type NodeIdString = string;
export type ExpandedNodeIdString = string;
export type Capability = "read" | "write";
export type CapabilitySet = ReadonlyArray<Capability>;

export const capabilities = <
  const Capabilities extends ReadonlyArray<Capability>,
>(
  ...capabilities: Capabilities
): Capabilities => capabilities;

export const Capabilities = {
  read: capabilities("read"),
  write: capabilities("write"),
  readWrite: capabilities("read", "write"),
} as const;
