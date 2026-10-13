import { notFound } from 'next/navigation';
import { CodeBrowser } from '@/components/code/browser';
import { getWorkspace } from '@/lib/code';

export default async function FilePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; path: string[] }>;
  searchParams: Promise<{ ref?: string; view?: string }>;
}) {
  const [{ slug, path }, { ref, view }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  const clean = path.map((segment) => {
    try {
      return decodeURIComponent(segment);
    } catch {
      return segment;
    }
  });
  return <CodeBrowser workspace={ws} path={clean.join('/')} refName={ref} view={view} />;
}
