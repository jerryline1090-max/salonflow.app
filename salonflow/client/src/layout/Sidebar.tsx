import { NavLink } from "react-router-dom";
import { useAuth } from "@/auth/AuthContext";

interface NavItem {
  label: string;
  to: string;
  icon: JSX.Element;
  implemented: boolean;
}

function Icon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d={d} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", to: "/", icon: <Icon d="M3 10l7-6 7 6M5 9v8h10V9" />, implemented: true },
  { label: "Appointments", to: "/appointments", icon: <Icon d="M4 4h12v13H4zM4 8h12M7 2v3M13 2v3" />, implemented: true },
  { label: "Calendar", to: "/calendar", icon: <Icon d="M4 4h12v13H4zM4 8h12M8 12h1M11 12h1" />, implemented: true },
  { label: "Clients", to: "/clients", icon: <Icon d="M10 10a3 3 0 100-6 3 3 0 000 6zM4 17c0-3 3-5 6-5s6 2 6 5" />, implemented: true },
  { label: "Services", to: "/services", icon: <Icon d="M6 3l8 8-4 4-8-8V3h4z" />, implemented: true },
  {
    label: "Staff",
    to: "/staff",
    icon: <Icon d="M7 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM13 9a2.5 2.5 0 100-5 2.5 2.5 0 000 5zM2 17c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5M10 12.7c.7-1.3 2.2-2.2 3.8-2.2 2.8 0 5 2 5 4.5" />,
    implemented: true,
  },
  { label: "Payments", to: "/payments", icon: <Icon d="M3 6h14v9H3zM3 9h14M6 12h2" />, implemented: true },
  { label: "Reports", to: "/reports", icon: <Icon d="M4 16V9M9 16V4M14 16v-6" />, implemented: true },
  { label: "Notifications", to: "/notifications", icon: <Icon d="M10 3a5 5 0 00-5 5v3l-1.5 3h13L15 11V8a5 5 0 00-5-5zM8 17a2 2 0 004 0" />, implemented: true },
];

export function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  const { logout, user } = useAuth();

  return (
    <aside id="primary-navigation" aria-label="Primary navigation" className={`fixed inset-y-0 left-0 z-50 flex h-screen w-64 shrink-0 flex-col border-r border-white/10 bg-sidebar text-white shadow-popover transition-transform duration-200 md:static md:z-auto md:w-60 md:translate-x-0 md:shadow-none ${mobileOpen ? "translate-x-0" : "-translate-x-full"}`}>
      <div className="flex items-center justify-between px-5 pb-5 pt-6">
        <p className="font-display text-xl text-white leading-none">SalonFlow</p>
        <button onClick={onNavigate} aria-label="Close navigation" className="min-h-11 min-w-11 rounded p-1 text-slate-300 hover:bg-white/10 md:hidden">×</button>
      </div>

      <nav className="flex-1 space-y-0.5 px-3">
        {NAV_ITEMS.map((item) =>
          item.implemented ? (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              onClick={onNavigate}
              className={({ isActive }) =>
                `flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${
                  isActive ? "bg-brass-500 text-white font-medium" : "text-slate-300 hover:bg-white/10 hover:text-white"
                }`
              }
            >
              {item.icon}
              {item.label}
            </NavLink>
          ) : (
            <div
              key={item.to}
              title="Coming soon"
              className="flex items-center gap-2.5 rounded px-3 py-2 text-sm text-ink-muted/60 cursor-default"
            >
              {item.icon}
              {item.label}
            </div>
          )
        )}
      </nav>

      <div className="mx-5 border-t border-white/10" />
      <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => `mx-3 mt-3 flex min-h-10 items-center gap-2.5 rounded-md px-3 py-2 text-sm transition-colors ${isActive ? "bg-brass-500 text-white font-medium" : "text-slate-300 hover:bg-white/10 hover:text-white"}`}><Icon d="M10 13a3 3 0 100-6 3 3 0 000 6z M4 10a6 6 0 0012 0 6 6 0 00-12 0z" />Settings</NavLink>

      <div className="mt-3 border-t border-white/10 px-5 py-4">
        <p className="text-sm font-medium text-white truncate">{user?.name}</p>
        <p className="text-xs text-slate-400">
          {user?.role.charAt(0)}
          {user?.role.slice(1).toLowerCase()}
        </p>
        <button onClick={logout} className="mt-2 text-xs text-slate-300 hover:text-white underline underline-offset-2">
          Sign out
        </button>
        <p className="mt-4 text-[11px] text-slate-500">Powered by SalonFlow</p>
      </div>
    </aside>
  );
}
