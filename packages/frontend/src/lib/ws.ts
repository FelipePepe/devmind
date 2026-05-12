import { apiFetch } from './api.js';

type EventHandler = (data: unknown) => void;

const INITIAL_BACKOFF = 1000;
const MAX_BACKOFF = 30_000;

function wsLog(level: 'info' | 'warn' | 'error', message: string): void {
  const prefix = `[${level.toUpperCase()}][ws]`;
  if (level === 'error') console.error(`${prefix} ${message}`);
  else if (level === 'warn') console.warn(`${prefix} ${message}`);
  else console.log(`${prefix} ${message}`);
}

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
    wsLog('info', 'Starting connection...');
    await this.openConnection();
  }

  close(): void {
    this.intentionallyClosed = true;
    wsLog('info', 'Closing (intentional)');
    this.ws?.close();
    this.ws = null;
  }

  private async openConnection(): Promise<void> {
    try {
      const { ticket } = await apiFetch<{ ticket: string }>('/auth/ws-ticket', {
        method: 'POST',
      });

      const wsUrl = `${window.location.origin.replace(/^http/, 'ws')}/ws?ticket=${encodeURIComponent(ticket)}`;
      wsLog('info', `Connecting to ${wsUrl.replace(/ticket=[^&]+/, 'ticket=***')}`);
      const ws = new WebSocket(wsUrl);
      this.ws = ws;

      ws.onopen = () => {
        this.backoff = INITIAL_BACKOFF;
        wsLog('info', 'Connected');
        this.emit('connected', null);
      };

      ws.onmessage = (event) => {
        try {
          const parsed = JSON.parse(event.data as string) as { type: string };
          wsLog('info', `← ${parsed.type}`);
          this.emit(parsed.type, parsed);
          this.emit('message', parsed);
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = (e) => {
        this.ws = null;
        wsLog('warn', `Disconnected (code: ${e.code})`);
        this.emit('disconnected', null);
        if (!this.intentionallyClosed) {
          wsLog('info', `Reconnecting in ${this.backoff}ms...`);
          setTimeout(() => {
            void this.openConnection();
            this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF);
          }, this.backoff);
        }
      };

      ws.onerror = () => {
        wsLog('error', 'Connection error');
        ws.close();
      };
    } catch {
      wsLog('error', 'Failed to get WS ticket, retrying...');
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
