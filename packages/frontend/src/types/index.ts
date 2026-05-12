export interface User {
  id: string;
  display_name: string;
  username: string;
  is_admin: number;
}

export interface Session {
  id: string;
  title: string;
  created_at: string;
  project_id?: string | null;
  archived_at?: string | null;
}

export interface ChatMessage {
  id: string;
  session_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ToolEvent {
  id: string;
  name: string;
  args: string;
  result?: string;
  error?: boolean;
}

export type PendingStep =
  | { step: 'idle' }
  | { step: 'mfa'; mfaToken: string }
  | { step: 'register-totp'; totpUri: string; totpSecret: string; confirmToken: string };
