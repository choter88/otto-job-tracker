import { WebSocket, WebSocketServer } from 'ws';
import type { Server as HTTPServer } from 'http';
import type { RequestHandler } from 'express';
import type { SessionData } from 'express-session';

const userConnections = new Map<string, Set<WebSocket>>();

export function setupWebSocket(httpServer: HTTPServer, sessionMiddleware: RequestHandler) {
  const wss = new WebSocketServer({ noServer: true });

  httpServer.on('upgrade', (request, socket, head) => {
    // Only handle WebSocket upgrades for our notifications path
    // Let Vite handle its HMR WebSocket separately
    if (!request.url?.startsWith('/notifications-ws')) {
      return; // Let other handlers (Vite HMR) process this
    }

    sessionMiddleware(request as any, {} as any, () => {
      const session = (request as any).session as SessionData & { passport?: { user?: string } };
      const userId = session?.passport?.user;

      if (!userId) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, userId);
      });
    });
  });

  wss.on('connection', (ws: WebSocket, request: any, userId: string) => {
    if (!userConnections.has(userId)) {
      userConnections.set(userId, new Set());
    }
    userConnections.get(userId)!.add(ws);

    console.log(`WebSocket connected for user ${userId}. Total connections: ${userConnections.get(userId)!.size}`);

    ws.on('close', () => {
      const connections = userConnections.get(userId);
      if (connections) {
        connections.delete(ws);
        if (connections.size === 0) {
          userConnections.delete(userId);
        }
        console.log(`WebSocket disconnected for user ${userId}. Remaining connections: ${connections.size}`);
      }
    });

    ws.on('error', (error) => {
      console.error(`WebSocket error for user ${userId}:`, error);
    });

    ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connection established' }));
  });

  return wss;
}

export function broadcastToUser(userId: string, data: any): void {
  const connections = userConnections.get(userId);
  
  if (!connections || connections.size === 0) {
    return;
  }

  const message = JSON.stringify(data);
  let successCount = 0;
  let failCount = 0;

  connections.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      try {
        ws.send(message);
        successCount++;
      } catch (error) {
        console.error(`Failed to send WebSocket message to user ${userId}:`, error);
        failCount++;
      }
    } else {
      failCount++;
    }
  });

  if (successCount > 0) {
    console.log(`Broadcast to user ${userId}: ${successCount} sent, ${failCount} failed`);
  }
}
