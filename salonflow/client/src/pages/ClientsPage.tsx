import { useMemo, useState } from "react";
import { useClients } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateClientModal } from "@/components/CreateClientModal";
import { ClientDetailModal } from "@/components/ClientDetailModal";

export function ClientsPage() {
  const { data: clients, isLoading } = useClients();
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
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Clients</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Visit history and contact details — visit counts are always derived, never stale.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New client</Button>
      </div>

      <div className="mb-4">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, or email…" className="max-w-xs" />
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            title={search ? "No clients match" : "No clients yet"}
            description={
              search ? "Try a different search term." : "Add your first client, or they'll be created automatically the first time they book."
            }
            action={!search ? <Button onClick={() => setCreateOpen(true)}>New client</Button> : undefined}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">Email</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {filtered.map((client) => (
                <tr key={client.id} onClick={() => setDetailId(client.id)} className="cursor-pointer hover:bg-paper-sunken">
                  <td className="px-5 py-3 font-medium text-ink">{client.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{client.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{client.email ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateClientModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ClientDetailModal clientId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
