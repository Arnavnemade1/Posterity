'use client';

import { Search } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { cx } from '@/components/ui';

export interface Endpoint {
  method: string;
  path: string;
  auth: boolean;
  summary: string;
}
export interface Tool {
  name: string;
  description: string;
}

const METHOD_TONE: Record<string, string> = { GET: 'text-done', POST: 'text-claimed', PUT: 'text-review', PATCH: 'text-review', DELETE: 'text-danger' };

/** A search box, the rows that match, and a button to show the rest: the lists are long (dozens of tools, hundreds of endpoints). */
function useFiltered<T>(items: T[], haystack: (item: T) => string, preview: number) {
  const [query, setQuery] = useState('');
  const [all, setAll] = useState(false);
  const term = query.trim().toLowerCase();
  const matches = useMemo(() => (term ? items.filter((i) => haystack(i).toLowerCase().includes(term)) : items), [items, term, haystack]);
  const shown = term || all ? matches : matches.slice(0, preview);
  return { query, setQuery, term, matches, shown, all, setAll, hidden: matches.length - shown.length };
}

function Toolbar({ label, query, setQuery, count, total }: { label: string; query: string; setQuery: (q: string) => void; count: number; total: number }) {
  const id = useId();
  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div className="relative w-full sm:max-w-xs">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-faint" aria-hidden />
        <input
          id={id}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={label}
          aria-label={label}
          autoComplete="off"
          spellCheck={false}
          className="field h-10 rounded-full pl-10 pr-4 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>
      <p role="status" className="numeric text-13 text-faint">
        {query ? `${count} of ${total}` : `${total} in total`}
      </p>
    </div>
  );
}

function ShowAll({ hidden, noun, onClick }: { hidden: number; noun: string; onClick: () => void }) {
  if (hidden <= 0) return null;
  return (
    <button type="button" onClick={onClick} className="mt-3 inline-flex h-9 items-center rounded-full bg-hover px-4 text-14 font-medium text-text transition-colors hover:bg-active">
      Show {hidden} more {noun}
    </button>
  );
}

const toolText = (t: Tool) => `${t.name} ${t.description}`;
const endpointText = (e: Endpoint) => `${e.method} ${e.path} ${e.summary}`;

export function ToolReference({ tools }: { tools: Tool[] }) {
  const { query, setQuery, matches, shown, setAll, hidden } = useFiltered(tools, toolText, 12);
  return (
    <div>
      <Toolbar label="Filter tools" query={query} setQuery={setQuery} count={matches.length} total={tools.length} />
      {shown.length ? (
        <div className="grid gap-px overflow-hidden rounded-2xl bg-line md:grid-cols-2">
          {shown.map((tool) => (
            <article key={tool.name} className="bg-ink p-4">
              <h3 className="break-all font-mono text-13 font-medium text-text">{tool.name}</h3>
              <p className="mt-1 line-clamp-3 text-13 leading-relaxed text-muted">{tool.description}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="rounded-2xl bg-panel px-5 py-8 text-center text-14 text-faint">No tool matches “{query}”.</p>
      )}
      <ShowAll hidden={hidden} noun="tools" onClick={() => setAll(true)} />
    </div>
  );
}

export function EndpointReference({ endpoints }: { endpoints: Endpoint[] }) {
  const { query, setQuery, matches, shown, setAll, hidden } = useFiltered(endpoints, endpointText, 16);
  return (
    <div>
      <Toolbar label="Filter endpoints" query={query} setQuery={setQuery} count={matches.length} total={endpoints.length} />
      {shown.length ? (
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-left text-14">
            <thead>
              <tr className="text-12 text-faint">
                <th scope="col" className="border-b border-line px-4 py-3 font-medium">
                  Method
                </th>
                <th scope="col" className="border-b border-line px-4 py-3 font-medium">
                  Path
                </th>
                <th scope="col" className="border-b border-line px-4 py-3 font-medium">
                  Key
                </th>
                <th scope="col" className="border-b border-line px-4 py-3 font-medium">
                  Purpose
                </th>
              </tr>
            </thead>
            <tbody>
              {shown.map((endpoint, i) => (
                <tr key={`${endpoint.method} ${endpoint.path} ${i}`} className="transition-colors hover:bg-hover">
                  <td className="border-b border-line px-4 py-2.5 align-top">
                    <span className={cx('font-mono text-12 font-semibold', METHOD_TONE[endpoint.method] ?? 'text-muted')}>{endpoint.method}</span>
                  </td>
                  <td className="border-b border-line px-4 py-2.5 align-top font-mono text-13 text-text">{endpoint.path}</td>
                  <td className="border-b border-line px-4 py-2.5 align-top text-13 text-faint">{endpoint.auth ? 'Required' : '—'}</td>
                  <td className="border-b border-line px-4 py-2.5 align-top text-muted">{endpoint.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="rounded-2xl bg-panel px-5 py-8 text-center text-14 text-faint">No endpoint matches “{query}”.</p>
      )}
      <ShowAll hidden={hidden} noun="endpoints" onClick={() => setAll(true)} />
    </div>
  );
}
