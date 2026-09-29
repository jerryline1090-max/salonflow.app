import type { Request } from "express";

export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

export function parsePagination(query: Request["query"]) {
  const page = Math.max(1, Number.parseInt(String(query.page ?? "1"), 10) || 1);
  const requestedLimit = Number.parseInt(String(query.limit ?? DEFAULT_PAGE_SIZE), 10) || DEFAULT_PAGE_SIZE;
  const limit = Math.min(Math.max(1, requestedLimit), MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit };
}

export function pageResult<T>(items: T[], total: number, page: number, limit: number) {
  return { items, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
