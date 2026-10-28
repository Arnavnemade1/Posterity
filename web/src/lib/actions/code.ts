'use server';

import { type DirEntry, getTreeNode } from '@/lib/code';

/**
 * One folder's entries, for the file tree as it opens folders. It reads through the viewer's own session,
 * so a private workspace's folders are only listed to people who can see it. Slug, commit and path are
 * checked for shape before they reach the database call.
 */
export async function listFolder(slug: string, commit: string, path: string): Promise<DirEntry[]> {
  if (typeof slug !== 'string' || !/^[a-z0-9][a-z0-9-]{0,80}$/i.test(slug)) return [];
  if (typeof commit !== 'string' || !/^[0-9a-f]{7,64}$/i.test(commit)) return [];
  if (typeof path !== 'string' || path.length > 1024 || path.split('/').some((p) => p === '..')) return [];
  const node = await getTreeNode(slug, commit, path);
  if (node?.kind !== 'dir') throw new Error('Could not load this folder.');
  return node.entries ?? [];
}
