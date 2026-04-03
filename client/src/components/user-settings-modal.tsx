import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

interface UserPreferences {
  fontSize?: "xs" | "sm" | "default" | "lg" | "xl";
  darkMode?: boolean;
}

const FONT_SIZE_OPTIONS = [
  { id: "xs", label: "XS", px: 12 },
  { id: "sm", label: "S", px: 13 },
  { id: "default", label: "M", px: 14 },
  { id: "lg", label: "L", px: 16 },
  { id: "xl", label: "XL", px: 18 },
] as const;

const FONT_SIZE_MAP: Record<string, number> = Object.fromEntries(
  FONT_SIZE_OPTIONS.map((o) => [o.id, o.px]),
);

const SLIDER_TO_SIZE = FONT_SIZE_OPTIONS.map((o) => o.id);
const DEFAULT_INDEX = 2; // "default" (M) is the middle

function applyFontSize(size: string) {
  const px = FONT_SIZE_MAP[size] ?? 14;
  document.documentElement.style.fontSize = `${px}px`;
}

function applyDarkMode(enabled: boolean) {
  if (enabled) {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
}

interface UserSettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function UserSettingsModal({ open, onOpenChange }: UserSettingsModalProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: prefs } = useQuery<UserPreferences>({
    queryKey: ["/api/user/preferences"],
    queryFn: async () => {
      const res = await fetch("/api/user/preferences", { credentials: "include" });
      if (!res.ok) return {};
      return res.json();
    },
    enabled: open,
  });

  const [fontSize, setFontSize] = useState<string>("default");
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    if (prefs) {
      setFontSize(prefs.fontSize || "default");
      setDarkMode(prefs.darkMode ?? false);
    }
  }, [prefs]);

  const sliderIndex = SLIDER_TO_SIZE.indexOf(fontSize as any);
  const currentIndex = sliderIndex >= 0 ? sliderIndex : DEFAULT_INDEX;
  const currentOption = FONT_SIZE_OPTIONS[currentIndex];

  const saveMutation = useMutation({
    mutationFn: async (updates: UserPreferences) => {
      const res = await apiRequest("PUT", "/api/user/preferences", updates);
      return res.json();
    },
    onSuccess: (saved: UserPreferences) => {
      applyFontSize(saved.fontSize || "default");
      applyDarkMode(saved.darkMode ?? false);
      queryClient.invalidateQueries({ queryKey: ["/api/user/preferences"] });
      toast({ title: "Settings saved" });
      onOpenChange(false);
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>User Settings</DialogTitle>
        </DialogHeader>

        <div className="space-y-6 py-2">
          {/* Font Size */}
          <div className="space-y-3">
            <Label className="text-sm font-medium">Font Size</Label>
            <div className="px-1">
              <Slider
                min={0}
                max={FONT_SIZE_OPTIONS.length - 1}
                step={1}
                value={[currentIndex]}
                onValueChange={([val]) => setFontSize(SLIDER_TO_SIZE[val])}
                className="flex-1"
              />
              <div className="flex justify-between mt-1.5">
                {FONT_SIZE_OPTIONS.map((opt, i) => (
                  <button
                    key={opt.id}
                    type="button"
                    className={`text-[10px] w-8 text-center rounded py-0.5 ${
                      i === currentIndex
                        ? "font-semibold text-primary"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                    onClick={() => setFontSize(opt.id)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-md border border-border bg-muted/30 p-3">
              <p style={{ fontSize: `${currentOption.px}px` }}>
                Preview text at {currentOption.px}px
              </p>
            </div>
          </div>

          {/* Dark Mode */}
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Dark Mode</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Switch to dark theme</p>
            </div>
            <Switch checked={darkMode} onCheckedChange={setDarkMode} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => saveMutation.mutate({ fontSize: fontSize as any, darkMode })} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Apply user preferences from the user object on login/load.
 * Call this from the app root after authentication.
 */
export function applyUserPreferences(preferences: unknown) {
  if (!preferences || typeof preferences !== "object") return;
  const prefs = preferences as UserPreferences;
  applyFontSize(prefs.fontSize || "default");
  applyDarkMode(prefs.darkMode ?? false);
}
