import { createHash } from 'node:crypto';

export type Chunk = {
  text: string;
  filePath: string;
  startOffset: number;
  endOffset: number;
  hash: string;
};

const WINDOW_SIZE = 800;
const STRIDE = 600; // 200-char overlap

export function chunkText(text: string, filePath: string): Chunk[] {
  if (!text.trim()) return [];

  const chunks: Chunk[] = [];
  let offset = 0;

  while (offset < text.length) {
    const end = Math.min(offset + WINDOW_SIZE, text.length);
    const chunkText = text.slice(offset, end);
    const hash = createHash('sha256')
      .update(filePath + ':' + offset)
      .digest('hex');

    chunks.push({ text: chunkText, filePath, startOffset: offset, endOffset: end, hash });

    if (end === text.length) break;
    offset += STRIDE;
  }

  return chunks;
}
