import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api.js';

interface Job {
  id: string;
  type: string;
  status: string;
  retry_count: number;
  created_at: string;
  updated_at: string;
  error: string | null;
}

export default function JobsAdmin() {
  const [jobs, setJobs] = useState<Job[]>([]);

  const load = () => {
    apiFetch<Job[]>('/admin/jobs').then(setJobs).catch(() => null);
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, []);

  const statusColor = (status: string): string => {
    if (status === 'done') return 'green';
    if (status === 'failed') return 'red';
    if (status === 'processing') return 'blue';
    return 'inherit';
  };

  return (
    <div style={{ padding: 24 }}>
      <h2>Job Queue</h2>
      <button onClick={load}>Refresh</button>
      <table>
        <thead><tr><th>ID</th><th>Type</th><th>Status</th><th>Retries</th><th>Created</th><th>Error</th></tr></thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td style={{ fontFamily: 'monospace', fontSize: 11 }}>{j.id.slice(0, 8)}…</td>
              <td>{j.type}</td>
              <td style={{ color: statusColor(j.status) }}>{j.status}</td>
              <td>{j.retry_count}</td>
              <td>{j.created_at}</td>
              <td style={{ color: 'red', fontSize: 11 }}>{j.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
