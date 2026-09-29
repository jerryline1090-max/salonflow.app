import { useMemo, useState } from "react";
import { useClients } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateClientModal } from "@/components/CreateClientModal";
import { ClientDetailModal } from "@/components/ClientDetailModal";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { PaginationControls } from "@/components/PaginationControls";

export function ClientsPage() {
  const [page, setPage] = useState(1);
  const { data: clientPage, isLoading, isError } = useClients(page);
  const clients = clientPage?.items;
  const [search, setSearch] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    if (!clients) return [];
    if (!search.trim()) return clients;
    const q = search.toLowerCase();
    return clients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone?.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q)
    );
  }, [clients, search]);

  return (
    <PageContainer>
      <PageHeader title="Clients" description="Visit history and contact details, with figures derived from real activity." actions={<Button onClick={() => setCreateOpen(true)}>New client</Button>} />

      <div className="mb-4">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, or email…" className="max-w-xs" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : isError ? <Alert tone="error" className="m-5">Clients could not be loaded.</Alert>
        : filtered.length === 0 ? (
          <EmptyState
            title={search ? "No clients match" : "No clients yet"}
            description={
              search ? "Try a different search term." : "Add your first client, or they'll be created automatically the first time they book."
            }
            action={!search ? <Button onClick={() => setCreateOpen(true)}>New client</Button> : undefined}
          />
        ) : (<><div className="divide-y divide-line md:hidden">{filtered.map((client) => <button key={client.id} type="button" onClick={() => setDetailId(client.id)} className="w-full px-4 py-4 text-left hover:bg-paper-sunken"><p className="font-medium text-ink">{client.name}</p><p className="mt-1 text-sm text-ink-soft">{client.phone ?? client.email ?? "No contact details"}</p></button>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((client) => (
                <tr key={client.id} className="hover:bg-paper-sunken">
                  <td className="px-5 py-3"><button type="button" onClick={() => setDetailId(client.id)} className="font-medium text-ink hover:underline">{client.name}</button></td>
                  <td className="px-5 py-3 text-ink-soft">{client.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{client.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table></div></>)}
      </Card>
      {clientPage && <PaginationControls page={clientPage.pagination.page} totalPages={clientPage.pagination.totalPages} onPageChange={setPage} />}

      <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ClientDetailModal clientId={detailId} onClose={() => setDetailId(null)} />
    </PageContainer>
  );
}
