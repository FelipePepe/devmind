import { useRef } from 'react';

interface PreviewPaneProps {
  previewUrl: string | null;
  iframeRef?: React.MutableRefObject<HTMLIFrameElement | null>;
}

export function PreviewPane({ previewUrl, iframeRef: externalRef }: PreviewPaneProps) {
  const internalRef = useRef<HTMLIFrameElement>(null);
  const iframeRef = externalRef ?? internalRef;

  return (
    <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
      {previewUrl ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', borderBottom: '1px solid var(--border-subtle)', padding: '0 var(--space-3)', flexShrink: 0 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ marginLeft: 'auto' }}
              onClick={() => iframeRef.current?.contentWindow?.location.reload()}
            >
              ↺ Reload
            </button>
          </div>
          <iframe
            ref={iframeRef}
            src={previewUrl}
            style={{ width: '100%', height: '100%', border: 'none', background: '#fff' }}
            title="App preview"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-tertiary)', fontSize: 'var(--text-sm)' }}>
          No preview available
        </div>
      )}
    </div>
  );
}
