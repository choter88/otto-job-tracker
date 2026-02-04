import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bell, CheckCheck, MessageCircle, AlertTriangle, TrendingUp, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { formatDistanceToNow } from "date-fns";
import { useLocation } from "wouter";
import type { Notification } from "@shared/schema";

export default function NotificationBell() {
  const [, setLocation] = useLocation();
  const [isOpen, setIsOpen] = useState(false);
  // NOTIFICATION SYSTEM DISABLED TO REDUCE COSTS
  // WebSocket connections and real-time notifications are turned off
  // To re-enable, uncomment the code below and in server/index.ts
  
  const notifications: Notification[] = [];
  const notificationsLoading = false;
  const unreadCount = 0;

  const markAsReadMutation = useMutation({
    mutationFn: async (_notificationId: string) => {
      // Disabled
    },
    onSuccess: () => {},
  });

  const markAllAsReadMutation = useMutation({
    mutationFn: async () => {
      // Disabled
    },
    onSuccess: () => {},
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

    // Navigate to the link if provided
    if (notification.linkTo) {
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
              className="absolute -top-1 -right-1 h-5 w-5 rounded-full p-0 text-xs flex items-center justify-center"
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
        <ScrollArea className="max-h-[400px]">
          {notificationsLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="flex gap-3" data-testid={`skeleton-notification-${i}`}>
                  <Skeleton className="h-8 w-8 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                </div>
              ))}
            </div>
          ) : notifications.length === 0 ? (
            <div
              className="p-8 text-center text-muted-foreground"
              data-testid="empty-notifications"
            >
              <Bell className="h-12 w-12 mx-auto mb-3 opacity-20" />
              <p className="text-sm">No new notifications</p>
            </div>
          ) : (
            <div className="py-2">
              {notifications.map((notification, index) => (
                <div key={notification.id}>
                  <button
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-4 py-3 hover:bg-muted transition-colors flex gap-3 ${
                      !notification.readAt ? 'bg-blue-50/50 dark:bg-blue-950/20' : ''
                    }`}
                    data-testid={`notification-item-${notification.id}`}
                  >
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className="font-medium text-sm" data-testid={`notification-title-${notification.id}`}>
                          {notification.title}
                        </p>
                        {!notification.readAt && (
                          <div
                            className="w-2 h-2 bg-blue-500 rounded-full flex-shrink-0 mt-1"
                            data-testid={`unread-indicator-${notification.id}`}
                          />
                        )}
                      </div>
                      <p
                        className="text-sm text-muted-foreground mt-1 line-clamp-2"
                        data-testid={`notification-message-${notification.id}`}
                      >
                        {notification.message}
                      </p>
                      <p
                        className="text-xs text-muted-foreground mt-1"
                        data-testid={`notification-time-${notification.id}`}
                      >
                        {formatDistanceToNow(new Date(notification.createdAt), { addSuffix: true })}
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
