/**
 * Re-activation dialog — portal auth + office selection + license activation.
 * Preserves all existing local data (zero data loss).
 */
import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Building2, CheckCircle2, KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";

type Step = "login" | "select-office" | "activating" | "success" | "error";

interface PortalOffice {
  officeId: string;
  officeName: string;
  role: string;
  subscriptionStatus: string;
}

interface ReactivateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ReactivateDialog({ open, onOpenChange }: ReactivateDialogProps) {
  const [step, setStep] = useState<Step>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [portalToken, setPortalToken] = useState("");
  const [tokenExpiresAt, setTokenExpiresAt] = useState(0); // H-3: track token expiry
  const [offices, setOffices] = useState<PortalOffice[]>([]);
  const [selectedOffice, setSelectedOffice] = useState<PortalOffice | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [hostConflict, setHostConflict] = useState(false);
  const [currentPortalOfficeId, setCurrentPortalOfficeId] = useState<string | null>(null);

  // M-5: Fetch current portal officeId to detect office change
  useEffect(() => {
    if (!open) return;
    fetch("/api/license/status", { credentials: "include" })
      .then((r) => r.json())
      .then((d) => { if (d?.officeId) setCurrentPortalOfficeId(d.officeId); })
      .catch(() => {});
  }, [open]);

  const isDifferentOffice = selectedOffice && currentPortalOfficeId && selectedOffice.officeId !== currentPortalOfficeId;

  const reset = () => {
    setStep("login");
    setEmail("");
    setPassword(""); // H-4: always cleared on reset
    setPortalToken("");
    setTokenExpiresAt(0);
    setOffices([]);
    setSelectedOffice(null);
    setLoading(false);
    setError("");
    setHostConflict(false);
  };

  const handleClose = () => {
    onOpenChange(false);
    // Delay reset so the closing animation finishes
    setTimeout(reset, 200);
  };

