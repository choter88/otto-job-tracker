import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAuth } from "@/hooks/use-auth";
import type { Job } from "@shared/schema";

export default function CallLabButton({ lab, job, id, office, onPhoneSaved, onCalled }:
  {
    lab?: { id: string; label: string; phone?: string };
    job?: Job;
    id?: string;
    office: any;
    onPhoneSaved: () => void;
    onCalled?: () => void;
  }) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const canEdit = user?.role === "owner" || user?.role === "manager";
  const testId = id ?? job?.id;

  const save = useMutation({
    mutationFn: async (newPhone: string) => {
      const dests = (office?.settings?.customOrderDestinations ?? []).map((d: any) =>
        d.id === lab?.id ? { ...d, phone: newPhone.trim() } : d);
      const settings = { ...office.settings, customOrderDestinations: dests };
      await apiRequest("PUT", `/api/offices/${user?.officeId}`, { settings });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/offices", user?.officeId] });
      onPhoneSaved();
      setOpen(false);
    },
  });

  if (lab?.phone) {
    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild><Button size="xs" data-testid={`call-lab-${testId}`}>Call</Button></PopoverTrigger>
        <PopoverContent className="w-auto">
          <a className="font-medium" href={`tel:${lab.phone}`} onClick={() => onCalled?.()}>{lab.label}: {lab.phone}</a>
        </PopoverContent>
      </Popover>
    );
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild><Button size="xs" variant="outline" data-testid={`call-lab-${testId}`}>Call</Button></PopoverTrigger>
      <PopoverContent className="space-y-2">
        <p className="text-sm">No phone saved for {lab?.label ?? "this lab"}.</p>
        {canEdit ? (
          <>
            <input className="w-full text-sm px-2 py-1 rounded border border-line-2" placeholder="(555) 123-4567"
              value={phone} onChange={(e) => setPhone(e.target.value)} data-testid={`lab-phone-input-${testId}`} />
            <Button size="xs" disabled={!phone.trim() || save.isPending} onClick={() => save.mutate(phone)}>Save to lab</Button>
          </>
        ) : <p className="text-xs text-ink-mute">Ask an owner/manager to add it in Settings → Labs.</p>}
      </PopoverContent>
    </Popover>
  );
}
