import { useState, type ReactNode } from "react";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { AssistantChat } from "@/components/AssistantChat";

export function AppShell({ children }: { children: ReactNode }) {
  const [navigationOpen, setNavigationOpen] = useState(false);
  return (
    <div className="flex h-screen overflow-hidden">
      {navigationOpen && <button aria-label="Close navigation" onClick={() => setNavigationOpen(false)} className="fixed inset-0 z-40 bg-ink/35 md:hidden" />}
      <Sidebar mobileOpen={navigationOpen} onNavigate={() => setNavigationOpen(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Topbar onMenuClick={() => setNavigationOpen(true)} />
        <main className="min-w-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-thin">{children}</main>
      </div>
      <AssistantChat />
    </div>
  );
}
