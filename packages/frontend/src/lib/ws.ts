import { apiFetch } from './api.js';

type EventHandler = (data: unknown) => void;

const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 30_000;

export class WsClient {
  private ws: WebSocket | null = null;
  private handlers = new Map<string, Set<EventHandler>>();
  private backoff = INITIAL_BACKOFF;
  private intentionallyClosed = false;

  on(event: string, handler: EventHandler): void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    set.add(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  async connect(): Promise<void> {
    this.intentionallyClosed = false;
    await this.openConnection();
  }

  close(): void {
    this.intentionallyClosed = true;
    this.ws?.close();
    this.ws = null;
  }

  private async openConnection(): Promise<void> {
    try {
      const { ticket } = await apiFetch<{ ticket: string }>('/auth/ws-ticket', {
        method: 'POST',
      });

      const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`;
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.backoff = INITIAL_BACKOFF;
        this.emit('connected', null);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as { type: string };
          this.emit(parsed.type, parsed);
          this.emit('message', parsed);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        this.ws = null;
        this.emit('disconnected', null);
        if (!this.intentionallyClosed) {
          setTimeout(() => {
            void this.openConnection();
            this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
          }, this.backoff);
        }
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      if (!this.intentionallyClosed) {
        setTimeout(() => void this.openConnection(), this.backoff);
        this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
      }
    }
  }

  private emit(event: string, data: unknown): void {
    const handlers = this.handlers.get(event);
    if (!handlers) return;
    for (const h of handlers) h(data);
  }
}

export const wsClient = new WsClient();
