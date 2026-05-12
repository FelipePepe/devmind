import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { apiFetch } from '../lib/api.js';

interface Project {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
}

export default function Projects() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    apiFetch<Project[]>('/api/projects')
      .then(setProjects)
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load projects'));
  }, []);

  const deleteProject = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await apiFetch(`/api/projects/${id}`, { method: 'DELETE' });
      setProjects((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setDeletingId(null);
    }
  };

  const createProject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setIsCreating(true);
    setError(null);
    try {
      const project = await apiFetch<Project>('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
        }),
      });
      setProjects((prev) => [project, ...prev]);
      setName('');
      setDescription('');
      navigate(`/projects/${project.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <div style={{ gridColumn: '1 / -1', overflowY: 'auto', padding: 'var(--space-6)' }}>
      <div style={{ maxWidth: '1100px', margin: '0 auto', display: 'grid', gridTemplateColumns: 'minmax(320px, 420px) 1fr', gap: 'var(--space-6)' }}>
        <section style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-5)', height: 'fit-content' }}>
          <div style={{ marginBottom: 'var(--space-4)' }}>
            <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)', marginBottom: 'var(--space-2)' }}>
              New Project
            </div>
            <h1 style={{ fontSize: 'var(--text-2xl)', marginBottom: 'var(--space-2)' }}>Build an app, not a chat</h1>
            <p style={{ color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
              Start with a project container. Screens, previews, backend resources, and agent threads will hang off this object.
            </p>
          </div>

          <form onSubmit={(e) => void createProject(e)} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            <input
              className="input"
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />
            <textarea
              className="input"
              placeholder="What are you building?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              disabled={isCreating}
              rows={5}
              style={{ resize: 'vertical', minHeight: '120px' }}
            />
            {error && <div style={{ color: 'var(--color-error)', fontSize: 'var(--text-sm)' }}>{error}</div>}
            <button className="btn btn-primary" type="submit" disabled={isCreating || !name.trim()} style={{ justifyContent: 'center' }}>
              {isCreating ? 'Creating…' : 'Create project'}
            </button>
          </form>
        </section>

        <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 'var(--text-xs)', textTransform: 'uppercase', letterSpacing: 'var(--tracking-caps)', color: 'var(--text-tertiary)' }}>
                Projects
              </div>
              <h2 style={{ fontSize: 'var(--text-xl)', marginTop: 'var(--space-1)' }}>Workspace</h2>
            </div>
            <Link className="btn btn-secondary btn-sm" to="/chat">Open legacy chat</Link>
          </div>

          {projects.length === 0 ? (
            <div style={{ padding: 'var(--space-6)', background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-surface-2))', border: '1px dashed var(--border-default)', borderRadius: 'var(--radius-lg)', color: 'var(--text-secondary)' }}>
              No projects yet. Create the first one from the panel on the left.
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                style={{
                  position: 'relative',
                  background: 'linear-gradient(135deg, var(--bg-surface), var(--bg-surface-2))',
                  border: '1px solid var(--border-subtle)',
                  borderRadius: 'var(--radius-lg)',
                }}
              >
                <Link
                  to={`/projects/${project.id}`}
                  style={{ display: 'block', textDecoration: 'none', color: 'inherit', padding: 'var(--space-4)' }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)', alignItems: 'baseline', paddingRight: 'var(--space-8)' }}>
                    <h3 style={{ fontSize: 'var(--text-lg)' }}>{project.name}</h3>
                    <span style={{ fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }}>
                      {new Date(project.updated_at).toLocaleDateString()}
                    </span>
                  </div>
                  <p style={{ marginTop: 'var(--space-2)', color: 'var(--text-secondary)', lineHeight: 'var(--leading-relaxed)' }}>
                    {project.description || 'No project brief yet.'}
                  </p>
                </Link>
                <button
                  onClick={(e) => { e.preventDefault(); void deleteProject(project.id, project.name); }}
                  disabled={deletingId === project.id}
                  title="Delete project"
                  style={{
                    position: 'absolute', top: 'var(--space-3)', right: 'var(--space-3)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-tertiary)', fontSize: '13px', padding: '4px 6px',
                    borderRadius: 'var(--radius-sm)', lineHeight: 1,
                    opacity: deletingId === project.id ? 0.5 : 0.6,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--color-error)'; e.currentTarget.style.opacity = '1'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.opacity = '0.6'; }}
                >
                  {deletingId === project.id ? '…' : '✕'}
                </button>
              </div>
            ))
          )}
        </section>
      </div>
    </div>
  );
}
