import type Database from 'better-sqlite3';

export type TestSource = 'acceptance' | 'smoke' | 'manual';
export type TestStatus = 'draft' | 'active' | 'disabled';
export type TestRunStatus = 'pending' | 'passed' | 'failed' | 'errored' | 'timed_out';

export interface ProjectTest {
  id: string;
  project_id: string;
  source: TestSource;
  title: string;
  intent: string;
  spec_path: string;
  status: TestStatus;
  created_by_run_id: string | null;
  created_at: string;
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
  trace_json: string | null;
  created_at: string;
  finished_at: string | null;
}

export interface ProjectTestWithLastRun extends ProjectTest {
  last_run_status: TestRunStatus | null;
  last_run_duration_ms: number | null;
  last_run_at: string | null;
}

export interface MessageEvidence {
  test_run_id: string;
  status: 'passed' | 'failed';
  screenshot_blob_hash: string | null;
  video_blob_hash: string | null;
  test_title: string;
  error_excerpt?: string;
}

export class ProjectTestsRepo {
  constructor(private db: Database.Database) {}

  create(params: {
    projectId: string;
    source: TestSource;
    title: string;
    intent: string;
    specPath: string;
    createdByRunId?: string;
  }): ProjectTest {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project_tests
           (id, project_id, source, title, intent, spec_path, status, created_by_run_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
      )
      .run(id, params.projectId, params.source, params.title, params.intent, params.specPath, params.createdByRunId ?? null, now);
    return this.findById(id) as ProjectTest;
  }

  findById(id: string): ProjectTest | undefined {
    return this.db
      .prepare('SELECT * FROM project_tests WHERE id = ?')
      .get(id) as ProjectTest | undefined;
  }

  findByProject(projectId: string): ProjectTestWithLastRun[] {
    return this.db
      .prepare(
        `SELECT pt.*,
                ptr.status   AS last_run_status,
                ptr.duration_ms AS last_run_duration_ms,
                ptr.created_at  AS last_run_at
         FROM project_tests pt
         LEFT JOIN project_test_runs ptr ON ptr.id = (
           SELECT id FROM project_test_runs
           WHERE test_id = pt.id
           ORDER BY created_at DESC
           LIMIT 1
         )
         WHERE pt.project_id = ?
         ORDER BY pt.created_at ASC`
      )
      .all(projectId) as ProjectTestWithLastRun[];
  }

  updateStatus(id: string, status: TestStatus): void {
    this.db
      .prepare('UPDATE project_tests SET status = ? WHERE id = ?')
      .run(status, id);
  }
}

export class ProjectTestRunsRepo {
  constructor(private db: Database.Database) {}

  create(params: {
    projectId: string;
    testId: string;
    agentRunId?: string;
  }): ProjectTestRun {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO project_test_runs
           (id, project_id, test_id, agent_run_id, status, created_at)
         VALUES (?, ?, ?, ?, 'pending', ?)`
      )
      .run(id, params.projectId, params.testId, params.agentRunId ?? null, now);
    return this.findById(id) as ProjectTestRun;
  }

  findById(id: string): ProjectTestRun | undefined {
    return this.db
      .prepare('SELECT * FROM project_test_runs WHERE id = ?')
      .get(id) as ProjectTestRun | undefined;
  }

  findByTest(testId: string, limit = 20): ProjectTestRun[] {
    return this.db
      .prepare(
        'SELECT * FROM project_test_runs WHERE test_id = ? ORDER BY created_at DESC LIMIT ?'
      )
      .all(testId, limit) as ProjectTestRun[];
  }

  findLatestPassingScreenshotForRun(projectId: string, agentRunId: string): string | null {
    const row = this.db
      .prepare(
        `SELECT ptr.evidence_screenshot_hash
         FROM project_test_runs ptr
         JOIN project_tests pt ON pt.id = ptr.test_id
         WHERE pt.project_id = ? AND ptr.agent_run_id = ? AND ptr.status = 'passed'
         ORDER BY ptr.finished_at DESC LIMIT 1`
      )
      .get(projectId, agentRunId) as { evidence_screenshot_hash: string | null } | undefined;
    return row?.evidence_screenshot_hash ?? null;
  }

  updateFinished(
    id: string,
    params: {
      status: TestRunStatus;
      durationMs: number;
      screenshotHash?: string;
      videoHash?: string;
      errorExcerpt?: string;
      traceJson?: string;
    }
  ): void {
    this.db
      .prepare(
        `UPDATE project_test_runs
         SET status = ?, duration_ms = ?, evidence_screenshot_hash = ?,
             evidence_video_hash = ?, error_excerpt = ?, trace_json = ?,
             finished_at = ?
         WHERE id = ?`
      )
      .run(
        params.status,
        params.durationMs,
        params.screenshotHash ?? null,
        params.videoHash ?? null,
        params.errorExcerpt ?? null,
        params.traceJson ?? null,
        new Date().toISOString(),
        id
      );
  }
}
