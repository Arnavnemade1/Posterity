import type { Element, Root, RootContent } from 'hast';
import { common, createLowlight } from 'lowlight';
import { cx } from '@/components/ui';

// Syntax highlighting happens on the server, so no highlighter ships to the browser.
const lowlight = createLowlight(common);

const LANGUAGES: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'xml',
  htm: 'xml',
  xml: 'xml',
  svg: 'xml',
  md: 'markdown',
  markdown: 'markdown',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  rs: 'rust',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  php: 'php',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  sql: 'sql',
  lua: 'lua',
  r: 'r',
  graphql: 'graphql',
  gql: 'graphql',
  diff: 'diff',
  patch: 'diff',
};

const NAMES: Record<string, string> = { dockerfile: 'dockerfile', makefile: 'makefile' };

export function languageOf(path: string): string | null {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()! : '';
  const language = LANGUAGES[ext] ?? NAMES[name] ?? null;
  return language && lowlight.registered(language) ? language : null;
}

interface Token {
  text: string;
  cls: string | null;
}

function flatten(node: RootContent | Root, cls: string | null, out: Token[]) {
  if (node.type === 'text') {
    out.push({ text: node.value, cls });
  } else if (node.type === 'element' || node.type === 'root') {
    const own = node.type === 'element' ? (node as Element).properties?.className : null;
    const next = Array.isArray(own) && own.length ? own.join(' ') : cls;
    for (const child of node.children as RootContent[]) flatten(child, next, out);
  }
}

const HIGHLIGHT_MAX_LINES = 2500;
const HIGHLIGHT_MAX_BYTES = 250_000;

/** The file's lines as runs of text with their token classes; tokens that span lines stay coloured. */
export function toLines(code: string, language: string | null): Token[][] {
  const plain = !language || code.length > HIGHLIGHT_MAX_BYTES || code.split('\n').length > HIGHLIGHT_MAX_LINES;
  let tokens: Token[];
  if (plain) {
    tokens = [{ text: code, cls: null }];
  } else {
    tokens = [];
    try {
      flatten(lowlight.highlight(language, code), null, tokens);
    } catch {
      tokens = [{ text: code, cls: null }];
    }
  }
  const lines: Token[][] = [[]];
  for (const token of tokens) {
    const parts = token.text.split('\n');
    parts.forEach((part, i) => {
      if (i > 0) lines.push([]);
      if (part) lines[lines.length - 1].push({ text: part, cls: token.cls });
    });
  }
  // A trailing newline ends the last line; it does not start another.
  if (lines.length > 1 && lines[lines.length - 1].length === 0) lines.pop();
  return lines;
}

/** A source file with line numbers (each a link to itself), highlighted when its language is known. */
export function CodeView({ path, code, className }: { path: string; code: string; className?: string }) {
  const lines = toLines(code, languageOf(path));
  const width = String(lines.length).length;
  return (
    <div className={cx('overflow-x-auto', className)}>
      <table className="w-full border-collapse font-mono text-[12.5px] leading-[1.6]">
        <tbody>
          {lines.map((line, i) => (
            <tr key={i} id={`L${i + 1}`} className="target:bg-claimed/10 hover:bg-fg/[0.025]">
              <td className="select-none whitespace-nowrap px-3 text-right align-top text-faint" style={{ minWidth: `${width + 2}ch` }}>
                <a href={`#L${i + 1}`} className="hover:text-text">
                  {i + 1}
                </a>
              </td>
              <td className="whitespace-pre pr-4 text-prose">
                {line.length ? line.map((t, j) => (t.cls ? <span key={j} className={t.cls}>{t.text}</span> : <span key={j}>{t.text}</span>)) : ' '}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
