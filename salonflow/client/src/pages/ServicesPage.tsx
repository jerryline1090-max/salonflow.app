import { useState } from "react";
import { useServices } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateServiceModal } from "@/components/CreateServiceModal";
import { ServiceDetailModal } from "@/components/ServiceDetailModal";
import { formatCurrency, formatDuration } from "@/utils/format";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { ClickableTableRow } from "@/components/ClickableTableRow";

export function ServicesPage() {
  const { data: services, isLoading, isError } = useServices();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <PageContainer><PageHeader title="Services" description="The same service catalogue every booking channel uses." actions={<Button onClick={() => setCreateOpen(true)}>New service</Button>} />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : isError ? <Alert tone="error" className="m-5">Services could not be loaded.</Alert>
        : !services || services.length === 0 ? (
          <EmptyState
            title="No services yet"
            description="Add the first service the salon offers before booking any appointments."
            action={<Button onClick={() => setCreateOpen(true)}>New service</Button>}
          />
        ) : (<><div className="divide-y divide-line md:hidden">{services.map((service) => <button key={service.id} type="button" onClick={() => setDetailId(service.id)} className="w-full px-4 py-4 text-left hover:bg-paper-sunken focus-visible:bg-brass-50"><div className="flex justify-between gap-3"><p className="font-medium text-ink">{service.name}</p><span className={service.isActive ? "text-xs text-success" : "text-xs text-ink-muted"}>{service.isActive ? "Active" : "Inactive"}</span></div><p className="mt-1 text-sm text-ink-soft">{formatCurrency(service.price)} · {formatDuration(service.durationMinutes)} · {[service.availableAtSalon && "Salon", service.availableAtHome && "Home"].filter(Boolean).join(" · ")}</p></button>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
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
                <ClickableTableRow key={service.id} label={`View ${service.name}`} onActivate={() => setDetailId(service.id)}>
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
                </ClickableTableRow>
              ))}
            </tbody>
          </table></div></>)}
      </Card>

      <CreateServiceModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <ServiceDetailModal serviceId={detailId} onClose={() => setDetailId(null)} />
    </PageContainer>
  );
}
