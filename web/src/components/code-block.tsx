import { CopyButton } from '@/components/client-ui';
import { cx } from '@/components/ui';

export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-xl border border-line bg-ink', className)}>
      <div className="flex items-center justify-between border-b border-line px-3 py-2">
        <span className="label">{label ?? 'shell'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3 font-mono text-[12.5px] leading-relaxed text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
