import { useState, type FormEvent } from "react";
import { Card } from "@/components/Card";
import { Button } from "@/components/Button";
import { Input } from "@/components/Input";
import { Select } from "@/components/Select";
import { useAuth } from "@/auth/AuthContext";
import { useTeam, useInviteTeamMember } from "@/hooks/useSettings";
import { ApiError } from "@/api/client";
import { formatDate } from "@/utils/format";

export function SettingsTeam() {
  const { user } = useAuth();
  const { data: team } = useTeam();
  const inviteTeamMember = useInviteTeamMember();

  const [showInvite, setShowInvite] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STAFF" as "MANAGER" | "STAFF" });
  const [error, setError] = useState<string | null>(null);

  // Section 28: users don't self-select a role — an owner assigns it, and
  // only an OWNER can bring a new account into existence at all by default.
  const canInvite = user?.role === "OWNER";

  async function handleInvite(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await inviteTeamMember.mutateAsync(form);
      setForm({ name: "", email: "", password: "", role: "STAFF" });
      setShowInvite(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't invite this team member.");
    }
  }

  return (
    <Card className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <p className="font-display text-lg text-ink">Team</p>
          <p className="text-sm text-ink-muted">
            Owners, managers, and staff — each with exactly the permissions their role grants, everywhere in the app including the AI.
          </p>
        </div>
        {canInvite && (
          <Button size="sm" onClick={() => setShowInvite((v) => !v)}>
            Invite team member
          </Button>
        )}
      </div>

      {showInvite && (
        <form onSubmit={handleInvite} className="mb-4 grid gap-3 rounded border border-line bg-paper-sunken p-4 sm:grid-cols-2">
          <Input placeholder="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required />
          <Input
            type="email"
            placeholder="Email"
            value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })}
            required
          />
          <Input
            type="password"
            placeholder="Temporary password"
            value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })}
            required
          />
          <Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value as "MANAGER" | "STAFF" })}>
            <option value="STAFF">Staff</option>
            <option value="MANAGER">Manager</option>
          </Select>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setShowInvite(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" loading={inviteTeamMember.isPending}>
              Send invite
            </Button>
          </div>
        </form>
      )}

      {error && (
        <p className="mb-4 text-sm text-danger bg-danger-bg rounded-sm px-3 py-2" role="alert">
          {error}
        </p>
      )}

      {team && team.length > 0 && (
        <div className="overflow-x-auto scrollbar-thin"><table className="min-w-[34rem] w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-ink-muted">
              <th className="py-2 font-medium">Name</th>
              <th className="py-2 font-medium">Email</th>
              <th className="py-2 font-medium">Role</th>
              <th className="py-2 font-medium">Since</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {team.map((member) => (
              <tr key={member.id}>
                <td className="py-2 font-medium text-ink">{member.name}</td>
                <td className="py-2 text-ink-soft">{member.email}</td>
                <td className="py-2 text-ink-soft">{member.role.charAt(0) + member.role.slice(1).toLowerCase()}</td>
                <td className="py-2 text-ink-soft">{formatDate(member.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
    </Card>
  );
}
