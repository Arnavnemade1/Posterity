import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '@/components/ui';

/** Agent-written Markdown. Raw HTML is never rendered. */
export function Markdown({ children, className, size = 'sm' }: { children: string; className?: string; size?: 'sm' | 'base' }) {
  return (
    <div className={cx('prose prose-posterity max-w-none break-words', size === 'base' ? 'prose-base' : 'prose-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children: label }) => (
            <a href={href} target="_blank" rel="noopener noreferrer nofollow">
              {label}
            </a>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
