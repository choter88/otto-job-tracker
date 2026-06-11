// Order-sheet automation — renderer side.
//
// The Electron main process watches the folder and extracts text; these
// hooks own everything that needs the signed-in user's session:
//
//   useOrderSheetIngestion — the app-wide worker. Mounted ONCE (in
//     Dashboard) so files are processed no matter which tab is open.
//     Pulls pending files from the desktop bridge, skips ones the office
//     already ingested (hash pre-check), ships the rest to the Host, and
//     toasts the outcome. When the Host is unreachable the files simply
//     stay pending on disk and we retry on a timer — the folder itself is
//     the durable backlog, deliberately NOT an offline outbox.
//
//   useOrderSheetsDesktop — read/configure state for the Order Sheets
//     page (folder, watcher status, pending list). No processing here so
//     a second mount never races the worker.

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/hooks/use-auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export interface OrderSheetDesktopConfig {
  enabled: boolean;
  folder: string;
  includeExisting: boolean;
  enabledAt: number;
}

export interface OrderSheetWatcherStatus {
  state: "stopped" | "watching" | "error";
  folder: string;
  error: string;
  lastEventAt: number;
  pendingCount: number;
}

export interface OrderSheetPendingFile {
  hash: string;
  path: string;
  fileName: string;
  fileSize: number;
  mtimeMs: number;
}

interface OrderSheetsBridge {
  orderSheetsGet: () => Promise<{
    config: OrderSheetDesktopConfig;
    status: OrderSheetWatcherStatus;
    pending: OrderSheetPendingFile[];
  }>;
  orderSheetsPickFolder: () => Promise<{ ok: boolean; folder?: string }>;
  orderSheetsConfigure: (payload: Partial<OrderSheetDesktopConfig>) => Promise<{
    ok: boolean;
    config: OrderSheetDesktopConfig;
    status: OrderSheetWatcherStatus;
    pending: OrderSheetPendingFile[];
  }>;
  orderSheetsExtract: (payload: { path: string }) => Promise<{ text?: string; extractError?: string }>;
  orderSheetsAck: (payload: { hash: string }) => Promise<{ ok: boolean }>;
  onOrderSheetsEvent: (callback: (payload: any) => void) => () => void;
}

export function getOrderSheetsBridge(): OrderSheetsBridge | null {
  const bridge = (window as any)?.otto;
  if (!bridge?.orderSheetsGet || !bridge?.onOrderSheetsEvent) return null;
  return bridge as OrderSheetsBridge;
}

const RETRY_DELAY_MS = 30_000;

