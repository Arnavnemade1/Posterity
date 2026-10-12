import { serveGuide } from '@/lib/guides';

export function GET() {
  return serveGuide('skill.json');
}
