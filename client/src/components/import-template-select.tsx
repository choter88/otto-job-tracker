import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Pencil, Trash2, FileSpreadsheet } from "lucide-react";
import type { ImportTemplate } from "@shared/import-types";

interface ImportTemplateSelectProps {
  builtIn: ImportTemplate[];
  user: ImportTemplate[];
  onSelect: (template: ImportTemplate | null) => void; // null = start from scratch
}

export default function ImportTemplateSelect({
  builtIn,
  user: userTemplates,
  onSelect,
}: ImportTemplateSelectProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/import/templates/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/templates"] });
      toast({ title: "Template deleted" });
      setDeleteId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to delete template", description: err.message, variant: "destructive" });
    },
  });

  const renameMutation = useMutation({
    mutationFn: async ({ id, name }: { id: string; name: string }) => {
      await apiRequest("PUT", `/api/import/templates/${id}`, { name });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/import/templates"] });
      toast({ title: "Template renamed" });
      setRenamingId(null);
    },
    onError: (err: Error) => {
      toast({ title: "Failed to rename template", description: err.message, variant: "destructive" });
    },
  });

  // Group built-in templates by ehrSystem
  const builtInGroups = builtIn.reduce<Record<string, ImportTemplate[]>>((acc, t) => {
    const group = t.ehrSystem || "Other";
    if (!acc[group]) acc[group] = [];
    acc[group].push(t);
    return acc;
  }, {});

  const hasTemplates = builtIn.length > 0 || userTemplates.length > 0;

  return (
    <div className="space-y-6">
      {/* Built-in templates */}
      {builtIn.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Built-in Templates</h3>
          <div className="space-y-2">
            {Object.entries(builtInGroups).map(([ehrSystem, templates]) => (
              <div key={ehrSystem}>
                <p className="text-xs text-muted-foreground mb-1">{ehrSystem}</p>
                {templates.map((t) => (
                  <button
                    key={t.id}
                    className="w-full text-left px-4 py-3 rounded-lg border hover:bg-accent transition-colors"
                    onClick={() => onSelect(t)}
                  >
                    <span className="font-medium">{t.name}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* User templates */}
      {userTemplates.length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-muted-foreground mb-3">Your Saved Templates</h3>
          <div className="space-y-2">
            {userTemplates.map((t) => (
              <div
                key={t.id}
                className="flex items-center gap-2 px-4 py-3 rounded-lg border hover:bg-accent transition-colors group"
              >
                {renamingId === t.id ? (
                  <form
                    className="flex items-center gap-2 flex-1"
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (renameValue.trim()) {
                        renameMutation.mutate({ id: t.id, name: renameValue.trim() });
                      }
                    }}
                  >
                    <Input
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      className="h-8"
                      autoFocus
                    />
                    <Button type="submit" size="sm" variant="outline" disabled={renameMutation.isPending}>
                      Save
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => setRenamingId(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                ) : (
                  <>
                    <button className="flex-1 text-left" onClick={() => onSelect(t)}>
                      <span className="font-medium">{t.name}</span>
                      {t.derivedFrom && (
                        <span className="text-xs text-muted-foreground ml-2">(customized)</span>
                      )}
                    </button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(t.id);
                        setRenameValue(t.name);
                      }}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 opacity-0 group-hover:opacity-100 text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDeleteId(t.id);
                      }}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Start from scratch */}
      <div>
        {hasTemplates && (
          <div className="relative my-4">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-background px-2 text-muted-foreground">or</span>
            </div>
          </div>
        )}
        <button
          className="w-full text-left px-4 py-3 rounded-lg border-2 border-dashed hover:bg-accent transition-colors flex items-center gap-3"
          onClick={() => onSelect(null)}
        >
          <FileSpreadsheet className="h-5 w-5 text-muted-foreground" />
          <div>
            <p className="font-medium">Start from Scratch</p>
            <p className="text-sm text-muted-foreground">Map CSV columns manually without a template</p>
          </div>
        </button>
      </div>

      {/* Delete confirmation dialog */}
      <AlertDialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Template</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this template? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteId && deleteMutation.mutate(deleteId)}
              disabled={deleteMutation.isPending}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
