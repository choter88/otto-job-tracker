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
import { getOrCreateDeviceId } from "@/components/sync-manager";

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
  orderSheetsReadBytes: (payload: { path: string }) => Promise<{ bytes?: Uint8Array; error?: string }>;
  orderSheetsAck: (payload: { hash: string }) => Promise<{ ok: boolean }>;
  onOrderSheetsEvent: (callback: (payload: any) => void) => () => void;
}

export function getOrderSheetsBridge(): OrderSheetsBridge | null {
  const bridge = (window as any)?.otto;
  if (!bridge?.orderSheetsGet || !bridge?.onOrderSheetsEvent) return null;
  return bridge as OrderSheetsBridge;
}

const RETRY_DELAY_MS = 30_000;

// Watcher-presence heartbeat cadence. The panel treats anything quiet for
// ~3 intervals as "not reporting", so keep these two numbers in step.
export const HEARTBEAT_INTERVAL_MS = 60_000;
export const WATCHER_STALE_AFTER_MS = 3 * HEARTBEAT_INTERVAL_MS;

// Page 1 is what staff glance at to verify what the parser saw — frame
// model, special instructions, signature. Capping width keeps the JPEG
// small (~150-400 KB typical at this size and quality) while staying
// well above DPI for any normal-sized order sheet.
const ATTACHMENT_MAX_WIDTH = 1400;
const ATTACHMENT_JPEG_QUALITY = 0.72;

interface RenderedAttachment {
  jpegBase64: string;
  pageCount: number;
}

/**
 * Render page 1 of a PDF buffer to a JPEG data URL via pdf.js + a
 * detached canvas. Returns null (rather than throwing) for any reason
 * — a bad file, the bundled pdf.js failing to read it, the encoder
 * coming up empty — because the attachment is OPTIONAL on the way in.
 * Ingestion still runs without it.
 */
async function renderOrderSheetAttachment(bytes: Uint8Array): Promise<RenderedAttachment | null> {
  try {
    const { getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(bytes);
    if (!doc.numPages) return null;
    const page = await doc.getPage(1);
    const unscaledViewport = page.getViewport({ scale: 1 });
    const scale = Math.min(ATTACHMENT_MAX_WIDTH / unscaledViewport.width, 2);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    // Light text on transparent canvas reads poorly when JPEG-encoded;
    // explicit white background matches what staff see when they open
    // the original.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // pdf.js's render() expects either `canvas` or `canvasContext` +
    // `viewport`; the latter is the long-standing API used in browsers.
    await (page as any).render({ canvasContext: ctx, viewport }).promise;

    const dataUrl = canvas.toDataURL("image/jpeg", ATTACHMENT_JPEG_QUALITY);
    if (!dataUrl.startsWith("data:image/jpeg;base64,")) return null;
    return {
      jpegBase64: dataUrl.slice("data:image/jpeg;base64,".length),
      pageCount: doc.numPages,
    };
  } catch {
    return null;
  }
}

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

            // Render a small JPEG of page 1 so staff can see the sheet
            // from any computer. Only for PDFs with readable text — the
            // text gate avoids rendering broken/encrypted files (extract
            // already returned an extractError for those).
            let attachment: RenderedAttachment | null = null;
            const looksLikePdf = file.fileName.toLowerCase().endsWith(".pdf");
            if (looksLikePdf && extracted.text && !extracted.extractError) {
              const read = await bridge.orderSheetsReadBytes({ path: file.path });
              if (read?.bytes) {
                attachment = await renderOrderSheetAttachment(read.bytes);
              }
            }

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
              attachmentJpegBase64: attachment?.jpegBase64,
              attachmentPageCount: attachment?.pageCount,
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

  // ── Watcher presence heartbeat ───────────────────────────────────────
  // Report this machine's watcher status to the office so the "Watching
  // from" panel on the Order Sheets page is accurate from any computer.
  // Same guard as ingestion: a view-only session can't import, so it
  // shouldn't claim to be watching either.
  useEffect(() => {
    const bridge = getOrderSheetsBridge();
    if (!bridge || !user?.officeId || user.role === "view_only") return;

    let disposed = false;

    const sendHeartbeat = async () => {
      if (disposed) return;
      try {
        const snapshot = await bridge.orderSheetsGet();
        await apiRequest("POST", "/api/order-sheets/watcher-heartbeat", {
          deviceId: getOrCreateDeviceId(),
          folderPath: snapshot.config?.folder || undefined,
          enabled: !!snapshot.config?.enabled,
          state: snapshot.status?.state || "stopped",
          error: snapshot.status?.error || undefined,
        });
      } catch {
        // Host offline or signed out — the next beat will catch up. A
        // missed heartbeat is exactly what the panel's staleness shows.
      }
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    // Status changes (folder picked, toggled off, folder vanished) beat
    // immediately instead of waiting out the interval.
    const unsubscribe = bridge.onOrderSheetsEvent((payload) => {
      if (payload?.kind === "status") void sendHeartbeat();
    });

    return () => {
      disposed = true;
      window.clearInterval(interval);
      unsubscribe();
    };
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
