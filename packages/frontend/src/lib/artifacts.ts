export interface Artifact {
  id: string;
  language: string;
  filename: string | null;
  content: string;
}

/**
 * Extract code blocks from markdown content.
 * Detects optional filename from first-line comment: // path/to/file or # path/to/file
 */
export function parseArtifacts(markdown: string): Artifact[] {
  const artifacts: Artifact[] = [];
  const regex = /```(\w*)\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  let idx = 0;

  while ((match = regex.exec(markdown)) !== null) {
    const language = match[1] ?? 'text';
    const content = match[2] ?? '';

    const firstLine = content.split('\n')[0] ?? '';
    let filename: string | null = null;
    const commentMatch = firstLine.match(/^(?:\/\/|#|--)\s*(.+\.\w+)$/);
    if (commentMatch) {
      filename = commentMatch[1]?.trim() ?? null;
    }

    artifacts.push({ id: `artifact-${idx++}`, language, filename, content });
  }

  return artifacts;
}
