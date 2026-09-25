import { SettingsBusinessProfile } from "@/components/settings/SettingsBusinessProfile";
import { SettingsBookingRules } from "@/components/settings/SettingsBookingRules";
import { SettingsWorkingHours } from "@/components/settings/SettingsWorkingHours";
import { SettingsReputation } from "@/components/settings/SettingsReputation";
import { SettingsIntegrations } from "@/components/settings/SettingsIntegrations";
import { SettingsTeam } from "@/components/settings/SettingsTeam";

export function SettingsPage() {
  return (
    <div className="max-w-3xl p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="font-display text-2xl text-ink">Settings</h1>
        <p className="mt-0.5 text-sm text-ink-muted">
          Business-wide configuration — service prices and staff schedules live on their own pages, not here.
        </p>
      </div>

      <div className="space-y-6">
        <SettingsBusinessProfile />
        <SettingsWorkingHours />
        <SettingsBookingRules />
        <SettingsReputation />
        <SettingsIntegrations />
        <SettingsTeam />
      </div>
    </div>
  );
}
