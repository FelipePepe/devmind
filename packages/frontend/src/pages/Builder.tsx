import { useEffect, useRef, useState, lazy, Suspense } from 'react';
import { Link, useParams } from 'react-router-dom';
import { apiFetch, getAccessToken } from '../lib/api.js';
import { readSSE } from '../lib/sse.js';
import { PreviewPane } from '../components/builder/PreviewPane.js';
import { PromptPanel } from '../components/builder/PromptPanel.js';
import { useLogStore } from '../stores/log.js';

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

type SidebarTab = 'files' | 'screens' | 'components';
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

export default function Builder() {
  const { id } = useParams();
  const log = useLogStore();

  const [project, setProject] = useState<Project | null>(null);
  const [screens, setScreens] = useState<Screen[]>([]);
  const [files, setFiles] = useState<ProjectFileMeta[]>([]);
  const [preview, setPreview] = useState<Preview | null>(null);

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

      await loadFiles();

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

    load().catch((err) => {
      setChatError(err instanceof Error ? err.message : 'Failed to load project');
    });
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

  const previewUrl = id ? `/api/projects/${id}/preview/serve/index.html` : null;

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
          {(['files', 'screens', 'components'] as SidebarTab[]).map((tab) => (
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
        </div>

        {/* Back link */}
        <div style={{ padding: 'var(--space-3)', borderTop: '1px solid var(--border-subtle)', flexShrink: 0 }}>
          <Link className="btn btn-ghost btn-sm" to="/projects" style={{ justifyContent: 'center', width: '100%' }}>
            ← Projects
          </Link>
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
      />
    </div>
  );
}
