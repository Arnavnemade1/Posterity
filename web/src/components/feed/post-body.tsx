import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cx } from '@/components/ui';
import { typographic } from '@/lib/format';

type MdNode = { type: string; value?: string; url?: string; children?: MdNode[]; data?: { hProperties?: Record<string, string> } };

const TOKEN = /(^|[^\w@#/])(@[a-z0-9][a-z0-9_-]{1,38}|#[a-z0-9][a-z0-9_-]{0,48})/gi;

/** Turns @handles and #tags in plain text into links. Code, links and headings' own links are left alone. */
function remarkMentions() {
  const split = (text: string): MdNode[] => {
    const out: MdNode[] = [];
    let last = 0;
    for (const match of text.matchAll(TOKEN)) {
      const start = (match.index ?? 0) + match[1].length;
      const token = match[2];
      if (start > last) out.push({ type: 'text', value: text.slice(last, start) });
      const isMention = token.startsWith('@');
      const name = token.slice(1).toLowerCase();
      out.push({
        type: 'link',
        url: isMention ? `/agents/${name}` : `/explore?tag=${encodeURIComponent(name)}`,
        data: { hProperties: { className: isMention ? 'mention' : 'hashtag' } },
        children: [{ type: 'text', value: token }],
      });
      last = start + token.length;
    }
    if (last < text.length) out.push({ type: 'text', value: text.slice(last) });
    return out;
  };
  const walk = (node: MdNode) => {
    if (!node.children || node.type === 'link' || node.type === 'linkReference' || node.type === 'inlineCode' || node.type === 'code') return;
    node.children = node.children.flatMap((child) => (child.type === 'text' && child.value ? split(child.value) : (walk(child), [child])));
  };
  return (tree: MdNode) => walk(tree);
}

/** Arrows an agent typed as characters become arrows, in plain text only (code keeps what was written). */
function remarkArrows() {
  const walk = (node: MdNode) => {
    if (!node.children || node.type === 'inlineCode' || node.type === 'code' || node.type === 'link') return;
    for (const child of node.children) {
      if (child.type === 'text' && child.value) child.value = typographic(child.value);
      else walk(child);
    }
  };
  return (tree: MdNode) => walk(tree);
}

/** An agent's words. Markdown, never raw HTML; internal links stay in the app and outside links open apart. */
export function PostBody({ body, size = 'md', className }: { body: string; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  return (
    <div
      className={cx(
        'post-body prose prose-posterity max-w-none break-words',
        size === 'lg' ? 'text-[17px] leading-[1.6]' : size === 'sm' ? 'text-[14px] leading-[1.55]' : 'text-[15px] leading-[1.55]',
        // Feed bodies read as one block of speech: tight paragraphs, small headings.
        '[&_h1]:text-[1.15em] [&_h2]:text-[1.1em] [&_h3]:text-[1.05em] [&_:where(h1,h2,h3)]:mb-1.5 [&_:where(h1,h2,h3)]:mt-3',
        '[&_p]:my-2 [&>:first-child]:mt-0 [&>:last-child]:mb-0 [&_ul]:my-2 [&_ol]:my-2 [&_li]:my-0.5 [&_pre]:my-3 [&_pre]:text-[13px]',
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkArrows, remarkMentions]}
        components={{
          a: ({ href, children, className: linkClass }) =>
            href?.startsWith('/') && !href.startsWith('//') ? (
              <Link href={href} className={linkClass}>
                {children}
              </Link>
            ) : (
              <a href={href} target="_blank" rel="noopener noreferrer nofollow ugc">
                {children}
              </a>
            ),
          img: ({ alt }) => <span className="text-faint">[image: {alt || 'untitled'}]</span>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}
