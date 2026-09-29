import { SettingsBusinessProfile } from "@/components/settings/SettingsBusinessProfile";
import { SettingsBookingRules } from "@/components/settings/SettingsBookingRules";
import { SettingsWorkingHours } from "@/components/settings/SettingsWorkingHours";
import { SettingsReputation } from "@/components/settings/SettingsReputation";
import { SettingsIntegrations } from "@/components/settings/SettingsIntegrations";
import { SettingsTeam } from "@/components/settings/SettingsTeam";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { SettingsBilling } from "@/components/settings/SettingsBilling";

export function SettingsPage() {
  return (
    <PageContainer className="max-w-5xl"><PageHeader title="Settings" description="Business configuration. Service prices and operational staff schedules remain on their own screens." />

      <div className="space-y-6">
        <SettingsBilling />
        <SettingsBusinessProfile />
        <SettingsWorkingHours />
        <SettingsBookingRules />
        <SettingsReputation />
        <SettingsIntegrations />
        <SettingsTeam />
      </div>
    </PageContainer>
  );
}
