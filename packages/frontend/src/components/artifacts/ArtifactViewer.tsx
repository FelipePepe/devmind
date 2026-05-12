import { useState, useEffect, useCallback, useRef } from 'react';
import type { CSSProperties } from 'react';
import hljs from 'highlight.js/lib/core';
import typescript from 'highlight.js/lib/languages/typescript';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import sql from 'highlight.js/lib/languages/sql';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import json from 'highlight.js/lib/languages/json';
import go from 'highlight.js/lib/languages/go';
import type { Artifact } from '../../lib/artifacts.js';

hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('ts', typescript);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('js', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('py', python);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('sh', bash);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('html', xml);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('css', css);
hljs.registerLanguage('json', json);
hljs.registerLanguage('go', go);

const HLJS_DARK_STYLE = `
.hljs { background: transparent; color: var(--text-code); }
.hljs-keyword, .hljs-selector-tag, .hljs-literal, .hljs-strong { color: #C792EA; font-weight: var(--weight-medium); }
.hljs-string, .hljs-attr, .hljs-symbol, .hljs-bullet, .hljs-addition { color: #C3E88D; }
.hljs-title, .hljs-section, .hljs-attribute, .hljs-name { color: #82AAFF; }
.hljs-type, .hljs-params { color: #FFCB6B; }
.hljs-number, .hljs-deletion { color: #F78C6C; }
.hljs-comment, .hljs-quote { color: var(--text-tertiary); font-style: italic; }
.hljs-meta { color: #89DDFF; }
.hljs-tag, .hljs-selector-id, .hljs-selector-class { color: #F07178; }
.hljs-built_in { color: #89DDFF; }
.hljs-variable, .hljs-template-variable { color: #EEFFFF; }
.hljs-regexp { color: #F78C6C; }
.hljs-link { color: #C3E88D; text-decoration: underline; }
`;

function highlight(content: string, language: string): string {
  const supported = hljs.getLanguage(language);
  if (supported) {
    return hljs.highlight(content, { language }).value;
  }
  return hljs.highlightAuto(content).value;
}

function isHtmlContent(artifact: Artifact): boolean {
  return artifact.language === 'html' || artifact.content.trimStart().startsWith('<!DOCTYPE') || artifact.content.trimStart().startsWith('<html');
}

interface ArtifactViewerProps {
  artifacts: Artifact[];
  isStreaming?: boolean;
}

export function ArtifactViewer({ artifacts, isStreaming = false }: ArtifactViewerProps) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [copied, setCopied] = useState(false);
  const styleInjected = useRef(false);

  useEffect(() => {
    if (!styleInjected.current) {
      const style = document.createElement('style');
      style.textContent = HLJS_DARK_STYLE;
      document.head.appendChild(style);
      styleInjected.current = true;
    }
  }, []);

  // Reset active tab when artifact count changes
  useEffect(() => {
    setActiveIdx((prev) => (artifacts.length > 0 ? Math.min(prev, artifacts.length - 1) : 0));
    setPreviewMode(false);
  }, [artifacts.length]);

  const handleCopy = useCallback(() => {
    const artifact = artifacts[activeIdx];
    if (!artifact) return;
    void navigator.clipboard.writeText(artifact.content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [artifacts, activeIdx]);

  if (artifacts.length === 0) {
    return (
      <div style={styles.emptyState}>
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ opacity: 0.4 }}>
          <polyline points="16 18 22 12 16 6" />
          <polyline points="8 6 2 12 8 18" />
        </svg>
        <p style={styles.emptyText}>
          {isStreaming ? 'Receiving response…' : 'The assistant will generate code here'}
        </p>
      </div>
    );
  }

  const active = artifacts[activeIdx];
  if (!active) return null;
  const showPreviewButton = isHtmlContent(active);

  return (
    <div style={styles.container}>
      {/* Tab bar */}
      <div style={styles.tabBar}>
        <div style={styles.tabs}>
          {artifacts.map((a, i) => (
            <button
              key={a.id}
              onClick={() => { setActiveIdx(i); setPreviewMode(false); }}
              style={{
                ...styles.tab,
                ...(i === activeIdx && !previewMode ? styles.tabActive : {}),
              }}
            >
              <span style={styles.tabLabel}>{a.filename ?? a.language ?? 'text'}</span>
            </button>
          ))}
          {showPreviewButton && (
            <button
              onClick={() => setPreviewMode(true)}
              style={{
                ...styles.tab,
                ...(previewMode ? styles.tabActive : {}),
              }}
            >
              <span style={styles.tabLabel}>Preview</span>
            </button>
          )}
        </div>

        <div style={styles.actions}>
          {isStreaming && (
            <span style={styles.streamingBadge}>
              <span style={styles.streamingDot} />
              Generating
            </span>
          )}
          <span style={styles.langBadge}>{active.language || 'text'}</span>
          <button
            onClick={handleCopy}
            style={styles.copyBtn}
            title="Copy to clipboard"
          >
            {copied ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
            )}
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      {/* Content area */}
      <div style={styles.content}>
        {previewMode ? (
          <iframe
            srcDoc={active.content}
            style={styles.preview}
            sandbox="allow-scripts"
            title="HTML Preview"
          />
        ) : (
          <pre style={styles.pre}>
            <code
              dangerouslySetInnerHTML={{ __html: highlight(active.content, active.language) }}
              style={styles.code}
            />
          </pre>
        )}
      </div>
    </div>
  );
}

