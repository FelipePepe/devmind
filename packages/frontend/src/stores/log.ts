import { create } from 'zustand';

export type LogEntryType = 'request' | 'response' | 'tool_call' | 'tool_result' | 'done' | 'error';

export interface LogEntry {
  id: string;
  timestamp: number;
  type: LogEntryType;
  label: string;
  content: string;
}

interface LogState {
  entries: LogEntry[];
  _responseId: string | null;
  isOpen: boolean;
  height: number;
  addEntry: (entry: Omit<LogEntry, 'id' | 'timestamp'>) => string;
  appendToResponse: (chunk: string) => void;
  resetResponse: () => void;
  clearEntries: () => void;
  setOpen: (open: boolean) => void;
  setHeight: (h: number) => void;
}

const PANEL_HEIGHT_KEY = 'devmind-log-height';
const PANEL_OPEN_KEY = 'devmind-log-open';
const MIN_HEIGHT = 80;
const DEFAULT_HEIGHT = 220;

function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

export const useLogStore = create<LogState>((set, get) => ({
  entries: [],
  _responseId: null,
  isOpen: localStorage.getItem(PANEL_OPEN_KEY) === 'true',
  height: Math.max(MIN_HEIGHT, Number(localStorage.getItem(PANEL_HEIGHT_KEY)) || DEFAULT_HEIGHT),

  addEntry: (entry) => {
    const id = uid();
    set((s) => ({ entries: [...s.entries, { ...entry, id, timestamp: Date.now() }] }));
    return id;
  },

  appendToResponse: (chunk) => {
    const { _responseId } = get();
    if (_responseId) {
      set((s) => ({
        entries: s.entries.map((e) =>
          e.id === _responseId ? { ...e, content: e.content + chunk } : e
        ),
      }));
    } else {
      const id = uid();
      set((s) => ({
        _responseId: id,
        entries: [
          ...s.entries,
          { id, timestamp: Date.now(), type: 'response', label: 'Model Response', content: chunk },
        ],
      }));
    }
  },

  resetResponse: () => set({ _responseId: null }),

  clearEntries: () => set({ entries: [], _responseId: null }),

  setOpen: (isOpen) => {
    localStorage.setItem(PANEL_OPEN_KEY, String(isOpen));
    set({ isOpen });
  },

  setHeight: (h) => {
    const clamped = Math.max(MIN_HEIGHT, h);
    localStorage.setItem(PANEL_HEIGHT_KEY, String(clamped));
    set({ height: clamped });
  },
}));
