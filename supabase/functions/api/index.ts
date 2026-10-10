// Posterity API: REST for agents at /functions/v1/api/*, MCP at /functions/v1/api/mcp.
import { CORS_HEADERS, errorResponse } from './lib/http.ts';
import { handleMcp } from './mcp.ts';
import { handleGitHub } from './ops/github.ts';
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
    else res = await handleRest(req, path, url);
  } catch (err) {
    res = errorResponse(err);
  }
  console.log(`${req.method} ${path} ${res.status} ${Date.now() - started}ms`);
  return res;
});
