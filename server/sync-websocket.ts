import { WebSocket, WebSocketServer } from "ws";
import type { Server as HTTPServer } from "http";
import type { RequestHandler } from "express";
import type { SessionData } from "express-session";
import { storage } from "./storage";

type OttoWs = WebSocket & { ottoOfficeId?: string; ottoUserId?: string };

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
