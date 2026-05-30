import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, getAccessToken } from '../lib/api.js';
import { readSSE } from '../lib/sse.js';
import { PreviewPane } from '../components/builder/PreviewPane.js';
import { PromptPanel } from '../components/builder/PromptPanel.js';
import { ServicesPanel } from '../components/builder/ServicesPanel.js';
import { SnapshotsTimeline } from '../components/builder/SnapshotsTimeline.js';
import { SnapshotDiffModal } from '../components/builder/SnapshotDiffModal.js';
import { useLogStore } from '../stores/log.js';
import type { ProjectSnapshotsTimeline, SnapshotRetention, ProjectTest, TestRunStatus } from '../types/index.js';

const MonacoEditor = lazy(() => import('@monaco-editor/react').then((m) => ({ default: m.Editor })));

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

interface Screen {
  id: string;
  project_id: string;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

interface ProjectFileMeta {
  path: string;
  language: string;
  size: number;
  updated_at: string;
}

interface ProjectFile extends ProjectFileMeta {
  content: string;
}

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  created_at: string;
  linked_snapshot_id?: string | null;
}

interface Session {
  id: string;
  title: string;
  project_id: string | null;
  created_at: string;
}

interface Preview {
  id: string;
  project_id: string;
  status: 'pending' | 'building' | 'ready' | 'failed';
  url: string | null;
  error: string | null;
  updated_at: string;
}

interface PreviewTicket {
  url: string;
  expiresAt: string;
}

interface ProjectManifest {
  id: string;
  project_id: string;
  version: number;
  app_type: string;
  stack: Record<string, unknown>;
  commands: Record<string, unknown>;
  entrypoints: Record<string, unknown>;
  updated_at: string;
}

interface ProjectService {
  id: string;
  project_id: string;
  kind: 'frontend' | 'backend' | 'worker';
  name: string;
  root_path: string;
  runtime: string;
  port: number | null;
  status: 'planned' | 'generating' | 'ready' | 'failed' | 'disabled';
  config: Record<string, unknown>;
  updated_at: string;
}

interface ProjectApiRoute {
  id: string;
  project_id: string;
  service_id: string | null;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  handler_path: string;
  request_schema: Record<string, unknown>;
  response_schema: Record<string, unknown>;
  updated_at: string;
}

interface ProjectDbSchema {
  id: string;
  project_id: string;
  engine: string;
  name: string;
  schema: Record<string, unknown>;
  updated_at: string;
}

interface ProjectDbMigration {
  id: string;
  project_id: string;
  schema_id: string | null;
  version: number;
  name: string;
  content: string;
  status: 'draft' | 'generated' | 'applied' | 'failed';
  applied_at: string | null;
  updated_at: string;
}

interface ProjectDatabaseState {
  schemas: ProjectDbSchema[];
  migrations: ProjectDbMigration[];
}

interface ProjectEnvVar {
  id: string;
  project_id: string;
  service_id: string | null;
  name: string;
  required: boolean;
  secret_ref: string | null;
  default_value: string | null;
  description: string | null;
  updated_at: string;
}

interface ProjectValidationReport {
  id: string;
  project_id: string;
  run_id: string | null;
  status: 'pending' | 'pass' | 'fail';
  checks: unknown[];
  log_excerpt: string | null;
  created_at: string;
}

interface ProjectRuntimeInstance {
  id: string;
  project_id: string;
  preview_id: string | null;
  status: 'pending' | 'building' | 'ready' | 'failed' | 'stale' | 'stopped';
  frontend_url: string | null;
  backend_url: string | null;
  ports: Record<string, unknown>;
  error: string | null;
  updated_at: string;
}

// ProjectSnapshot type lives in types/index.ts (extended with spec-004 fields).
// This view only needs the timeline shape from there.

