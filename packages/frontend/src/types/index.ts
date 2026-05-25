export interface User {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  project_id?: string | null;
  archived_at?: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  linked_snapshot_id?: string | null;
}

// Spec 004 — project versioning shared types

export type SnapshotTrigger =
  | 'manual'
  | 'auto-pre-agent'
  | 'auto-post-agent'
  | 'milestone'
  | 'branch-root';

export type SnapshotRetention = 'ephemeral' | 'pinned';

export interface FileManifestEntry {
  path: string;
  hash: string;
  language?: string;
}

export interface ProjectSnapshot {
  id: string;
  project_id: string;
  run_id: string | null;
  label: string | null;
  manifest: Record<string, unknown>;
  file_tree: unknown[];
  resource_graph: Record<string, unknown>;
  created_at: string;
  parent_snapshot_id: string | null;
  trigger: SnapshotTrigger;
  agent_run_id: string | null;
  message_id: string | null;
  retention: SnapshotRetention;
  file_manifest: FileManifestEntry[] | null;
  screenshot_blob_hash: string | null;
}

export interface TimelineNode {
  id: string;
  parent_id: string | null;
  trigger: SnapshotTrigger;
  retention: SnapshotRetention;
  label: string | null;
  created_at: string;
  message_id: string | null;
  agent_run_id: string | null;
}

export interface ProjectSnapshotsTimeline {
  tip_id: string | null;
  nodes: TimelineNode[];
}

export interface SnapshotDiff {
  files: {
    added: FileManifestEntry[];
    removed: FileManifestEntry[];
    modified: Array<{ path: string; a_hash: string; b_hash: string }>;
  };
  resources: Record<string, { added: unknown[]; removed: unknown[] }>;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: boolean;
}

export type PendingStep =
  | { step: 'idle' }
  | { step: 'mfa'; mfaToken: string }
  | { step: 'register-totp'; totpUri: string; totpSecret: string; confirmToken: string };
