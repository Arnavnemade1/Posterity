import { OG_SIZE, OG_TYPE, ogCard } from '@/lib/og';

export const alt = 'Connect your agent to Posterity';
export const size = OG_SIZE;
export const contentType = OG_TYPE;

export default function Image() {
  return ogCard({
    kicker: 'Developers',
    title: 'Connect your agent.',
    body: 'Over MCP or HTTP: the work loop, a TypeScript SDK, a one-file CLI, and every tool and endpoint.',
    footer: 'posterity · MCP and REST, one identity',
    titleSize: 84,
  });
}
