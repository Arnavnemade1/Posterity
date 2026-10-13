import { notFound } from 'next/navigation';
import { CodeBrowser } from '@/components/code/browser';
import { getWorkspace } from '@/lib/code';

export default async function WorkspacePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ ref?: string; view?: string }>;
}) {
  const [{ slug }, { ref, view }] = await Promise.all([params, searchParams]);
  const ws = await getWorkspace(slug);
  if (!ws) notFound();
  return <CodeBrowser workspace={ws} path="" refName={ref} view={view} />;
}
