export type EmbedClientOptions = {
  baseUrl: string;
  model: string;
  batchSize?: number | undefined;
};

export async function embedTexts(
  texts: string[],
  opts: EmbedClientOptions
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const batchSize = opts.batchSize ?? 32;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const res = await fetch(`${opts.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model, input: batch }),
    });

    if (!res.ok) {
      throw new Error(`Ollama embed error ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { embeddings: number[][] };
    results.push(...data.embeddings);
  }

  return results;
}
