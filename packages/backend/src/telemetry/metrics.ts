export class MetricsRegistry {
  private readonly startedAt = Date.now();
  private readonly httpCounts = new Map<string, number>();
  private readonly httpDurationMs = new Map<string, number>();

  recordHttp(method: string, route: string, status: number, durationMs: number): void {
    const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${status}"`;
    this.httpCounts.set(labels, (this.httpCounts.get(labels) ?? 0) + 1);
    this.httpDurationMs.set(labels, (this.httpDurationMs.get(labels) ?? 0) + durationMs);
  }

  render(): string {
    const lines = [
      '# HELP devmind_uptime_seconds Backend process uptime in seconds.',
      '# TYPE devmind_uptime_seconds gauge',
      `devmind_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`,
      '# HELP devmind_http_requests_total Total HTTP requests by method, route and status.',
      '# TYPE devmind_http_requests_total counter',
    ];

    for (const [labels, value] of this.httpCounts) {
      lines.push(`devmind_http_requests_total{${labels}} ${value}`);
    }

    lines.push(
      '# HELP devmind_http_request_duration_ms_sum Total HTTP request duration in milliseconds.',
      '# TYPE devmind_http_request_duration_ms_sum counter'
    );
    for (const [labels, value] of this.httpDurationMs) {
      lines.push(`devmind_http_request_duration_ms_sum{${labels}} ${Math.round(value)}`);
    }

    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('\n', ' ');
}
