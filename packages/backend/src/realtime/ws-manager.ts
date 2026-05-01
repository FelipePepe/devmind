import type WebSocket from 'ws';
import type { PushService } from './web-push.js';
import { logger } from '../logger.js';

export interface WsTicket {
  userId: string;
  expiresAt: number;
}

export class WsManager {
  private connections = new Map<string, Set<WebSocket>>();
  private wsTickets = new Map<string, WsTicket>();
  private pushService: PushService | null = null;

  setPushService(push: PushService): void {
    this.pushService = push;
  }

  register(userId: string, ws: WebSocket): void {
    let set = this.connections.get(userId);
    if (!set) {
      set = new Set();
      this.connections.set(userId, set);
    }
    set.add(ws);
  }

  unregister(userId: string, ws: WebSocket): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(ws);
    if (set.size === 0) this.connections.delete(userId);
  }

  broadcast(userId: string, event: unknown): void {
    const set = this.connections.get(userId);
    const payload = JSON.stringify(event);
    if (set && set.size > 0) {
      for (const ws of set) {
        try {
          ws.send(payload);
        } catch (err) {
          logger.warn({ err }, 'WS send error');
        }
      }
    } else if (this.pushService) {
      this.pushService.sendPush(userId, event).catch((err) => {
        logger.warn({ err }, 'Web Push fallback error');
      });
    }
  }

  addTicket(ticket: string, userId: string): void {
    this.wsTickets.set(ticket, { userId, expiresAt: Date.now() + 30_000 });
  }

  consumeTicket(ticket: string): string | null {
    const entry = this.wsTickets.get(ticket);
    if (!entry) return null;
    this.wsTickets.delete(ticket);
    if (entry.expiresAt < Date.now()) return null;
    return entry.userId;
  }

  closeAll(): void {
    for (const [userId, set] of this.connections) {
      for (const ws of set) {
        try {
          ws.close();
        } catch {
          // ignore
        }
      }
      logger.info({ userId }, 'Closed WS connections on shutdown');
    }
    this.connections.clear();
  }
}