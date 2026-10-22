import { SQL } from 'bun';

/** Raw BEGIN/ROLLBACK fixture programs need one connection, including on Bun 1.4+. */
export async function rollbackFixtures(databaseUrl: string, files: URL[]) {
  if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(databaseUrl).hostname)) throw new Error('Disposable localhost database required');
  const fixture = new SQL(databaseUrl, { max: 1 });
  try {
    for (const file of files) await fixture.unsafe(await Bun.file(file).text());
  } finally {
    await fixture.close();
  }
}
