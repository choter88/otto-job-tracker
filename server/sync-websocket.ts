import { WebSocket, WebSocketServer } from "ws";
import type { Server as HTTPServer } from "http";
import type { RequestHandler } from "express";
import type { SessionData } from "express-session";
import { storage } from "./storage";
import { db } from "./db";
import { clientDevices } from "@shared/schema";
import { eq } from "drizzle-orm";

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
            const existing = db.select().from(clientDevices).where(eq(clientDevices.id, msg.deviceId)).get();
            if (existing) {
              if (existing.blocked) {
                ws.send(JSON.stringify({ type: "device_blocked" }));
                return;
              }
              db.update(clientDevices).set({ lastSeenAt: new Date(), label: msg.label || existing.label }).where(eq(clientDevices.id, msg.deviceId)).run();
            } else {
              db.insert(clientDevices).values({ id: msg.deviceId, officeId, label: msg.label || null }).run();
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
