import { useState } from "react";
import { useServices } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateServiceModal } from "@/components/CreateServiceModal";
import { ServiceDetailModal } from "@/components/ServiceDetailModal";
import { formatCurrency, formatDuration } from "@/utils/format";

export function ServicesPage() {
  const { data: services, isLoading } = useServices();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Services</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            What the salon offers — the same catalog every booking channel reads from.
          </p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New service</Button>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
            ))}
          </div>
        ) : !services || services.length === 0 ? (
          <EmptyState
            title="No services yet"
            description="Add the first service the salon offers before booking any appointments."
            action={<Button onClick={() => setCreateOpen(true)}>New service</Button>}
          />
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Category</th>
                <th className="px-5 py-3 font-medium">Price</th>
                <th className="px-5 py-3 font-medium">Duration</th>
                <th className="px-5 py-3 font-medium">Available</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {services.map((service) => (
                <tr key={service.id} onClick={() => setDetailId(service.id)} className="cursor-pointer hover:bg-paper-sunken">
                  <td className="px-5 py-3 font-medium text-ink">{service.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{service.category ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft tabular-nums">{formatCurrency(service.price)}</td>
                  <td className="px-5 py-3 text-ink-soft">{formatDuration(service.durationMinutes)}</td>
                  <td className="px-5 py-3 text-ink-soft">
                    {[service.availableAtSalon && "Salon", service.availableAtHome && "Home"].filter(Boolean).join(" · ")}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs ${service.isActive ? "text-success" : "text-ink-muted"}`}>
                      {service.isActive ? "Active" : "Inactive"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateServiceModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ServiceDetailModal serviceId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
