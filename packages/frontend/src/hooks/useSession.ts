import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../lib/api.js';

export interface Message {
  id: string;
  session_id: string;
  role: string;
  content: string;
  created_at: string;
}

export function useSession(sessionId: string | null) {
  const [messages, setMessages] = useState<Message[]>([]);
  const loadRef = useRef<(() => Promise<void>) | null>(null);

  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      loadRef.current = null;
      return;
    }

    const reload = async () => {
      const data = await apiFetch<Message[]>(`/api/sessions/${sessionId}/messages`);
      setMessages(data);
    };

    loadRef.current = reload;
    void reload().catch(() => null);
  }, [sessionId]);

  const reloadMessages = async () => {
    await loadRef.current?.();
  };

  return { messages, reloadMessages };
}
