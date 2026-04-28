import { useMemo } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { getColorForBadge } from "@/lib/default-colors";
import { renderMessageTemplate } from "@/lib/message-templates";
import { Copy, MessageSquareText, Send } from "lucide-react";
import { ensureReadyForPickupTemplate } from "@shared/message-template-defaults";
import type { Job, Office } from "@shared/schema";

interface JobMessageTemplatesModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
  office?: Office;
}

function getLabelFromSettings(list: any[], value: string): string {
  if (!value) return "";
  if (!Array.isArray(list) || list.length === 0) return value;

  const byId = list.find((item) => item?.id === value);
  if (byId?.label) return String(byId.label);

  const byLabel = list.find((item) => String(item?.label || "").toLowerCase() === value.toLowerCase());
  if (byLabel?.label) return String(byLabel.label);

  return value;
}

export default function JobMessageTemplatesModal({
  open,
  onOpenChange,
  job,
  office,
}: JobMessageTemplatesModalProps) {
  const { toast } = useToast();

  const settings = (office?.settings || {}) as any;
  const customStatuses = Array.isArray(settings.customStatuses) ? settings.customStatuses : [];
  const customJobTypes = Array.isArray(settings.customJobTypes) ? settings.customJobTypes : [];
  const customOrderDestinations = Array.isArray(settings.customOrderDestinations)
    ? settings.customOrderDestinations
    : [];
  const smsTemplates = useMemo(
    () =>
      ensureReadyForPickupTemplate(
        settings.smsTemplates && typeof settings.smsTemplates === "object" ? settings.smsTemplates : {},
        customStatuses,
      ),
    [settings.smsTemplates, customStatuses],
  );

  const statusLabel = useMemo(
    () => getLabelFromSettings(customStatuses, job.status),
    [customStatuses, job.status],
  );
  const jobTypeLabel = useMemo(
    () => getLabelFromSettings(customJobTypes, job.jobType),
    [customJobTypes, job.jobType],
  );
  const destinationLabel = useMemo(
    () => getLabelFromSettings(customOrderDestinations, job.orderDestination),
    [customOrderDestinations, job.orderDestination],
  );

  const statusColor = useMemo(() => {
    const def = customStatuses.find((s: any) => s?.id === job.status);
    return def?.color || "#64748B";
  }, [customStatuses, job.status]);

  const variables = useMemo(() => {
    const firstName = (job.patientFirstName || "").trim();
    const lastName = (job.patientLastName || "").trim();
    const fullName = `${firstName} ${lastName}`.trim();

    return {
      patient_first_name: firstName,
      patient_last_name: lastName,
      patient_name: fullName,
      order_id: job.orderId || "",
      tray_number: job.trayNumber || "",
      job_type: jobTypeLabel,
      status: statusLabel,
      destination: destinationLabel,
      office_name: office?.name || "",
      office_phone: office?.phone || "",
    };
  }, [job, jobTypeLabel, statusLabel, destinationLabel, office?.name, office?.phone]);

  const templateForStatus = (smsTemplates?.[job.status] || "").trim();
  const renderedMessage = useMemo(
    () => renderMessageTemplate(templateForStatus, variables),
    [templateForStatus, variables],
  );
  const canDraftSms = Boolean((renderedMessage || "").trim());

  const badgeColors = useMemo(() => getColorForBadge(statusColor), [statusColor]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(renderedMessage);
      toast({ title: "Copied", description: "Message copied to clipboard." });
    } catch {
      toast({
        title: "Copy failed",
        description: "Please manually copy the message from the preview.",
        variant: "destructive",
      });
    }
  };

  const handleOpenSmsDraft = async () => {
    const phone = (job.phone || "").trim();
    if (!phone) {
      toast({
        title: "Phone number needed",
        description: "Add a patient phone number to draft an SMS.",
        variant: "destructive",
      });
      return;
    }
    if (!renderedMessage.trim()) {
      toast({
        title: "No message to draft",
        description: "Configure a template for this status first.",
        variant: "destructive",
      });
      return;
    }

    const bridge = (window as any)?.otto;
    if (bridge?.openSmsDraft) {
      const result = await bridge.openSmsDraft({
        phone,
        message: renderedMessage,
      });
      if (result?.ok) {
        toast({ title: "Draft opened", description: "Opened your default messaging app with a draft SMS." });
      } else {
        toast({
          title: "Could not open messaging app",
          description: result?.message || "Please use Copy instead.",
          variant: "destructive",
        });
      }
      return;
    }

    const recipient = phone.replace(/[^\d+,;]/g, "");
    if (!recipient) {
      toast({
        title: "Invalid phone number",
        description: "Please update the patient phone number.",
        variant: "destructive",
      });
      return;
    }

    const smsUrl = `sms:${recipient}?body=${encodeURIComponent(renderedMessage)}`;
    window.location.href = smsUrl;
    toast({ title: "Draft opened", description: "Opening your device messaging app..." });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="w-[min(92vw,720px)] max-w-none max-h-[min(85vh,720px)] overflow-y-auto"
        data-testid="dialog-job-message-templates"
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5" />
            Message Templates
          </DialogTitle>
          <DialogDescription>
            Preview and draft a message for this job in your default messaging app. Otto Tracker doesn’t send texts automatically.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              className="shrink-0"
              style={{ backgroundColor: badgeColors.background, color: badgeColors.text }}
            >
              {statusLabel}
            </Badge>
            <Badge variant="secondary">{jobTypeLabel}</Badge>
            <Badge variant="secondary">{destinationLabel}</Badge>
          </div>

          {templateForStatus ? (
            <div className="p-4 bg-card border border-border rounded-lg space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h4 className="font-medium truncate">Message for “{statusLabel}”</h4>
                  <p className="text-xs text-muted-foreground">
                    Uses the template configured in Settings → Messages.
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    size="sm"
                    onClick={handleOpenSmsDraft}
                    disabled={!canDraftSms}
                    data-testid="button-open-sms-draft"
                  >
                    <Send className="mr-2 h-4 w-4" />
                    Draft SMS
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={handleCopy}
                    disabled={!renderedMessage}
                    data-testid="button-copy-job-message"
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div
                className="rounded-md bg-muted p-3 text-sm whitespace-pre-wrap break-words"
                data-testid="preview-job-message"
              >
                {renderedMessage}
              </div>
              {!job.phone?.trim() && (
                <p className="text-xs text-destructive">
                  No patient phone number is attached to this job. Add a phone number before sending an SMS draft.
                </p>
              )}
            </div>
          ) : (
            <div className="p-8 text-center bg-muted rounded-lg">
              <p className="text-sm font-medium">No message template configured for “{statusLabel}”.</p>
              <p className="text-sm text-muted-foreground mt-1">
                Add one in Settings → Messages to enable quick copy/paste for this status.
              </p>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
