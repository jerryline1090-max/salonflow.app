import { useEffect, useRef, useState } from "react";
import { useBusiness, useMarkNotificationRead, useNotifications } from "@/hooks/useAppData";
import { formatDateTime } from "@/utils/format";

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const { data: business } = useBusiness();
  const [notifOpen, setNotifOpen] = useState(false);
  const { data: notifications } = useNotifications({ limit: 15 });
  const markRead = useMarkNotificationRead();
  const seenNotificationIds = useRef<Set<string> | null>(null);

  const unreadCount = notifications?.filter((n) => !n.isRead).length ?? 0;

  // Notifications are opt-in and only display newly received, high-priority
  // records while the app is open. Initial data is deliberately marked as
  // seen so opening the dashboard never produces a burst of old alerts.
  useEffect(() => {
    if (!notifications || !("Notification" in window)) return;
    if (!seenNotificationIds.current) {
      seenNotificationIds.current = new Set(notifications.map((notification) => notification.id));
      return;
    }
    for (const notification of notifications) {
      if (!seenNotificationIds.current.has(notification.id) && notification.priority !== "LOW" && Notification.permission === "granted") {
        new Notification(notification.title, { body: notification.body, tag: notification.id });
      }
      seenNotificationIds.current.add(notification.id);
    }
  }, [notifications]);

  async function enableBrowserAlerts() {
    if ("Notification" in window && Notification.permission === "default") await Notification.requestPermission();
  }

  return (
    <header className="flex h-16 shrink-0 items-center justify-between border-b border-line bg-paper px-4 sm:px-6">
      <div className="flex min-w-0 items-center gap-2">
        <button onClick={onMenuClick} aria-label="Open navigation" className="rounded p-2 text-ink-soft hover:bg-paper-sunken md:hidden">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 5h14M3 10h14M3 15h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </button>
        {/* Section 5: the business's own name is the primary identity the
            owner sees when they open the app — SalonFlow stays in the sidebar footer. */}
        <p className="truncate font-display text-lg text-ink leading-none">{business?.name ?? "\u00A0"}</p>
      </div>

      <div className="relative">
        <button
          onClick={() => setNotifOpen((v) => !v)}
          aria-label="Notifications"
          className="relative flex h-9 w-9 items-center justify-center rounded-full text-ink-soft hover:bg-paper-sunken transition-colors"
        >
          <svg width="19" height="19" viewBox="0 0 20 20" fill="none">
            <path
              d="M10 3a5 5 0 00-5 5v3l-1.5 3h13L15 11V8a5 5 0 00-5-5zM8 17a2 2 0 004 0"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
          {unreadCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-medium text-white">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </button>

        {notifOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setNotifOpen(false)} />
            <div className="fixed right-3 top-14 z-20 max-h-[min(28rem,calc(100vh-4rem))] w-[calc(100vw-1.5rem)] overflow-y-auto scrollbar-thin rounded-lg border border-line bg-paper-raised shadow-popover sm:absolute sm:right-0 sm:top-auto sm:mt-2 sm:w-96">
              <div className="sticky top-0 border-b border-line bg-paper-raised px-4 py-3">
                <div className="flex items-center justify-between gap-3"><p className="text-sm font-medium text-ink">Notifications</p>
                {"Notification" in window && Notification.permission === "default" && <button onClick={enableBrowserAlerts} className="text-xs font-medium text-brass-600 hover:underline">Enable browser alerts</button>}</div>
              </div>
              {!notifications || notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-sm text-ink-muted">You're all caught up.</p>
              ) : (
                <ul className="divide-y divide-line">
                  {notifications.map((n) => (
                    <li
                      key={n.id}
                      className={`px-4 py-3 cursor-pointer hover:bg-paper-sunken ${!n.isRead ? "bg-brass-50/60" : ""}`}
                      onClick={() => !n.isRead && markRead.mutate(n.id)}
                    >
                      <p className="text-sm font-medium text-ink">{n.title}</p>
                      <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>
                      <p className="mt-1 text-xs text-ink-muted">{formatDateTime(n.createdAt)}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        )}
      </div>
    </header>
  );
}
