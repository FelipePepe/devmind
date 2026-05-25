CREATE TABLE IF NOT EXISTS project_api_routes (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  service_id           TEXT REFERENCES project_services(id) ON DELETE SET NULL,
  method               TEXT NOT NULL CHECK (method IN ('GET', 'POST', 'PUT', 'PATCH', 'DELETE')),
  path                 TEXT NOT NULL,
  handler_path         TEXT NOT NULL,
  request_schema_json  TEXT NOT NULL DEFAULT '{}',
  response_schema_json TEXT NOT NULL DEFAULT '{}',
  created_at           TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_project_api_routes_project_id ON project_api_routes(project_id, method, path);
CREATE INDEX IF NOT EXISTS idx_project_api_routes_service_id ON project_api_routes(service_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_project_api_routes_project_method_path ON project_api_routes(project_id, method, path);
