interface RpcError { code: string; message: string; details?: string | null }
interface RpcResult<T> { data: T | null; error: RpcError | null }

/** A web release can arrive before the fleet summary migration. Only that missing
 * function enables the legacy path; authorization, network and database failures
 * must keep their original errors rather than presenting an empty fleet. */
export async function resolveFleetDirectory<TSummary, TKey>(
  summary: RpcResult<TSummary>,
  selectedKeys: TKey[],
  legacyKeys: (from: number, to: number) => PromiseLike<RpcResult<TKey[]>>,
): Promise<{ summary: TSummary | null; keys: TKey[] }> {
  if (!summary.error) return { summary: summary.data, keys: selectedKeys };
  const { code, message, details } = summary.error;
  const missing = (code === 'PGRST202' || code === '42883') && `${message} ${details ?? ''}`.includes('web_fleet_summary');
  if (!missing) throw summary.error;

  // Fetch all owned key metadata so non-selected agents retain correct connection
  // states during the rollout. Page the RPC rowset to avoid its response ceiling.
  const keys: TKey[] = [];
  const size = 500;
  for (let from = 0; ; from += size) {
    const page = await legacyKeys(from, from + size - 1);
    if (page.error) throw page.error;
    keys.push(...(page.data ?? []));
    if (!page.data || page.data.length < size) break;
  }
  return { summary: null, keys };
}
