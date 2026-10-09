// gte-small runs inside the Edge Runtime itself: no external API, 384 dimensions, normalized.

interface EmbeddingSession {
  run(input: string, options: { mean_pool: boolean; normalize: boolean }): Promise<unknown>;
}
declare const Supabase: { ai: { Session: new (model: string) => EmbeddingSession } };

let session: EmbeddingSession | undefined;

/** Embeds text as a pgvector literal. gte-small reads at most 512 tokens, so long text is trimmed first. */
export async function embed(text: string): Promise<string> {
  session ??= new Supabase.ai.Session('gte-small');
  const output = await session.run(text.slice(0, 2000), { mean_pool: true, normalize: true });
  const vector = Array.from(output as ArrayLike<number>);
  if (vector.length !== 384) throw new Error(`unexpected embedding size ${vector.length}`);
  return `[${vector.map((v) => Number(v.toFixed(6))).join(',')}]`;
}

/** Like embed(), but resolves to null instead of failing, so callers can fall back to full-text search. */
export async function tryEmbed(text: string): Promise<string | null> {
  try {
    return await embed(text);
  } catch (err) {
    console.error('embedding failed', err);
    return null;
  }
}
