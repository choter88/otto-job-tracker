import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Bell, CheckCheck, MessageCircle, AlertTriangle, TrendingUp, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { Notification } from "@shared/schema";

export default function NotificationBell() {
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);

  const { data: unreadCountData } = useQuery<{ count: number }>({
    queryKey: ["/api/notifications/unread-count"],
  });

  const unreadCount = unreadCountData?.count || 0;

  const { data: notifications = [], isLoading: notificationsLoading } = useQuery<Notification[]>({
    queryKey: ["/api/notifications", "recent"],
    queryFn: async () => {
      const res = await fetch("/api/notifications?limit=25&offset=0", {
        credentials: "include",
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => null);
        throw new Error(payload?.error || payload?.message || res.statusText || "Failed to load notifications");
      }
      return res.json();
    },
    enabled: isOpen,
  });

  const markAsReadMutation = useMutation({
    mutationFn: async (notificationId: string) => {
      const res = await apiRequest("PATCH", `/api/notifications/${notificationId}/read`, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
    },
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/notifications/read-all", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/notifications/unread-count"] });
      queryClient.invalidateQueries({ queryKey: ["/api/notifications", "recent"] });
    },
  });

  const getNotificationIcon = (type: string) => {
    switch (type) {
      case "status_change":
        return <TrendingUp className="h-4 w-4 text-blue-500" />;
      case "comment":
        return <MessageCircle className="h-4 w-4 text-green-500" />;
      case "overdue_alert":
        return <AlertTriangle className="h-4 w-4 text-orange-500" />;
      case "team_update":
        return <User className="h-4 w-4 text-purple-500" />;
      default:
        return <Bell className="h-4 w-4 text-gray-500" />;
    }
  };

  const handleNotificationClick = async (notification: Notification) => {
    // Mark as read if not already read
    if (!notification.readAt) {
      await markAsReadMutation.mutateAsync(notification.id);
    }

    // Close popover
    setIsOpen(false);

    // Navigate to the relevant job (desktop app doesn't have /jobs/:id routes)
    const jobId = (notification as any).jobId as string | undefined;
    if (jobId) {
      const panel = notification.type === "comment" ? "comments" : "overview";
      setLocation("/");
      window.setTimeout(() => {
        try {
          window.dispatchEvent(new CustomEvent("otto:openJob", { detail: { jobId, panel } }));
        } catch {
          // ignore
        }
      }, 150);
      return;
    }

    if (notification.linkTo && !notification.linkTo.startsWith("/jobs/")) {
      setLocation(notification.linkTo);
    }
  };

  const handleMarkAllAsRead = async () => {
    await markAllAsReadMutation.mutateAsync();
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notifications"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center bg-red-500 text-white border-0 hover:bg-red-500"
              data-testid="badge-unread-count"
            >
              {unreadCount > 9 ? '9+' : unreadCount}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-96 p-0"
        align="end"
        data-testid="popover-notifications"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b">
          <h3 className="font-semibold text-sm" data-testid="text-notifications-title">
            Notifications
          </h3>
          {unreadCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleMarkAllAsRead}
              disabled={markAllAsReadMutation.isPending}
              data-testid="button-mark-all-read"
            >
              <CheckCheck className="h-4 w-4 mr-2" />
              Mark all as read
            </Button>
          )}
        </div>

        {/* Notifications List */}
        <ScrollArea className="h-[360px]">
          {notificationsLoading ? (
            <div className="p-3 space-y-2">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-2 py-1" data-testid={`skeleton-notification-${i}`}>
                  <Skeleton className="h-4 w-4 rounded-full shrink-0" />
                  <div className="flex-1 space-y-1">
                    <Skeleton className="h-3 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div
              className="flex flex-col items-center justify-center p-8 text-center"
              data-testid="empty-notifications"
            >
              <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center mb-2">
                <Bell className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-sm font-medium text-foreground">No notifications</p>
              <p className="text-xs text-muted-foreground mt-0.5">You're all caught up.</p>
            </div>
          ) : (
            <div>
              {notifications.map((notification, index) => (
                <div key={notification.id}>
                  <button
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-3 py-2 hover:bg-muted/60 transition-colors flex items-start gap-2 ${
                      !notification.readAt ? 'bg-red-50/50 dark:bg-red-950/20' : ''
                    }`}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex-shrink-0 mt-0.5">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-medium text-xs truncate flex-1" data-testid={`notification-title-${notification.id}`}>
                          {notification.title}
                        </p>
                        <span className="text-[10px] text-muted-foreground shrink-0">
                          {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
                        </span>
                        {!notification.readAt && (
                          <div
                            className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0"
                            data-testid={`unread-indicator-${notification.id}`}
                          />
                        )}
                      </div>
                      <p
                        className="text-[11px] text-muted-foreground truncate"
                        data-testid={`notification-message-${notification.id}`}
                      >
                        {notification.message}
                      </p>
                    </div>
                  </button>
                  {index < notifications.length - 1 && <Separator />}
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
