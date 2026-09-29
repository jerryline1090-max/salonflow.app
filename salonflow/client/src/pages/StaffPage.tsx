import { useState } from "react";
import { useStaff } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateStaffModal } from "@/components/CreateStaffModal";
import { StaffDetailModal } from "@/components/StaffDetailModal";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { PaginationControls } from "@/components/PaginationControls";
import { ClickableTableRow } from "@/components/ClickableTableRow";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "text-success",
  INACTIVE: "text-warning",
  REMOVED: "text-ink-muted",
};

export function StaffPage() {
  const [page, setPage] = useState(1);
  const { data: staffPage, isLoading, isError } = useStaff(page);
  const staff = staffPage?.items;
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <PageContainer><PageHeader title="Staff" description="Operational staff profiles, skills, schedules, and availability." actions={<Button onClick={() => setCreateOpen(true)}>New staff member</Button>} />

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : isError ? <Alert tone="error" className="m-5">Staff could not be loaded.</Alert>
        : !staff || staff.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Add the salon's first staff member — this is separate from a login account; add one via Settings once that's built."
            action={<Button onClick={() => setCreateOpen(true)}>New staff member</Button>}
          />
        ) : (<><div className="divide-y divide-line md:hidden">{staff.map((member) => <button key={member.id} type="button" onClick={() => setDetailId(member.id)} className="w-full px-4 py-4 text-left hover:bg-paper-sunken focus-visible:bg-brass-50"><div className="flex justify-between gap-3"><p className="font-medium text-ink">{member.name}</p><span className={`text-xs ${STATUS_STYLES[member.status]}`}>{member.status.charAt(0) + member.status.slice(1).toLowerCase()}</span></div><p className="mt-1 text-sm text-ink-soft">{member.skills.join(", ") || "No skills assigned"}</p></button>)}</div><div className="hidden overflow-x-auto md:block"><table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="px-5 py-3 font-medium">Name</th>
                <th className="px-5 py-3 font-medium">Phone</th>
                <th className="px-5 py-3 font-medium">Skills</th>
                <th className="px-5 py-3 font-medium">Home visits</th>
                <th className="px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {staff.map((member) => (
                <ClickableTableRow key={member.id} label={`View ${member.name}`} onActivate={() => setDetailId(member.id)}>
                  <td className="px-5 py-3 font-medium text-ink">{member.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.skills.join(", ") || "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.homeServiceEligible ? "Yes" : "No"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs ${STATUS_STYLES[member.status]}`}>
                      {member.status.charAt(0) + member.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                </ClickableTableRow>
              ))}
            </tbody>
          </table></div></>)}
      </Card>
      {staffPage && <PaginationControls page={staffPage.pagination.page} totalPages={staffPage.pagination.totalPages} onPageChange={setPage} />}

      <CreateStaffModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <StaffDetailModal staffId={detailId} onClose={() => setDetailId(null)} />
    </PageContainer>
  );
}