const COMPONENT_SNIPPETS = [
  { label: 'Navbar', icon: '≡', prompt: 'Add a responsive navigation bar at the top with the app name and navigation links' },
  { label: 'Hero', icon: '★', prompt: 'Add a hero section with a large heading, subtitle, and a call-to-action button' },
  { label: 'Card Grid', icon: '⊞', prompt: 'Add a grid of cards with title, description, and an action button' },
  { label: 'Form', icon: '✎', prompt: 'Add a contact form with name, email, message fields, and a submit button' },
  { label: 'Footer', icon: '▬', prompt: 'Add a footer with copyright info and social links' },
  { label: 'Sidebar', icon: '◧', prompt: 'Add a collapsible sidebar with navigation menu items' },
  { label: 'Table', icon: '⊟', prompt: 'Add a data table with sortable columns and pagination' },
  { label: 'Modal', icon: '▣', prompt: 'Add a modal dialog with a trigger button, overlay, and close button' },
  { label: 'Auth Form', icon: '🔒', prompt: 'Add a login/signup form with email, password fields and toggle between modes' },
  { label: 'Dashboard', icon: '◈', prompt: 'Add a dashboard layout with stat cards showing key metrics' },
] as const;

type SidebarTab = 'files' | 'screens' | 'components' | 'services' | 'api' | 'database' | 'env' | 'validation' | 'runtime' | 'snapshots' | 'tests';
type CenterTab = 'editor' | 'preview';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function TestStatusBadge({ status }: { status: TestRunStatus | null }) {
  if (!status) return <span style={{ color: 'var(--text-tertiary)' }}>—</span>;
  const map: Record<TestRunStatus, { label: string; color: string }> = {
    passed:    { label: '✓', color: 'var(--color-success, #4caf50)' },
    failed:    { label: '✗', color: 'var(--color-error, #f44336)' },
    pending:   { label: '…', color: 'var(--text-tertiary)' },
    errored:   { label: '!', color: 'var(--color-error, #f44336)' },
    timed_out: { label: '⏱', color: 'var(--text-tertiary)' },
  };
  const { label, color } = map[status];
  return <span style={{ color, fontWeight: 700, fontSize: '11px' }}>{label}</span>;
}

