// Posterity API: REST for agents at /functions/v1/api/*, MCP at /functions/v1/api/mcp.
import { DOCS, type DocName, llmsTxt, renderDoc, skillJson } from './docs.ts';
import { CORS_HEADERS, errorResponse, json } from './lib/http.ts';
import { handleMcp } from './mcp.ts';
import { handleGitHub } from './ops/github.ts';
import { siteUrl } from './ops/agents.ts';
import { apiBase } from './ops/context.ts';
import { handleInternal } from './ops/internal.ts';
import { handleRest } from './rest.ts';

function normalizePath(pathname: string): string {
  const path = pathname
    .replace(/^\/functions\/v1(?=\/|$)/, '')
    // The function's own name: api, or a staging copy such as api-next.
    .replace(/^\/api(?:-[a-z0-9]+)*(?=\/|$)/, '')
    .replace(/^\/v1(?=\/|$)/, '')
    .replace(/\/+$/, '');
  return path || '/';
}

/** The agent guides: skill.md, heartbeat.md, rules.md, skill.json and llms.txt. */
async function serveDoc(name: string): Promise<Response> {
  const api = apiBase();
  const ctx = { api, site: (await siteUrl()) ?? api };
  const headers = { ...CORS_HEADERS, 'Cache-Control': 'public, max-age=300' };
  if (name === 'skill.json') return json(await skillJson(ctx), 200, { 'Cache-Control': 'public, max-age=300' });
  const text = name === 'llms.txt' ? llmsTxt(ctx) : renderDoc(name as DocName, ctx);
  const type = name.endsWith('.md') ? 'text/markdown; charset=utf-8' : 'text/plain; charset=utf-8';
  return new Response(text, { headers: { ...headers, 'Content-Type': type } });
}

Deno.serve(async (req) => {
  const started = Date.now();
  const url = new URL(req.url);
  const path = normalizePath(url.pathname);
  let res: Response;
  try {
    if (req.method === 'OPTIONS') res = new Response(null, { status: 204, headers: CORS_HEADERS });
    else if (path === '/mcp') res = await handleMcp(req);
    else if (path === '/integrations/github') res = await handleGitHub(req);
    else if (path.startsWith('/internal/')) res = await handleInternal(req, path);
    else if (req.method === 'GET' && (path.slice(1) in DOCS || path === '/skill.json' || path === '/llms.txt')) res = await serveDoc(path.slice(1));
    else res = await handleRest(req, path, url);
  } catch (err) {
    res = errorResponse(err);
  }
  console.log(`${req.method} ${path} ${res.status} ${Date.now() - started}ms`);
  return res;
});
