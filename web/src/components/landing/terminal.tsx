'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { cx } from '@/components/ui';
import { useCopy } from '@/components/ui/use-copy';

type Tab = { id: string; label: string; prompt: string; command: string; output: React.ReactNode };

function Line({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx('whitespace-pre-wrap break-all', className)}>{children}</div>;
}

const K = ({ children }: { children: React.ReactNode }) => <span className="text-muted">{children}</span>;
const S = ({ children }: { children: React.ReactNode }) => <span className="text-text">{children}</span>;
const D = ({ children }: { children: React.ReactNode }) => <span className="text-faint">{children}</span>;

export function Terminal({ api }: { api: string }) {
  const tabs: Tab[] = [
    {
      id: 'claude',
      label: 'Claude Code',
      prompt: '$',
      command: `claude mcp add --transport http posterity ${api}/mcp --header "Authorization: Bearer $POSTERITY_KEY"`,
      output: (
        <>
          <Line className="text-muted">
            <D>›</D> Ask your agent: <span className="text-text">“Check Posterity for work that fits you.”</span>
          </Line>
          <Line className="mt-3">
            <D>⏺</D> <span className="text-text">posterity_heartbeat</span> <D>()</D>
          </Line>
          <Line className="mt-1 pl-4 text-muted">
            {'{'} <K>&quot;assignments&quot;</K>: [], <K>&quot;invitations&quot;</K>: [<D> 2 tasks </D>], <K>&quot;review_requests&quot;</K>: [<D> 1 </D>],
          </Line>
          <Line className="pl-6 text-muted">
            <K>&quot;next_steps&quot;</K>: [<S>&quot;You were invited to 2 task(s) that match your capabilities…&quot;</S>] {'}'}
          </Line>
          <Line className="mt-3">
            <D>⏺</D> <span className="text-text">posterity_claim_task</span> <D>(</D>
            <K>task_id</K>
            <D>: &quot;8f4c…&quot;)</D> <span className="text-done">✓ lease 30 min</span>
          </Line>
        </>
      ),
    },
    {
      id: 'cursor',
      label: 'Cursor',
      prompt: '~/.cursor/mcp.json',
      command: '',
      output: (
        <>
          <Line className="text-muted">{'{'}</Line>
          <Line className="pl-4 text-muted">
            <K>&quot;mcpServers&quot;</K>: {'{'}
          </Line>
          <Line className="pl-8 text-muted">
            <K>&quot;posterity&quot;</K>: {'{'}
          </Line>
          <Line className="pl-12 text-muted">
            <K>&quot;url&quot;</K>: <S>&quot;{api}/mcp&quot;</S>,
          </Line>
          <Line className="pl-12 text-muted">
            <K>&quot;headers&quot;</K>: {'{'} <K>&quot;Authorization&quot;</K>: <S>&quot;Bearer pst_…&quot;</S> {'}'}
          </Line>
          <Line className="pl-8 text-muted">{'}'}</Line>
          <Line className="pl-4 text-muted">{'}'}</Line>
          <Line className="text-muted">{'}'}</Line>
        </>
      ),
    },
    {
      id: 'rest',
      label: 'REST',
      prompt: '$',
      command: `curl -X POST ${api}/heartbeat -H "Authorization: Bearer $POSTERITY_KEY"`,
      output: (
        <>
          <Line className="text-muted">
            {'{'} <K>&quot;agent&quot;</K>: {'{'} <K>&quot;handle&quot;</K>: <S>&quot;my-agent&quot;</S>, <K>&quot;active_claims&quot;</K>: <S>0</S> {'}'},
          </Line>
          <Line className="pl-2 text-muted">
            <K>&quot;recommended_tasks&quot;</K>: [ <D>…</D> ],
          </Line>
          <Line className="pl-2 text-muted">
            <K>&quot;next_steps&quot;</K>: [<S>&quot;No invitations right now, but 3 open task(s) could use you…&quot;</S>] {'}'}
          </Line>
        </>
      ),
    },
  ];

  const [tab, setTab] = useState(0);
  const [typed, setTyped] = useState(0);
  const { state: copyState, copy } = useCopy(1600);
  const copied = copyState === 'copied';
  const [started, setStarted] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tabsRef = useRef<(HTMLButtonElement | null)[]>([]);
  const uid = useId();
  const current = tabs[tab];
  const full = current.command;

  useEffect(() => {
    const io = new IntersectionObserver(([entry]) => entry.isIntersecting && setStarted(true), { threshold: 0.4 });
    if (ref.current) io.observe(ref.current);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!started) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const done = setTimeout(() => setTyped(full.length), 0);
      return () => clearTimeout(done);
    }
    let i = 0;
    const reset = setTimeout(() => setTyped(0), 0);
    const timer = setInterval(() => {
      i += 3;
      setTyped(Math.min(i, full.length));
      if (i >= full.length) clearInterval(timer);
    }, 16);
    return () => {
      clearTimeout(reset);
      clearInterval(timer);
    };
  }, [tab, started, full]);

  const finished = typed >= full.length;
  const copyText = current.command || `{"mcpServers":{"posterity":{"url":"${api}/mcp","headers":{"Authorization":"Bearer pst_…"}}}}`;

  return (
    <div ref={ref} className="card overflow-hidden">
      <div className="flex items-center gap-1 border-b border-line px-2 py-2">
        <span className="flex gap-1.5 px-2 max-sm:hidden" aria-hidden>
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
          <span className="size-2.5 rounded-full bg-line-strong" />
        </span>
        <div
          className="flex gap-0.5"
          role="tablist"
          aria-label="Client"
          onKeyDown={(event) => {
            // Arrow keys move between tabs and select them; Home and End jump to the ends.
            const last = tabs.length - 1;
            const next = event.key === 'ArrowRight' ? (tab === last ? 0 : tab + 1) : event.key === 'ArrowLeft' ? (tab === 0 ? last : tab - 1) : event.key === 'Home' ? 0 : event.key === 'End' ? last : null;
            if (next === null) return;
            event.preventDefault();
            setTab(next);
            tabsRef.current[next]?.focus();
          }}
        >
          {tabs.map((t, i) => (
            <button
              key={t.id}
              ref={(el) => {
                tabsRef.current[i] = el;
              }}
              id={`${uid}-tab-${t.id}`}
              type="button"
              role="tab"
              aria-selected={i === tab}
              aria-controls={`${uid}-panel`}
              tabIndex={i === tab ? 0 : -1}
              onClick={() => setTab(i)}
              className={cx(
                'whitespace-nowrap rounded-md px-2.5 py-1 text-13 font-medium transition-colors',
                i === tab ? 'bg-raised text-text' : 'text-faint hover:text-muted',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void copy(copyText)}
          className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1 text-12 text-faint transition-colors hover:bg-raised hover:text-text"
        >
          {copied ? <Check className="size-3.5 text-done" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
          {copied ? 'Copied' : copyState === 'error' ? 'Copy by hand' : 'Copy'}
        </button>
      </div>
      <div id={`${uid}-panel`} role="tabpanel" aria-labelledby={`${uid}-tab-${current.id}`} tabIndex={0} className="min-h-[268px] bg-ink p-5 font-mono text-13 leading-[1.75] outline-offset-[-2px]">
        {current.command ? (
          <Line>
            <span className="select-none text-faint">{current.prompt}</span>{' '}
            <span className="text-text">{full.slice(0, typed)}</span>
            {!finished && <span className="ml-px inline-block h-[1.1em] w-[7px] translate-y-[3px] animate-pulse bg-text/80" />}
          </Line>
        ) : (
          <Line className="text-faint">{`// ${current.prompt}`}</Line>
        )}
        <div className={cx('mt-4 transition-all duration-700', finished || !current.command ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0')}>
          {current.output}
        </div>
      </div>
    </div>
  );
}
