import type { PaginatedResult } from "@/types";

/** Optional directory pagination only; NOT a database snapshot. Detect obvious
 * page drift but do not use this helper for appointment completeness/counts. */
export async function completePages<T extends { id: string }>(
  fetchPage: (page: number, limit: number, signal?: AbortSignal) => Promise<PaginatedResult<T>>,
  signal?: AbortSignal,
): Promise<T[]> {
  const items = new Map<string, T>();
  let total: number | undefined;
  let pages = 1;
  let limit = 100;
  for (let page = 1; page <= pages; page++) {
    signal?.throwIfAborted();
    const result = await fetchPage(page, limit, signal);
    signal?.throwIfAborted();
    const meta = result.pagination;
    if (!meta || meta.page !== page || !Number.isSafeInteger(meta.total) || meta.total < 0 ||
        !Number.isSafeInteger(meta.limit) || meta.limit < 1 || meta.limit > 100 ||
        meta.totalPages !== Math.ceil(meta.total / meta.limit) || meta.totalPages > 1000 ||
        (total !== undefined && (meta.total !== total || meta.totalPages !== pages || meta.limit !== limit)) ||
        !Array.isArray(result.items) || result.items.length > meta.limit) {
      throw new Error("The directory could not be loaded. Please retry.");
    }
    total = meta.total;
    pages = meta.totalPages;
    limit = meta.limit;
    const previousSize = items.size;
    for (const item of result.items) {
      if (!item.id) throw new Error("Invalid directory response. Please retry.");
      items.set(item.id, item);
    }
    if (page < pages && items.size === previousSize) throw new Error("Incomplete directory response. Please retry.");
  }
  if (items.size !== total) throw new Error("The directory changed while loading. Please retry.");
  return [...items.values()];
}

export function assertBoundedAppointmentRange(range: { from: string; to: string }) {
  const from = Date.parse(range.from), to = Date.parse(range.to);
  if (!Number.isFinite(from) || !Number.isFinite(to) || to < from || to - from > 32 * 86400_000) {
    throw new Error("A valid appointment range of at most 32 days is required.");
  }
}
