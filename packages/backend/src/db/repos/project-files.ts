import type Database from 'better-sqlite3';

export interface ProjectFile {
  id: string;
  project_id: string;
  path: string;
  content: string;
  language: string;
  created_at: string;
  updated_at: string;
}

const EXT_LANGUAGE: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  html: 'html', css: 'css', json: 'json', md: 'markdown',
  py: 'python', go: 'go', rs: 'rust', sql: 'sql', sh: 'shell',
  yaml: 'yaml', yml: 'yaml', toml: 'toml', xml: 'xml', svg: 'xml',
};

export function detectLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANGUAGE[ext] ?? 'plaintext';
}

export function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const map: Record<string, string> = {
    html: 'text/html; charset=utf-8',
    css: 'text/css; charset=utf-8',
    js: 'application/javascript; charset=utf-8',
    jsx: 'application/javascript; charset=utf-8',
    ts: 'application/typescript; charset=utf-8',
    tsx: 'application/typescript; charset=utf-8',
    json: 'application/json; charset=utf-8',
    svg: 'image/svg+xml; charset=utf-8',
    md: 'text/markdown; charset=utf-8',
  };
  return map[ext] ?? 'text/plain; charset=utf-8';
}

export class ProjectFilesRepo {
  constructor(private db: Database.Database) {}

  findByProject(projectId: string): ProjectFile[] {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_id = ? ORDER BY path')
      .all(projectId) as ProjectFile[];
  }

  findByPath(projectId: string, path: string): ProjectFile | undefined {
    return this.db
      .prepare('SELECT * FROM project_files WHERE project_id = ? AND path = ?')
      .get(projectId, path) as ProjectFile | undefined;
  }

  upsert(projectId: string, path: string, content: string, language?: string): ProjectFile {
    const now = new Date().toISOString();
    const lang = language ?? detectLanguage(path);
    const existing = this.findByPath(projectId, path);
    if (existing) {
      this.db
        .prepare('UPDATE project_files SET content = ?, language = ?, updated_at = ? WHERE project_id = ? AND path = ?')
        .run(content, lang, now, projectId, path);
    } else {
      const id = crypto.randomUUID();
      this.db
        .prepare(
          `INSERT INTO project_files (id, project_id, path, content, language, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(id, projectId, path, content, lang, now, now);
    }
    return this.findByPath(projectId, path) as ProjectFile;
  }

  delete(projectId: string, path: string): void {
    this.db
      .prepare('DELETE FROM project_files WHERE project_id = ? AND path = ?')
      .run(projectId, path);
  }
}
