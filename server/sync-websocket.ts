import { WebSocket, WebSocketServer } from "ws";
import type { Server as HTTPServer } from "http";
import type { RequestHandler } from "express";
import type { SessionData } from "express-session";
import { storage } from "./storage";
import { db } from "./db";
import { clientDevices } from "@shared/schema";
import { eq } from "drizzle-orm";
import { getHostToken } from "./license";
import { portalIssueClientRecovery } from "./license-client";
import { deriveDeviceAutoLabel } from "./device-label";

type OttoWs = WebSocket & { ottoOfficeId?: string; ottoUserId?: string; ottoIsLocal?: boolean; ottoDeviceId?: string };

const officeConnections = new Map<string, Set<OttoWs>>();

export function setupSyncWebSocket(httpServer: HTTPServer, sessionMiddleware: RequestHandler) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on("upgrade", (request, socket, head) => {
    // Only handle WebSocket upgrades for sync events.
    // Let Vite handle its HMR WebSocket separately.
    if (!request.url?.startsWith("/sync-ws")) {
      return;
    }

    sessionMiddleware(request as any, {} as any, () => {
      const session = (request as any).session as SessionData & { passport?: { user?: string } };
      const userId = session?.passport?.user;

      if (!userId) {
        socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
        socket.destroy();
        return;
      }

      void storage
        .getUser(userId)
        .then((user) => {
          const officeId = user?.officeId || null;
          if (!officeId) {
            socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");
            socket.destroy();
            return;
          }

          wss.handleUpgrade(request, socket, head, (ws) => {
            (ws as OttoWs).ottoOfficeId = officeId;
            (ws as OttoWs).ottoUserId = userId;
            const remoteAddr = request.socket?.remoteAddress || "";
            (ws as OttoWs).ottoIsLocal = remoteAddr === "127.0.0.1" || remoteAddr === "::1" || remoteAddr === "::ffff:127.0.0.1";
            wss.emit("connection", ws, request);
          });
        })
        .catch(() => {
          socket.write("HTTP/1.1 500 Internal Server Error\r\n\r\n");
          socket.destroy();
        });
    });
  });

  wss.on("connection", (ws: OttoWs) => {
    const officeId = ws.ottoOfficeId;
    if (!officeId) {
      ws.close();
      return;
    }

    if (!officeConnections.has(officeId)) {
      officeConnections.set(officeId, new Set());
    }
    officeConnections.get(officeId)!.add(ws);

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(String(raw));
        if (msg?.type === "device_register" && typeof msg.deviceId === "string" && !ws.ottoIsLocal) {
          ws.ottoDeviceId = msg.deviceId;
          try {
            // Parse the UA into a friendly auto-label. The Client
            // sends its raw UA in `msg.label` (legacy field name);
            // we run it through the parser server-side so the rule
            // is in one place and stays consistent across clients
            // that report slightly different UA shapes.
            const autoLabel = deriveDeviceAutoLabel(typeof msg.label === "string" ? msg.label : null);
            const existing = db.select().from(clientDevices).where(eq(clientDevices.id, msg.deviceId)).get();
            let needsRecoveryIssuance = false;
            let isNewDevice = false;
            if (existing) {
              if (existing.blocked) {
                ws.send(JSON.stringify({ type: "device_blocked" }));
                return;
              }
              // Refresh autoLabel each time so a browser update on
              // the Client (e.g. Chrome major bump) reflects right
              // away. The user-set `name` is left alone.
              db.update(clientDevices)
                .set({ lastSeenAt: new Date(), autoLabel })
                .where(eq(clientDevices.id, msg.deviceId))
                .run();
              if (!existing.recoveryId) needsRecoveryIssuance = true;
            } else {
              db.insert(clientDevices).values({ id: msg.deviceId, officeId, autoLabel }).run();
              needsRecoveryIssuance = true;
              isNewDevice = true;
            }

            // Broadcast presence so the Host's Computers tab
            // refreshes the moment a Client comes online — without
            // this, the panel would only update on user action.
            try {
              const set = officeConnections.get(officeId);
              if (set) {
                for (const other of Array.from(set)) {
                  if (other === ws) continue;
                  if (other.readyState !== WebSocket.OPEN) continue;
                  try {
                    other.send(JSON.stringify({
                      type: "office_updated",
                      ts: Date.now(),
                      source: isNewDevice ? "device_paired" : "device_connected",
                    }));
                  } catch { /* socket may be closing */ }
                }
              }
            } catch { /* non-critical */ }

            if (needsRecoveryIssuance) {
              // Issue a recovery token via the portal, then forward
              // the plaintext to this Client over the same WS so it
              // can persist it to its Electron config. Fire-and-forget:
              // a failure here doesn't block the Client from working,
              // it just means the Client won't auto-recover from a
              // future Host replacement until the next register.
              const hostToken = getHostToken();
              if (hostToken) {
                const labelForToken = (msg.label && typeof msg.label === "string")
                  ? String(msg.label).slice(0, 120)
                  : `Client ${String(msg.deviceId).slice(0, 8)}`;
                portalIssueClientRecovery({ hostToken, label: labelForToken })
                  .then((result) => {
                    if (!result.ok) return;
                    try {
                      db.update(clientDevices)
                        .set({ recoveryId: result.recoveryId })
                        .where(eq(clientDevices.id, msg.deviceId))
                        .run();
                    } catch { /* non-critical */ }
                    try {
                      ws.send(JSON.stringify({
                        type: "recovery_token_issued",
                        recoveryToken: result.recoveryToken,
                        recoveryId: result.recoveryId,
                      }));
                    } catch { /* socket may be closed */ }
                  })
                  .catch(() => { /* non-critical */ });
              }
            }
          } catch { /* non-critical */ }
        } else if (msg?.type === "device_disconnect" && typeof msg.deviceId === "string") {
          try {
            db.update(clientDevices).set({ blocked: true }).where(eq(clientDevices.id, msg.deviceId)).run();
            ws.send(JSON.stringify({ type: "device_blocked" }));
          } catch { /* non-critical */ }
        }
      } catch { /* ignore parse errors */ }
    });

    ws.on("close", () => {
      const set = officeConnections.get(officeId);
      if (!set) return;
      set.delete(ws);
      if (set.size === 0) officeConnections.delete(officeId);
      // Tell the rest of this office's connected sockets that the
      // connected-device count just changed, so any Computers panel
      // open on the Host can flip the disconnecting row's pill from
      // "Connected" to "Last seen now". Only emit if it was an
      // actual remote Client closing — local Host renderer
      // disconnects shouldn't ripple.
      if (!ws.ottoIsLocal && ws.ottoDeviceId) {
        for (const other of Array.from(set)) {
          if (other.readyState !== WebSocket.OPEN) continue;
          try {
            other.send(JSON.stringify({
              type: "office_updated",
              ts: Date.now(),
              source: "device_disconnected",
            }));
          } catch { /* socket may be closing */ }
        }
      }
    });

    ws.on("error", () => {
      // Ignore; close handler cleans up.
    });

    try {
      ws.send(JSON.stringify({ type: "connected", ts: Date.now() }));
    } catch {
      // ignore
    }
  });

  return wss;
}

