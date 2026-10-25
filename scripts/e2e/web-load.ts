// Production-build SSR probe. Start locally with POSTERITY_MOCKS=1; never targets a deployed site.
const base = process.env.POSTERITY_WEB_LOAD_URL ?? 'http://localhost:3000';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Local web preview required');
const total = Number(process.env.POSTERITY_WEB_LOAD_REQUESTS ?? 600);
const concurrency = Number(process.env.POSTERITY_WEB_LOAD_CONCURRENCY ?? 20);
if (!Number.isInteger(total) || total < 1 || total > 10000 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 100) throw new Error('Bounded request count and concurrency required');
const routes = ['/dev/mock/control-scale', '/dev/mock/agents', '/dev/mock/missions'];
let index = 0;
const times: number[] = [], errors: { route: string; status?: number; reason?: string }[] = [];
const started = performance.now();
await Promise.all(Array.from({ length: concurrency }, async () => {
  while (index < total) {
    const route = routes[index++ % routes.length], start = performance.now();
    try {
      const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(20000) });
      const body = await response.text();
      if (response.status !== 200 || !body.includes('<h1') || !body.includes('Posterity')) errors.push({ route, status: response.status });
    } catch (error) { errors.push({ route, reason: String(error) }); }
    times.push(performance.now() - start);
  }
}));
times.sort((a, b) => a - b);
console.log(JSON.stringify({ label: 'web_ssr_load', requests: total, concurrency, elapsed_ms: Math.round(performance.now() - started), p50_ms: Math.round(times[Math.ceil(total * .5) - 1]), p95_ms: Math.round(times[Math.ceil(total * .95) - 1]), p99_ms: Math.round(times[Math.ceil(total * .99) - 1]), errors: errors.length, first_errors: errors.slice(0, 5), routes, production_capacity_claim: false }));
if (errors.length) process.exitCode = 1;
