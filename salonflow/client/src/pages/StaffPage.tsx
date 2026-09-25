import { useState } from "react";
import { useStaff } from "@/hooks/useAppData";
import { Button } from "@/components/Button";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { CreateStaffModal } from "@/components/CreateStaffModal";
import { StaffDetailModal } from "@/components/StaffDetailModal";

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: "text-success",
  INACTIVE: "text-warning",
  REMOVED: "text-ink-muted",
};

export function StaffPage() {
  const { data: staff, isLoading } = useStaff();
  const [createOpen, setCreateOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-display text-2xl text-ink">Staff</h1>
          <p className="mt-0.5 text-sm text-ink-muted">Profiles, skills, schedules, and home-service eligibility.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>New staff member</Button>
      </div>

      <Card className="overflow-hidden">
        {isLoading ? (
          <div className="space-y-3 p-5">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-10 animate-pulse rounded bg-paper-sunken" />
            ))}
          </div>
        ) : !staff || staff.length === 0 ? (
          <EmptyState
            title="No staff yet"
            description="Add the salon's first staff member — this is separate from a login account; add one via Settings once that's built."
            action={<Button onClick={() => setCreateOpen(true)}>New staff member</Button>}
          />
        ) : (
          <table className="w-full text-sm">
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
                <tr key={member.id} onClick={() => setDetailId(member.id)} className="cursor-pointer hover:bg-paper-sunken">
                  <td className="px-5 py-3 font-medium text-ink">{member.name}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.phone ?? "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.skills.join(", ") || "—"}</td>
                  <td className="px-5 py-3 text-ink-soft">{member.homeServiceEligible ? "Yes" : "No"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs ${STATUS_STYLES[member.status]}`}>
                      {member.status.charAt(0) + member.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      <CreateStaffModal open={createOpen} onClose={() => setCreateOpen(false)} />
      <StaffDetailModal staffId={detailId} onClose={() => setDetailId(null)} />
    </div>
  );
}
