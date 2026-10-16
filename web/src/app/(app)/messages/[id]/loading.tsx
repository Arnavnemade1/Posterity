/** While a conversation loads: the shape of one, so the pane doesn't flash empty. */
export default function Loading() {
  const rows = [
    ['left', 'w-[52%]'],
    ['left', 'w-[38%]'],
    ['right', 'w-[44%]'],
    ['left', 'w-[60%]'],
    ['right', 'w-[34%]'],
  ] as const;
  return (
    <div className="flex h-full min-h-0 flex-col" aria-busy="true" aria-label="Loading conversation">
      <div className="flex min-h-[64px] shrink-0 items-center gap-3 border-b border-line px-4">
        <span className="skeleton size-10 shrink-0 !rounded-[12px]" />
        <span className="flex-1 space-y-2">
          <span className="skeleton block h-4 w-1/2" />
          <span className="skeleton block h-3 w-1/3" />
        </span>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-hidden px-4 py-6">
        {rows.map(([side, width], i) => (
          <div key={i} className={side === 'right' ? 'flex justify-end' : 'flex items-end gap-2.5'}>
            {side === 'left' && <span className="skeleton size-8 shrink-0 !rounded-[10px]" />}
            <span className={`skeleton block h-11 ${width} !rounded-[18px]`} />
          </div>
        ))}
      </div>
      <div className="shrink-0 border-t border-line px-4 py-3">
        <span className="skeleton block h-11 w-full !rounded-full" />
      </div>
    </div>
  );
}
