export interface User {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
  kc_subject?: string | null;
  email?: string | null;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  project_id?: string | null;
  archived_at?: string | null;
}

// Spec 005 — Playwright validation types

export type TestSource = 'acceptance' | 'smoke' | 'manual';
export type TestStatus = 'draft' | 'active' | 'disabled';
export type TestRunStatus = 'pending' | 'passed' | 'failed' | 'errored' | 'timed_out';

export interface MessageEvidence {
  test_run_id: string;
  status: 'passed' | 'failed';
  screenshot_blob_hash: string | null;
  video_blob_hash: string | null;
  test_title: string;
  error_excerpt?: string;
}

export interface ProjectTest {
  id: string;
  project_id: string;
  source: TestSource;
  title: string;
  intent: string;
  spec_path: string;
  status: TestStatus;
  created_at: string;
  last_run_status: TestRunStatus | null;
  last_run_duration_ms: number | null;
  last_run_at: string | null;
}

export interface ProjectTestRun {
  id: string;
  project_id: string;
  test_id: string;
  agent_run_id: string | null;
  status: TestRunStatus;
  duration_ms: number | null;
  evidence_screenshot_hash: string | null;
  evidence_video_hash: string | null;
  error_excerpt: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  linked_snapshot_id?: string | null;
  evidence?: MessageEvidence | null;
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
