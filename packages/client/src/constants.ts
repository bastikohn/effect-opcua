import { BrowseDirection, makeResultMask } from "node-opcua";

export const EVENT_BUFFER_SIZE = 256;
export const DEFAULT_LIFETIME_COUNT = 60;
export const DEFAULT_MAX_KEEP_ALIVE_COUNT = 10;
export const DEFAULT_MAX_NOTIFICATIONS_PER_PUBLISH = 0;
export const DEFAULT_PUBLISHING_ENABLED = true;
export const DEFAULT_PRIORITY = 0;
export const DEFAULT_BROWSE_REFERENCE_TYPE_ID = "HierarchicalReferences";
export const DEFAULT_BROWSE_DIRECTION = BrowseDirection.Forward;
export const DEFAULT_BROWSE_INCLUDE_SUBTYPES = true;
export const DEFAULT_BROWSE_NODE_CLASS_MASK = 0;
export const DEFAULT_BROWSE_RESULT_MASK = makeResultMask(
  "ReferenceType | IsForward | NodeClass | BrowseName | DisplayName | TypeDefinition",
);
export const DEFAULT_BROWSE_MAX_REFERENCES_PER_NODE = 0;
