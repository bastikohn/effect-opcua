import type { BrowseReference, MonitorSample, StatusInfo } from "../shared/rpc.js";

export type AuthMode = "Anonymous" | "UserPassword";

export type TreeNode = {
  nodeId: string;
  label: string;
  nodeClass?: string;
  metadata?: BrowseReference["metadata"];
  expanded: boolean;
  loading: boolean;
  loaded: boolean;
  browseStatus?: StatusInfo;
  browseRequestId?: number;
  continuationToken?: string;
  children: TreeNode[];
};

export type LogRow = {
  id: number;
  time: string;
  level: "info" | "error";
  message: string;
};

export type MonitorRow = {
  nodeId: string;
  label: string;
  monitorStatus: "Desired" | "Accepted" | "Rejected";
  rejectionMessage?: string;
  samples: MonitorSample[];
};

export type RecentConnectionAttempt = {
  endpointUrl: string;
  startNodeId: string;
  authMode: AuthMode;
  username: string;
  password?: EncryptedPassword;
  attemptedAt: string;
};

export type EncryptedPassword = {
  keyId: string;
  iv: string;
  ciphertext: string;
};

export type ConnectionRequest = {
  endpointUrl: string;
  startNodeId: string;
  auth:
    | { _tag: "Anonymous" }
    | { _tag: "UserPassword"; username: string; password: string };
};