const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    height: '100%',
    background: 'var(--bg-surface)',
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border-subtle)',
    overflow: 'hidden',
  },
  tabBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottom: '1px solid var(--border-subtle)',
    background: 'var(--bg-app)',
    padding: '0 var(--space-3)',
    flexShrink: 0,
    minHeight: '40px',
    gap: 'var(--space-2)',
  },
  tabs: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    overflowX: 'auto' as const,
    flexShrink: 1,
  },
  tab: {
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    padding: 'var(--space-2) var(--space-3)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    borderRadius: 'var(--radius-sm)',
    transition: 'color var(--duration-fast) var(--ease-standard)',
    whiteSpace: 'nowrap' as const,
    position: 'relative' as const,
  },
  tabActive: {
    color: 'var(--text-primary)',
    background: 'var(--tint-2)',
    boxShadow: 'inset 0 -2px 0 var(--accent)',
  },
  tabLabel: {
    fontFamily: 'var(--font-mono)',
  },
  actions: {
    display: 'flex',
    alignItems: 'center',
    gap: 'var(--space-2)',
    flexShrink: 0,
  },
  streamingBadge: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    color: 'var(--accent)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
  },
  streamingDot: {
    width: '6px',
    height: '6px',
    borderRadius: 'var(--radius-full)',
    background: 'var(--accent)',
    display: 'inline-block',
    animation: 'pulse 1s infinite',
  },
  langBadge: {
    fontSize: 'var(--text-xs)',
    color: 'var(--text-tertiary)',
    fontFamily: 'var(--font-mono)',
    background: 'var(--tint-1)',
    padding: '2px var(--space-2)',
    borderRadius: 'var(--radius-sm)',
    border: '1px solid var(--border-subtle)',
  },
  copyBtn: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 'var(--space-1)',
    background: 'none',
    border: '1px solid var(--border-default)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text-secondary)',
    fontSize: 'var(--text-xs)',
    fontFamily: 'var(--font-sans)',
    padding: '2px var(--space-2)',
    cursor: 'pointer',
    transition: 'all var(--duration-fast) var(--ease-standard)',
  },
  content: {
    flex: 1,
    overflow: 'auto',
    padding: 'var(--space-4)',
  },
  pre: {
    margin: 0,
    padding: 0,
    background: 'transparent',
    overflow: 'visible',
  },
  code: {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--text-sm)',
    lineHeight: 'var(--leading-code)',
    display: 'block',
    whiteSpace: 'pre' as const,
  },
  preview: {
    width: '100%',
    height: '100%',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    background: '#fff',
    minHeight: '300px',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
    gap: 'var(--space-3)',
    color: 'var(--text-tertiary)',
    padding: 'var(--space-8)',
  },
  emptyText: {
    fontSize: 'var(--text-sm)',
    textAlign: 'center' as const,
    color: 'var(--text-tertiary)',
  },
} satisfies Record<string, CSSProperties>;