export function useOrderSheetIngestion() {
  const { user } = useAuth();
  const { toast } = useToast();
  const processingRef = useRef(false);
  const retryTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const bridge = getOrderSheetsBridge();
    // No bridge (browser/tablet), no office, or a read-only role — the
    // server would reject ingestion anyway, so don't try.
    if (!bridge || !user?.officeId || user.role === "view_only") return;

    let disposed = false;

    const scheduleRetry = () => {
      if (disposed || retryTimerRef.current) return;
      retryTimerRef.current = window.setTimeout(() => {
        retryTimerRef.current = null;
        void process();
      }, RETRY_DELAY_MS);
    };

    const process = async () => {
      if (disposed || processingRef.current) return;
      processingRef.current = true;

      let created = 0;
      let needsReview = 0;
      let failed = 0;

      try {
        const snapshot = await bridge.orderSheetsGet();
        const pending = snapshot.pending || [];
        if (!pending.length) return;

        // Hash pre-check: anything the office has already ingested gets
        // acked without re-extracting (cheap restarts, multi-machine).
        const checkRes = await apiRequest("POST", "/api/order-sheets/check", {
          hashes: pending.map((file) => file.hash),
        });
        const { known } = (await checkRes.json()) as { known: string[] };
        const knownSet = new Set(known);

        let anyFileFailed = false;
        for (const file of pending) {
          if (disposed) return;

          if (knownSet.has(file.hash)) {
            await bridge.orderSheetsAck({ hash: file.hash });
            continue;
          }

          // Per-file isolation: one unreadable/oversized file must not
          // block the rest of the batch.
          try {
            const extracted = await bridge.orderSheetsExtract({ path: file.path });
            const ingestRes = await apiRequest("POST", "/api/order-sheets/ingest", {
              fileName: file.fileName,
              sourcePath: file.path,
              contentHash: file.hash,
              fileSize: file.fileSize,
              // Server caps text at 2MB; order sheets are tiny, so cutting
              // a pathological extraction short loses nothing the parser
              // needs and avoids a permanent 400-retry loop.
              text: extracted.text ? extracted.text.slice(0, 1_900_000) : extracted.text,
              extractError: extracted.extractError,
            });
            const result = (await ingestRes.json()) as {
              record: { status: string; jobId?: string | null };
              created: boolean;
              alreadyKnown: boolean;
            };

            // Only ack once the server has the file on record — an ack
            // with no ledger row would silently drop the sheet.
            await bridge.orderSheetsAck({ hash: file.hash });

            if (!result.alreadyKnown) {
              if (result.record.status === "imported") {
                created += 1;
              } else if (result.record.status === "needs_review") {
                needsReview += 1;
              } else if (result.record.status === "failed") {
                failed += 1;
              }
            }
          } catch {
            anyFileFailed = true;
          }
        }
        if (anyFileFailed) scheduleRetry();
      } catch {
        // Host unreachable / signed out — files stay pending in the
        // watcher; try again shortly.
        scheduleRetry();
      } finally {
        processingRef.current = false;
      }

      if (created || needsReview || failed) {
        queryClient.invalidateQueries({ queryKey: ["/api/jobs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/order-sheets"] });
      }

      if (created) {
        toast({
          title: created === 1 ? "Order sheet imported" : `${created} order sheets imported`,
          description:
            created === 1 ? "A new job was added to the Worklist." : "New jobs were added to the Worklist.",
        });
      }
      if (needsReview) {
        toast({
          title: needsReview === 1 ? "Order sheet needs review" : `${needsReview} order sheets need review`,
          description: "Some details couldn't be read. Finish them on the Order Sheets page.",
        });
      }
      if (failed) {
        toast({
          title: failed === 1 ? "Couldn't read an order sheet" : `Couldn't read ${failed} order sheets`,
          description: "See the Order Sheets page for details.",
          variant: "destructive",
        });
      }
    };

    void process();
    const unsubscribe = bridge.onOrderSheetsEvent((payload) => {
      if (payload?.kind === "pending") void process();
    });

    return () => {
      disposed = true;
      unsubscribe();
      if (retryTimerRef.current) {
        window.clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }
    };
    // `toast` is a stable dispatch; re-subscribing on user change only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id, user?.officeId, user?.role]);
}

export function useOrderSheetsDesktop() {
  const [available] = useState(() => !!getOrderSheetsBridge());
  const [config, setConfig] = useState<OrderSheetDesktopConfig | null>(null);
  const [status, setStatus] = useState<OrderSheetWatcherStatus | null>(null);
  const [pending, setPending] = useState<OrderSheetPendingFile[]>([]);

  const refresh = useCallback(async () => {
    const bridge = getOrderSheetsBridge();
    if (!bridge) return;
    try {
      const snapshot = await bridge.orderSheetsGet();
      setConfig(snapshot.config);
      setStatus(snapshot.status);
      setPending(snapshot.pending || []);
    } catch {
      // bridge hiccup — leave previous state
    }
  }, []);

  useEffect(() => {
    const bridge = getOrderSheetsBridge();
    if (!bridge) return;

    void refresh();
    const unsubscribe = bridge.onOrderSheetsEvent((payload) => {
      if (payload?.kind === "status" && payload.status) setStatus(payload.status);
      if (payload?.kind === "pending" && Array.isArray(payload.pending)) setPending(payload.pending);
    });
    return unsubscribe;
  }, [refresh]);

  const pickFolder = useCallback(async (): Promise<string | null> => {
    const bridge = getOrderSheetsBridge();
    if (!bridge) return null;
    const result = await bridge.orderSheetsPickFolder();
    return result.ok && result.folder ? result.folder : null;
  }, []);

  const configure = useCallback(
    async (payload: Partial<OrderSheetDesktopConfig>) => {
      const bridge = getOrderSheetsBridge();
      if (!bridge) return;
      const result = await bridge.orderSheetsConfigure(payload);
      if (result?.ok) {
        setConfig(result.config);
        setStatus(result.status);
        setPending(result.pending || []);
      }
    },
    [],
  );

  return { available, config, status, pending, refresh, pickFolder, configure };
}
