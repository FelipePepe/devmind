export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: OllamaToolCall[];
  tool_call_id?: string;
}

export interface OllamaTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface OllamaToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatStreamParams {
  model: string;
  messages: OllamaMessage[];
  tools?: OllamaTool[];
  temperature?: number;
  max_tokens?: number;
}

export interface ChatParams extends ChatStreamParams {}

export interface ChatChunk {
  type: 'text' | 'tool_call' | 'done';
  content?: string;
  tool_call?: OllamaToolCall;
  finish_reason?: 'stop' | 'tool_calls' | 'length';
}

export interface ChatResponse {
  message: OllamaMessage;
  finish_reason: 'stop' | 'tool_calls' | 'length';
}
