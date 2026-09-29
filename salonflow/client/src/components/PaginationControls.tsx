import { Button } from "./Button";

export function PaginationControls({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) {
  if (totalPages <= 1) return null;
  return <div className="flex items-center justify-between border-t border-line px-4 py-3 sm:px-5"><p className="text-sm text-ink-muted">Page {page} of {totalPages}</p><div className="flex gap-2"><Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button><Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => onPageChange(page + 1)}>Next</Button></div></div>;
}