  // Step 1: Portal login
  const handleLogin = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/setup/portal-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Authentication failed. Check your email and password.");
        return;
      }
      setPortalToken(data.token);
      setTokenExpiresAt(data.expiresAt || Date.now() + 600_000); // H-3: store expiry (default 10min)
      setPassword(""); // H-4: clear password immediately after successful login
      setOffices(data.offices || []);
      setStep("select-office");
    } catch {
      setError("Unable to reach the server. Check your internet connection.");
    } finally {
      setLoading(false);
    }
  };

  // Step 3: Activate
  const handleActivate = async (forceReplace = false) => {
    if (!selectedOffice) return;

    // H-3: Check token expiry before calling server
    if (tokenExpiresAt && Date.now() > tokenExpiresAt) {
      setError("Session expired. Please sign in again.");
      setStep("login");
      setPortalToken("");
      return;
    }

    setLoading(true);
    setError("");
    setHostConflict(false);
    setStep("activating");
    try {
      const res = await fetch("/api/setup/reactivate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          portalToken,
          officeId: selectedOffice.officeId,
          forceReplace,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.code === "HOST_ALREADY_ACTIVATED" && !forceReplace) {
          setHostConflict(true);
          setStep("select-office");
          setError("This office already has an active Host. You can replace it to continue.");
          return;
        }
        if (data.code === "ALREADY_ACTIVE") {
          setError("License is already active. No re-activation needed.");
          setStep("error");
          return;
        }
        setError(data.error || "Activation failed. Please try again.");
        setStep("error");
        return;
      }
      setStep("success");
    } catch {
      setError("Request failed. Please try again.");
      setStep("error");
    } finally {
      setLoading(false);
    }
  };

  const handleSuccess = () => {
    window.location.reload();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-indigo-500" />
            Re-activate License
          </DialogTitle>
          <DialogDescription>
            Sign in to the Otto portal and select an office to restore full access. Your data is safe and will not be modified.
          </DialogDescription>
        </DialogHeader>

        {/* Step 1: Portal Login */}
        {step === "login" && (
          <form
            onSubmit={(e) => { e.preventDefault(); handleLogin(); }}
            className="space-y-4 py-2"
          >
            <div>
              <Label htmlFor="reactivate-email">Portal Email</Label>
              <Input
                id="reactivate-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                autoFocus
                required
              />
            </div>
            <div>
              <Label htmlFor="reactivate-password">Portal Password</Label>
              <Input
                id="reactivate-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={handleClose}>Cancel</Button>
              <Button type="submit" disabled={loading || !email.trim() || !password}>
                {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <LogIn className="h-4 w-4 mr-2" />}
                Sign In
              </Button>
            </DialogFooter>
          </form>
        )}

        {/* Step 2: Select Office */}
        {step === "select-office" && (
          <div className="space-y-3 py-2">
            {offices.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                No offices found for this account. Create one in the Otto portal first.
              </div>
            ) : (
              <>
                <p className="text-sm text-muted-foreground">Select the office to activate this Host against:</p>
                <div className="space-y-2 max-h-[240px] overflow-y-auto" role="radiogroup" aria-label="Office selection">
                  {offices.map((office) => (
                    <button
                      key={office.officeId}
                      type="button"
                      role="radio"
                      aria-checked={selectedOffice?.officeId === office.officeId}
                      onClick={() => { setSelectedOffice(office); setError(""); setHostConflict(false); }}
                      className={`w-full text-left rounded-lg border p-3 transition-colors ${
                        selectedOffice?.officeId === office.officeId
                          ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30"
                          : "border-border hover:bg-muted/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 text-muted-foreground" />
                          <span className="font-medium text-sm">{office.officeName}</span>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">
                          {office.subscriptionStatus || "trialing"}
                        </Badge>
                      </div>
                      <div className="text-xs text-muted-foreground mt-1 ml-6 capitalize">{office.role}</div>
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* M-5: Warn when activating against a different office */}
            {isDifferentOffice && !hostConflict && (
              <div className="rounded-md border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 p-3 text-xs text-amber-800 dark:text-amber-200 flex items-start gap-2">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                <span>
                  This is a different office than originally configured. All existing local data will be associated with the new office on the portal.
                </span>
              </div>
            )}

            {error && (
              <p className="text-sm text-destructive flex items-center gap-1.5" role="alert">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                {error}
              </p>
            )}

            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => { setStep("login"); setError(""); }}>Back</Button>
              {hostConflict && selectedOffice ? (
                <Button
                  variant="destructive"
                  onClick={() => handleActivate(true)}
                  disabled={loading}
                >
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Replace Existing Host
                </Button>
              ) : (
                <Button
                  onClick={() => handleActivate(false)}
                  disabled={!selectedOffice || loading}
                >
                  {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Activate
                </Button>
              )}
            </DialogFooter>
          </div>
        )}

        {/* Step 3: Activating */}
        {step === "activating" && (
          <div className="flex flex-col items-center py-8 gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
            <p className="text-sm text-muted-foreground">Activating with portal...</p>
          </div>
        )}

        {/* Success */}
        {step === "success" && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 rounded-full bg-green-100 dark:bg-green-900/30 flex items-center justify-center">
                <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
              </div>
              <p className="font-semibold">License Re-activated</p>
              <p className="text-sm text-muted-foreground text-center">
                Full access has been restored. All your data is intact.
              </p>
            </div>
            <DialogFooter>
              <Button onClick={handleSuccess} className="w-full">
                <ShieldCheck className="h-4 w-4 mr-2" />
                Reload App
              </Button>
            </DialogFooter>
          </div>
        )}

        {/* Error */}
        {step === "error" && (
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center py-4 gap-3">
              <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-red-600 dark:text-red-400" />
              </div>
              <p className="font-semibold">Activation Failed</p>
              <p className="text-sm text-muted-foreground text-center" role="alert">{error}</p>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => { setStep("login"); setError(""); }}>
                Try Again
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
