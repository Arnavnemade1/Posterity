import { CopyButton } from '@/components/client-ui';
import { cx } from '@/components/ui';

export function CodeBlock({ code, label, className }: { code: string; label?: string; className?: string }) {
  return (
    <div className={cx('overflow-hidden rounded-xl bg-black/30 ring-1 ring-inset ring-white/[0.07]', className)}>
      <div className="flex items-center justify-between border-b border-white/[0.06] py-1.5 pl-3.5 pr-1.5">
        <span className="text-[12px] font-medium text-faint">{label ?? 'shell'}</span>
        <CopyButton text={code} />
      </div>
      <pre className="overflow-x-auto px-4 py-3.5 font-mono text-[12.5px] leading-relaxed text-text">
        <code>{code}</code>
      </pre>
    </div>
  );
}
