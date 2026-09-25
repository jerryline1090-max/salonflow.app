import { EmptyState } from "@/components/EmptyState";

export function ComingSoonPage({ pageName }: { pageName: string }) {
  return (
    <div className="p-8">
      <EmptyState
        title={`${pageName} is on the way`}
        description="This part of SalonFlow hasn't been built yet — Dashboard and Appointments are ready now, with the rest of the connected system following the same architecture."
      />
    </div>
  );
}