/** Count non-blocked registered client devices. */
export function getRegisteredDeviceCount(): number {
  try {
    return db.select({ id: clientDevices.id }).from(clientDevices).where(eq(clientDevices.blocked, false)).all().length;
  } catch {
    return 0;
  }
}

/**
 * Snapshot of which remote Clients are currently connected to a
 * given office, keyed by their deviceId. Each entry carries the
 * userId of the staff member logged in on that Client right now —
 * the Computers tab uses this to show "Connected · Jane Doe" so an
 * admin can identify which physical machine is which.
 *
 * Local Host connections (renderer talking to its own server) are
 * excluded since the Host doesn't sit on a Client seat and showing
 * it as a connected Client would be confusing.
 */
export function getOfficeClientPresence(officeId: string): Map<string, { userId: string | null; connectedAt: number }> {
  const out = new Map<string, { userId: string | null; connectedAt: number }>();
  const set = officeConnections.get(officeId);
  if (!set) return out;
  for (const ws of Array.from(set)) {
    if (ws.ottoIsLocal) continue;
    if (!ws.ottoDeviceId) continue;
    if (ws.readyState !== WebSocket.OPEN) continue;
    out.set(ws.ottoDeviceId, {
      userId: ws.ottoUserId ?? null,
      connectedAt: Date.now(),
    });
  }
  return out;
}

/** Count remote (non-localhost) WebSocket connections — i.e. actual Client machines. */
export function getConnectedClientCount(): number {
  let count = 0;
  for (const set of officeConnections.values()) {
    for (const ws of set) {
      if (!ws.ottoIsLocal) count++;
    }
  }
  return count;
}

export function broadcastToOffice(officeId: string, data: any): void {
  const set = officeConnections.get(officeId);
  if (!set || set.size === 0) return;

  const message = JSON.stringify(data);
  set.forEach((ws) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(message);
    } catch {
      // ignore
    }
  });
}
