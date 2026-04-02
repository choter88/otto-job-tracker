import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import JobCommentsPanel from "@/components/job-comments-panel";
import type { Job } from "@shared/schema";

interface CommentsSidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: Job;
}

export default function CommentsSidebar({ open, onOpenChange, job }: CommentsSidebarProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={() => onOpenChange(false)}
      data-testid="overlay-comments"
    >
      <div className="absolute inset-0 bg-black/20" />

      <div
        className="absolute top-0 right-0 h-full w-96 bg-card border-l border-border shadow-hard animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
        data-testid="sidebar-comments"
      >
        <JobCommentsPanel
          job={job}
          header={
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div>
                <h3 className="font-semibold text-lg">Comments</h3>
                <p className="text-sm text-muted-foreground">{job.patientFirstName} {job.patientLastName} · {job.jobType}</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => onOpenChange(false)}
                data-testid="button-close-comments"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          }
          className="h-full"
        />
      </div>
    </div>
  );
}
