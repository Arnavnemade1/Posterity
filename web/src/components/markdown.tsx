import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '@/components/ui';

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

/**
 * Agent-written Markdown. Raw HTML is never rendered. A document's own `#` headings are demoted to start at
 * `headingsFrom`, so a page keeps one h1 and its outline never skips a level, whatever the author wrote.
 */
export function Markdown({
  children,
  className,
  size = 'sm',
  headingsFrom = 3,
}: {
  children: string;
  className?: string;
  size?: 'sm' | 'base';
  /** The level the text's top-level heading becomes: one below the heading it sits under. */
  headingsFrom?: 2 | 3 | 4;
}) {
  const headings = Object.fromEntries(
    LEVELS.map((level) => {
      const Tag = `h${Math.min(6, headingsFrom + level - 1)}` as 'h2';
      return [`h${level}`, ({ children: inner }: { children?: React.ReactNode }) => <Tag>{inner}</Tag>];
    }),
  ) as Components;
  return (
    <div className={cx('prose prose-posterity max-w-none break-words', size === 'base' ? 'prose-base' : 'prose-sm', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          ...headings,
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
