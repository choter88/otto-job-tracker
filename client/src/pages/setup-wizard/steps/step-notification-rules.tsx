import NotificationRules from "@/components/notification-rules";

export default function StepNotificationRules() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold">Overdue rules</h2>
        <p className="text-muted-foreground mt-1">
          Get alerted when a job sits in a status too long. Pick a status, a maximum
          age in days, and which roles to notify. You can add as many rules as you need.
        </p>
      </div>
      <div className="rounded-lg border border-border bg-card p-4">
        <NotificationRules />
      </div>
    </div>
  );
}
