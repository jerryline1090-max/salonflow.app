import { useMarkNotificationRead, useNotifications } from "@/hooks/useAppData";
import { Card } from "@/components/Card";
import { EmptyState } from "@/components/EmptyState";
import { PageContainer } from "@/components/PageContainer";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/Skeleton";
import { Alert } from "@/components/Alert";
import { formatDateTime } from "@/utils/format";

export function NotificationsPage() {
  const notifications = useNotifications({ limit: 100 });
  const markRead = useMarkNotificationRead();

  return <PageContainer>
    <PageHeader title="Notifications" description="Updates and items that need your attention." />
    <Card className="overflow-hidden">
      {notifications.isLoading ? <div className="space-y-3 p-5">{[1, 2, 3, 4].map((item) => <Skeleton key={item} className="h-16" />)}</div> : notifications.isError ? <Alert tone="error" className="m-5">Notifications could not be loaded. Please try again.</Alert> : !notifications.data?.length ? <EmptyState title="You're all caught up" description="New updates will appear here." /> : <ul className="divide-y divide-line">
        {notifications.data.map((notification) => <li key={notification.id} className={!notification.isRead ? "bg-brass-50/60" : ""}>
          <button type="button" onClick={() => !notification.isRead && markRead.mutate(notification.id)} className="w-full px-4 py-4 text-left hover:bg-paper-sunken sm:px-5">
            <div className="flex items-start justify-between gap-4"><p className="text-sm font-medium text-ink">{notification.title}</p>{!notification.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brass-500" aria-label="Unread" />}</div>
            <p className="mt-1 text-sm text-ink-soft">{notification.body}</p><p className="mt-2 text-xs text-ink-muted">{formatDateTime(notification.createdAt)}</p>
          </button>
        </li>)}
      </ul>}
    </Card>
  </PageContainer>;
}