export default function Builder() {
  const { id } = useParams();
  const log = useLogStore();

  const [project, setProject] = useState<Project | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [files, setFiles] = useState<ProjectFileMeta[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ProjectManifest | null>(null);
  const [services, setServices] = useState<ProjectService[]>([]);
  const [apiRoutes, setApiRoutes] = useState<ProjectApiRoute[]>([]);
  const [database, setDatabase] = useState<ProjectDatabaseState>({ schemas: [], migrations: [] });
  const [envVars, setEnvVars] = useState<ProjectEnvVar[]>([]);
  const [validationReports, setValidationReports] = useState<ProjectValidationReport[]>([]);
  const [runtime, setRuntime] = useState<ProjectRuntimeInstance | null>(null);
  const [timeline, setTimeline] = useState<ProjectSnapshotsTimeline | null>(null);
  const [projectTests, setProjectTests] = useState<ProjectTest[]>([]);
  const [runningTestId, setRunningTestId] = useState<string | null>(null);
  const [diffModal, setDiffModal] = useState<{ from: string; to: string; restoreTargetId: string | null } | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('files');
  const [centerTab, setCenterTab] = useState<CenterTab>('editor');

  const [selectedFile, setSelectedFile] = useState<ProjectFile | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [isSavingFile, setIsSavingFile] = useState(false);

  const [screenName, setScreenName] = useState('');
  const [screenPath, setScreenPath] = useState('/screen');
  const [screenError, setScreenError] = useState<string | null>(null);
  const [isCreatingScreen, setIsCreatingScreen] = useState(false);

  const [projectSessionId, setProjectSessionId] = useState<string | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [chatError, setChatError] = useState<string | null>(null);

  const previewIframeRef = useRef<HTMLIFrameElement | null>(null);

  const loadFiles = async () => {
    if (!id) return;
    const fileList = await apiFetch<ProjectFileMeta[]>(`/api/projects/${id}/files`);
    setFiles(fileList);
    if (fileList.length > 0) {
      const stillSelected = selectedFile && fileList.some((file) => file.path === selectedFile.path);
      if (!stillSelected) {
        const firstFile = fileList[0];
        if (firstFile) {
          void openFile(firstFile.path);
        }
      }
    } else if (selectedFile) {
      setSelectedFile(null);
      setEditorContent('');
    }
    return fileList;
  };

  const loadProjectStructure = async () => {
    if (!id) return;
    const [manifestData, serviceData, apiRoutesData, databaseData, envVarData, validationData, runtimeData, timelineData, testsData] = await Promise.all([
      apiFetch<ProjectManifest | null>(`/api/projects/${id}/manifest`),
      apiFetch<ProjectService[]>(`/api/projects/${id}/services`),
      apiFetch<ProjectApiRoute[]>(`/api/projects/${id}/api-routes`),
      apiFetch<ProjectDatabaseState>(`/api/projects/${id}/database`),
      apiFetch<ProjectEnvVar[]>(`/api/projects/${id}/env`),
      apiFetch<ProjectValidationReport[]>(`/api/projects/${id}/validation`),
      apiFetch<ProjectRuntimeInstance | null>(`/api/projects/${id}/runtime`),
      apiFetch<ProjectSnapshotsTimeline>(`/api/projects/${id}/snapshots/timeline`),
      apiFetch<ProjectTest[]>(`/api/projects/${id}/tests`).catch(() => [] as ProjectTest[]),
    ]);
    setManifest(manifestData);
    setServices(serviceData);
    setApiRoutes(apiRoutesData);
    setDatabase(databaseData);
    setEnvVars(envVarData);
    setValidationReports(validationData);
    setRuntime(runtimeData);
    setTimeline(timelineData);
    setProjectTests(testsData);
  };

  const loadPreviewTicket = async () => {
    if (!id) return;
    const ticket = await apiFetch<PreviewTicket>(`/api/projects/${id}/preview/ticket`, { method: 'POST' });
    setPreviewUrl(ticket.url);
  };

  useEffect(() => {
    if (!id) return;

    const load = async () => {
      const [projectData, screenData, previewData] = await Promise.all([
        apiFetch<Project>(`/api/projects/${id}`),
        apiFetch<Screen[]>(`/api/projects/${id}/screens`),
        apiFetch<Preview | null>(`/api/projects/${id}/preview`).catch(() => null),
      ]);
      setProject(projectData);
      setScreens(screenData);
      setPreview(previewData);
      await loadPreviewTicket();

      await loadFiles();
      await loadProjectStructure();

      const sessions = await apiFetch<Session[]>(`/api/projects/${id}/sessions`);
      let sessionId: string;
      const firstSession = sessions[0];
      if (firstSession) {
        sessionId = firstSession.id;
      } else {
        const created = await apiFetch<Session>('/api/sessions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: projectData.name, projectId: id }),
        });
        sessionId = created.id;
      }
      setProjectSessionId(sessionId);

      const msgs = await apiFetch<ChatMessage[]>(`/api/sessions/${sessionId}/messages`);
      setChatMessages(msgs);
    };

    load()
      .catch((err) => {
        setChatError(err instanceof Error ? err.message : 'Failed to load project');
      })
      .finally(() => setIsLoading(false));
  }, [id]);

  const openFile = async (path: string) => {
    if (!id) return;
    const file = await apiFetch<ProjectFile>(`/api/projects/${id}/files/${path}`);
    setSelectedFile(file);
    setEditorContent(file.content);
    setCenterTab('editor');
  };

  const saveFile = async () => {
    if (!id || !selectedFile || isSavingFile) return;
    setIsSavingFile(true);
    try {
      await apiFetch(`/api/projects/${id}/files/${selectedFile.path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editorContent }),
      });
      await loadFiles();
      if (centerTab === 'preview') previewIframeRef.current?.contentWindow?.location.reload();
    } finally {
      setIsSavingFile(false);
    }
  };

  const deleteFile = async (path: string) => {
    if (!id) return;
    await apiFetch(`/api/projects/${id}/files/${path}`, { method: 'DELETE' });
    if (selectedFile?.path === path) setSelectedFile(null);
    await loadFiles();
  };

  const createScreen = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !screenName.trim() || !screenPath.trim()) return;
    setIsCreatingScreen(true);
    setScreenError(null);
    try {
      const screen = await apiFetch<Screen>(`/api/projects/${id}/screens`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: screenName.trim(), path: screenPath.trim() }),
      });
      setScreens((prev) => [...prev, screen]);
      setScreenName('');
      setScreenPath('/screen');
    } catch (err) {
      setScreenError(err instanceof Error ? err.message : 'Failed to create screen');
    } finally {
      setIsCreatingScreen(false);
    }
  };

  const sendComponentPrompt = (prompt: string) => {
    setChatInput(prompt);
    setSidebarTab('files');
  };

  // Spec 004 — restore now opens the diff modal first; the actual restore
  // call (with `confirm: true`) is wired in `confirmRestore` below.
  const openRestoreModal = (snapshotId: string) => {
    if (!timeline?.tip_id || snapshotId === timeline.tip_id) return;
    setDiffModal({ from: timeline.tip_id, to: snapshotId, restoreTargetId: snapshotId });
  };

  const openRevertFromMessage = (linkedSnapshotId: string) => {
    if (!timeline?.tip_id) return;
    setDiffModal({ from: timeline.tip_id, to: linkedSnapshotId, restoreTargetId: linkedSnapshotId });
  };

  const confirmRestore = async () => {
    if (!id || !diffModal?.restoreTargetId) return;
    await apiFetch(`/api/projects/${id}/snapshots/${diffModal.restoreTargetId}/restore`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    setDiffModal(null);
    await Promise.all([loadFiles(), loadProjectStructure()]);
    previewIframeRef.current?.contentWindow?.location.reload();
  };

  const updateSnapshotLabel = async (snapshotId: string, label: string | null) => {
    if (!id) return;
    await apiFetch(`/api/projects/${id}/snapshots/${snapshotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label }),
    });
    await loadProjectStructure();
  };

  const updateSnapshotRetention = async (snapshotId: string, retention: SnapshotRetention) => {
    if (!id) return;
    await apiFetch(`/api/projects/${id}/snapshots/${snapshotId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ retention }),
    });
    await loadProjectStructure();
  };

  const runTest = async (testId: string) => {
    if (!id) return;
    setRunningTestId(testId);
    try {
      const { run_id } = await apiFetch<{ run_id: string }>(`/api/projects/${id}/tests/${testId}/run`, { method: 'POST' });
      const poll = async () => {
        const runs = await apiFetch<Array<{ id: string; status: string }>>(`/api/projects/${id}/tests/${testId}/runs?limit=1`).catch(() => []);
        const latest = runs[0];
        if (latest?.id === run_id && latest?.status !== 'pending') {
          setRunningTestId(null);
          const tests = await apiFetch<ProjectTest[]>(`/api/projects/${id}/tests`).catch(() => projectTests);
          setProjectTests(tests);
        } else {
          setTimeout(() => void poll(), 1500);
        }
      };
      setTimeout(() => void poll(), 1500);
    } catch {
      setRunningTestId(null);
    }
  };

  const handleChatSubmit = async (overrideInput?: string) => {
    const msg = overrideInput ?? chatInput;
    if (!msg.trim() || !projectSessionId || isStreaming) return;
    setChatInput('');
    setChatError(null);
    log.clearEntries();
    log.resetResponse();
    log.addEntry({
      type: 'request',
      label: `Builder prompt → project ${id ?? 'unknown'}`,
      content: JSON.stringify(
        {
          projectId: id,
          sessionId: projectSessionId,
          prompt: msg,
          existingFiles: files.map((file) => file.path),
        },
        null,
        2
      ),
    });

    const tempUserMsg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content: msg,
      created_at: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, tempUserMsg]);
    setIsStreaming(true);
    setStreamingContent('');

    try {
      const token = getAccessToken();
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ sessionId: projectSessionId, content: msg, projectId: id }),
        credentials: 'include',
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Unknown error' })) as { error?: string };
        throw new Error(body.error ?? `HTTP ${response.status}`);
      }

      for await (const { event, data } of readSSE(response)) {
        if (event === 'user_message') {
          const parsed = JSON.parse(data) as { messageId: string };
          log.addEntry({
            type: 'request',
            label: 'Builder message persisted',
            content: JSON.stringify(parsed, null, 2),
          });
        } else if (event === 'agent_request') {
          const info = JSON.parse(data) as { iteration: number; model: string; messages: unknown[]; toolCount: number };
          log.resetResponse();
          log.addEntry({
            type: 'request',
            label: `Builder iteration ${info.iteration + 1} — ${info.model} · ${info.toolCount} tools`,
            content: JSON.stringify(info.messages, null, 2),
          });
        } else if (event === 'token') {
          const { content: chunk } = JSON.parse(data) as { content: string };
          setStreamingContent((prev) => prev + chunk);
          log.appendToResponse(chunk);
        } else if (event === 'tool_call') {
          const parsed = JSON.parse(data) as { name: string; args: string };
          log.resetResponse();
          log.addEntry({
            type: 'tool_call',
            label: `Builder tool: ${parsed.name}`,
            content: parsed.args,
          });
        } else if (event === 'tool_result') {
          const parsed = JSON.parse(data) as { name: string; content: string; error?: boolean };
          log.addEntry({
            type: 'tool_result',
            label: `Builder result: ${parsed.name}${parsed.error ? ' (error)' : ''}`,
            content: parsed.content,
          });
          if (parsed.name === 'write_project_file') {
              const refreshedFiles = await loadFiles();
              await loadProjectStructure();
              log.addEntry({
              type: 'tool_result',
              label: 'Builder files refreshed',
              content: JSON.stringify(
                {
                  count: refreshedFiles?.length ?? 0,
                  files: (refreshedFiles ?? []).map((file) => file.path),
                },
                null,
                2
              ),
            });
          }
        } else if (event === 'done') {
          const doneInfo = JSON.parse(data) as { messageId: string; agentRunId: string };
          const msgs = await apiFetch<ChatMessage[]>(`/api/sessions/${projectSessionId}/messages`);
          setChatMessages(msgs);
          setStreamingContent('');
          setIsStreaming(false);
          const refreshedFiles = await loadFiles();
          await loadProjectStructure();
          log.addEntry({
            type: 'done',
            label: 'Builder run completed',
            content: JSON.stringify(
              {
                ...doneInfo,
                finalMessageCount: msgs.length,
                fileCount: refreshedFiles?.length ?? 0,
                files: (refreshedFiles ?? []).map((file) => file.path),
              },
              null,
              2
            ),
          });
          return;
        } else if (event === 'error') {
          const { message } = JSON.parse(data) as { message: string };
          log.addEntry({ type: 'error', label: 'Builder stream error', content: message });
          throw new Error(message);
        }
      }
    } catch (err) {
      log.addEntry({
        type: 'error',
        label: 'Builder submit failed',
        content: err instanceof Error ? err.message : 'Chat error',
      });
      setChatError(err instanceof Error ? err.message : 'Chat error');
    } finally {
      setIsStreaming(false);
    }
  };

  if (isLoading) {
    return (
      <div style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
        Loading project…
      </div>
    );
  }

  return (
    <div style={{ gridColumn: '1 / -1', display: 'grid', gridTemplateColumns: '260px 1fr 360px', minHeight: 0, overflow: 'hidden' }}>

      {/* ── LEFT SIDEBAR ── */}
      <aside className="sidebar" style={{ borderRight: '1px solid var(--border-subtle)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* Project name */}
        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)' }}>Project</div>
          <div style={{ fontWeight: 'var(--weight-semibold)', marginTop: 'var(--space-1)', fontSize: 'var(--text-sm)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {project?.name ?? '…'}
          </div>
        </div>

        {/* Tab bar */}
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          {(['files', 'screens', 'components', 'services', 'api', 'database', 'env', 'validation', 'runtime', 'snapshots', 'tests'] as SidebarTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setSidebarTab(tab)}
              style={{
                flex: 1, padding: 'var(--space-2)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)',
                textTransform: 'capitalize', cursor: 'pointer', border: 'none',
                background: sidebarTab === tab ? 'var(--bg-surface)' : 'transparent',
                color: sidebarTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: sidebarTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {tab}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-2)' }}>

          {/* FILES TAB */}
          {sidebarTab === 'files' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
              {files.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', padding: 'var(--space-3)', textAlign: 'center' }}>
                  No files yet. Ask the agent to build your app.
                </div>
              )}
              {files.map((f) => (
                <div
                  key={f.path}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-1) var(--space-2)', borderRadius: 'var(--radius-sm)',
                    cursor: 'pointer', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)',
                    background: selectedFile?.path === f.path ? 'var(--tint-2)' : 'transparent',
                    color: selectedFile?.path === f.path ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  onClick={() => void openFile(f.path)}
                >
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.path}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); void deleteFile(f.path); }}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', fontSize: '10px', padding: '2px', flexShrink: 0, lineHeight: 1 }}
                    title="Delete file"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* SCREENS TAB */}
          {sidebarTab === 'screens' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {screens.map((screen) => (
                <div key={screen.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)' }}>{screen.name}</div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>{screen.path}</div>
                </div>
              ))}
              {screens.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>No screens yet.</div>
              )}
              <form onSubmit={(e) => void createScreen(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginTop: 'var(--space-2)' }}>
                <input className="input" placeholder="Screen name" value={screenName} onChange={(e) => setScreenName(e.target.value)} disabled={isCreatingScreen} style={{ fontSize: 'var(--text-xs)' }} />
                <input className="input" placeholder="/route" value={screenPath} onChange={(e) => setScreenPath(e.target.value)} disabled={isCreatingScreen} style={{ fontSize: 'var(--text-xs)' }} />
                {screenError && <div style={{ color: 'var(--color-error)', fontSize: '11px' }}>{screenError}</div>}
                <button className="btn btn-secondary btn-sm" type="submit" disabled={isCreatingScreen || !screenName.trim()} style={{ justifyContent: 'center' }}>
                  {isCreatingScreen ? 'Adding…' : 'Add screen'}
                </button>
              </form>
            </div>
          )}

          {/* COMPONENTS TAB — Stitch-like palette */}
          {sidebarTab === 'components' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', padding: 'var(--space-1) var(--space-2)' }}>
                Click to add component via agent
              </div>
              {COMPONENT_SNIPPETS.map((c) => (
                <button
                  key={c.label}
                  onClick={() => sendComponentPrompt(c.prompt)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                    padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-sans)',
                    color: 'var(--text-primary)', fontSize: 'var(--text-xs)',
                    transition: 'background var(--duration-fast) var(--ease-standard)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-surface-2)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'var(--bg-surface)')}
                >
                  <span style={{ fontSize: '14px', width: '18px', textAlign: 'center', flexShrink: 0 }}>{c.icon}</span>
                  <span>{c.label}</span>
                </button>
              ))}
            </div>
          )}

          {/* SERVICES TAB */}
          {sidebarTab === 'services' && (
            <ServicesPanel manifest={manifest} services={services} />
          )}

          {/* API ROUTES TAB */}
          {sidebarTab === 'api' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                API routes
              </div>
              {apiRoutes.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No API routes yet.
                </div>
              )}
              {apiRoutes.map((route) => {
                const service = route.service_id ? services.find((item) => item.id === route.service_id) : undefined;
                return (
                  <div key={route.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                        {route.method} {route.path}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                        {service?.name ?? 'unbound'}
                      </div>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      {route.handler_path}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* DATABASE TAB */}
          {sidebarTab === 'database' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                  Schemas
                </div>
                {database.schemas.length === 0 && (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                    No database schema yet.
                  </div>
                )}
                {database.schemas.map((schema) => (
                  <div key={schema.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)' }}>{schema.name}</div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{schema.engine}</div>
                    </div>
                    <pre style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                      {JSON.stringify(schema.schema, null, 2)}
                    </pre>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                  Migrations
                </div>
                {database.migrations.length === 0 && (
                  <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                    No migrations yet.
                  </div>
                )}
                {database.migrations.map((migration) => (
                  <div key={migration.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)' }}>
                        {migration.version}. {migration.name}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{migration.status}</div>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                      {migration.content.slice(0, 140)}{migration.content.length > 140 ? '…' : ''}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ENV TAB */}
          {sidebarTab === 'env' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                Environment
              </div>
              {envVars.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No env vars yet.
                </div>
              )}
              {envVars.map((envVar) => {
                const service = envVar.service_id ? services.find((item) => item.id === envVar.service_id) : undefined;
                return (
                  <div key={envVar.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                      <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-mono)' }}>
                        {envVar.name}
                      </div>
                      <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                        {service?.name ?? 'project'}
                      </div>
                    </div>
                    <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
                      {envVar.required ? 'required' : 'optional'}{envVar.secret_ref ? ' · secret ref' : ''}
                    </div>
                    {envVar.description && (
                      <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                        {envVar.description}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* VALIDATION TAB */}
          {sidebarTab === 'validation' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                Validation
              </div>
              {validationReports.length === 0 && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No validation reports yet.
                </div>
              )}
              {validationReports.map((report) => (
                <div key={report.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>{report.status}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                      {new Date(report.created_at).toLocaleTimeString()}
                    </div>
                  </div>
                  {report.log_excerpt && (
                    <pre style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
                      {report.log_excerpt}
                    </pre>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* RUNTIME TAB */}
          {sidebarTab === 'runtime' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
                Runtime
              </div>
              {!runtime && (
                <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
                  No runtime instance yet.
                </div>
              )}
              {runtime && (
                <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
                    <div style={{ fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>{runtime.status}</div>
                    <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>
                      {new Date(runtime.updated_at).toLocaleTimeString()}
                    </div>
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: 'var(--space-2)', fontFamily: 'var(--font-mono)' }}>
                    frontend: {runtime.frontend_url ?? '—'}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
                    backend: {runtime.backend_url ?? '—'}
                  </div>
                  <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: 'var(--space-2)' }}>
                    {runtime.backend_url
                      ? 'Full-stack service runtime'
                      : 'Static preview fallback'}
                  </div>
                  {preview && (
                    <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px' }}>
                      Preview: {preview.status}{preview.error ? ` · ${preview.error}` : ''}
                    </div>
                  )}
                  {runtime.error && (
                    <div style={{ fontSize: '10px', color: 'var(--color-error)', marginTop: 'var(--space-2)' }}>{runtime.error}</div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* SNAPSHOTS TAB */}
          {sidebarTab === 'snapshots' && (
            <SnapshotsTimeline
              timeline={timeline}
              onRestore={openRestoreModal}
              onUpdateLabel={updateSnapshotLabel}
              onUpdateRetention={updateSnapshotRetention}
            />
          )}

          {/* TESTS TAB — Spec 005 */}
          {sidebarTab === 'tests' && (
            <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {projectTests.length === 0 ? (
                <p style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)', textAlign: 'center', marginTop: 'var(--space-4)' }}>
                  Tests proposed by the agent will appear here.
                </p>
              ) : (
                projectTests.map((test) => (
                  <div key={test.id} style={{ padding: 'var(--space-2)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border-subtle)', background: 'var(--bg-surface)', fontSize: 'var(--text-xs)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
                      <TestStatusBadge status={test.last_run_status} />
                      <span style={{ flex: 1, fontWeight: 500, color: 'var(--text-primary)' }}>{test.title}</span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={runningTestId === test.id}
                        onClick={() => void runTest(test.id)}
                        style={{ fontSize: '10px', padding: '1px 6px' }}
                      >
                        {runningTestId === test.id ? '…' : '▶ Run'}
                      </button>
                    </div>
                    <div style={{ color: 'var(--text-tertiary)' }}>
                      {test.spec_path} · {test.source}
                      {test.last_run_duration_ms !== null && ` · ${test.last_run_duration_ms}ms`}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Back link + export */}
        <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0, display: 'flex', gap: 'var(--space-2)' }}>
          <Link className="btn btn-ghost btn-sm" to="/projects" style={{ flex: 1, justifyContent: 'center' }}>
            ← Projects
          </Link>
          {id && (
            <a
              href={`/api/projects/${id}/export`}
              download
              title="Export project as JSON"
              className="btn btn-ghost btn-sm"
              style={{ flexShrink: 0 }}
            >
              ↓ Export
            </a>
          )}
        </div>
      </aside>

      {/* ── CENTER — EDITOR / PREVIEW ── */}
      <main style={{ display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden', background: 'var(--bg-app)' }}>
        {/* Tab bar + file name + actions */}
        <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', flexShrink: 0, padding: '0 var(--space-3)', gap: 'var(--space-2)' }}>
          {(['editor', 'preview'] as CenterTab[]).map((tab) => (
            <button
              key={tab}
              onClick={() => setCenterTab(tab)}
              style={{
                padding: 'var(--space-2) var(--space-3)', fontSize: 'var(--text-xs)', fontFamily: 'var(--font-sans)',
                textTransform: 'capitalize', cursor: 'pointer', border: 'none', background: 'transparent',
                color: centerTab === tab ? 'var(--text-primary)' : 'var(--text-tertiary)',
                borderBottom: centerTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
              }}
            >
              {tab === 'editor' ? '{ } Editor' : '▶ Preview'}
            </button>
          ))}
          {centerTab === 'editor' && selectedFile && (
            <>
              <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)', fontFamily: 'var(--font-mono)', marginLeft: 'var(--space-2)', flex: 1 }}>
                {selectedFile.path}
              </span>
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => void saveFile()}
                disabled={isSavingFile}
              >
                {isSavingFile ? 'Saving…' : 'Save'}
              </button>
            </>
          )}
        </div>

        {/* Editor pane */}
        {centerTab === 'editor' && (
          <div style={{ flex: 1, minHeight: 0 }}>
            {selectedFile ? (
              <Suspense fallback={<div style={{ padding: 'var(--space-4)', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>Loading editor…</div>}>
                <MonacoEditor
                  height="100%"
                  language={selectedFile.language}
                  value={editorContent}
                  onChange={(val) => setEditorContent(val ?? '')}
                  theme="vs-dark"
                  options={{
                    fontSize: 13,
                    fontFamily: 'JetBrains Mono, Fira Code, monospace',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    padding: { top: 12 },
                    tabSize: 2,
                  }}
                />
              </Suspense>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', gap: 'var(--space-3)' }}>
                <div style={{ fontSize: '32px', opacity: 0.3 }}>&lt;/&gt;</div>
                <div style={{ fontSize: 'var(--text-sm)' }}>Select a file or ask the agent to generate one</div>
                {files.length > 0 && (
                  <div style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap', justifyContent: 'center' }}>
                    {files.slice(0, 5).map((f) => (
                      <button key={f.path} className="btn btn-secondary btn-sm" onClick={() => void openFile(f.path)}>
                        {f.path}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Preview pane */}
        {centerTab === 'preview' && (
          <PreviewPane previewUrl={previewUrl} iframeRef={previewIframeRef} />
        )}
      </main>

      {/* ── RIGHT SIDEBAR — AGENT CHAT ── */}
      <PromptPanel
        messages={chatMessages}
        streamingContent={streamingContent}
        chatInput={chatInput}
        isStreaming={isStreaming}
        hasSession={!!projectSessionId}
        error={chatError}
        onInputChange={setChatInput}
        onSubmit={(override) => void handleChatSubmit(override)}
        onRevertToMessage={openRevertFromMessage}
      />

      {diffModal && id && (
        <SnapshotDiffModal
          projectId={id}
          fromSnapshotId={diffModal.from}
          toSnapshotId={diffModal.to}
          restoreTargetId={diffModal.restoreTargetId}
          onCancel={() => setDiffModal(null)}
          onConfirmRestore={() => void confirmRestore()}
        />
      )}
    </div>
  );
}
