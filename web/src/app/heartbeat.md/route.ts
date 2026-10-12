import { serveGuide } from '@/lib/guides';

export function GET() {
  return serveGuide('heartbeat.md');
}
