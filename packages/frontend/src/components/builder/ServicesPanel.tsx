interface ProjectManifest {
  app_type: string;
  stack: Record<string, unknown>;
  entrypoints: Record<string, unknown>;
}

interface ProjectService {
  id: string;
  kind: 'frontend' | 'backend' | 'worker';
  name: string;
  root_path: string;
  runtime: string;
  port: number | null;
  status: 'planned' | 'generating' | 'ready' | 'failed' | 'disabled';
}

interface ServicesPanelProps {
  manifest: ProjectManifest | null;
  services: ProjectService[];
}

export function ServicesPanel({ manifest, services }: ServicesPanelProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
        <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)' }}>
          Manifest
        </div>
        {manifest ? (
          <>
            <div style={{ marginTop: 'var(--space-2)', fontWeight: 'var(--weight-semibold)', fontSize: 'var(--text-xs)' }}>
              {manifest.app_type}
            </div>
            <pre style={{ marginTop: 'var(--space-2)', whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: 'var(--text-secondary)', fontSize: '10px', fontFamily: 'var(--font-mono)' }}>
              {JSON.stringify({ stack: manifest.stack, entrypoints: manifest.entrypoints }, null, 2)}
            </pre>
          </>
        ) : (
          <div style={{ marginTop: 'var(--space-2)', color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)' }}>
            No manifest yet.
          </div>
        )}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', padding: '0 var(--space-2)' }}>
          Services
        </div>
        {services.length === 0 && (
          <div style={{ color: 'var(--text-tertiary)', fontSize: 'var(--text-xs)', textAlign: 'center', padding: 'var(--space-3)' }}>
            No services yet.
          </div>
        )}
        {services.map((service) => (
          <div key={service.id} style={{ padding: 'var(--space-2) var(--space-3)', background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-md)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-2)', alignItems: 'baseline' }}>
              <div style={{ fontWeight: 'var(--weight-medium)', fontSize: 'var(--text-xs)' }}>{service.name}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '10px' }}>{service.kind}</div>
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-tertiary)', marginTop: '2px', fontFamily: 'var(--font-mono)' }}>
              {service.runtime} · {service.root_path}{service.port ? ` · :${service.port}` : ''}
            </div>
            <div style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: 'var(--space-1)' }}>
              {service.status}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
