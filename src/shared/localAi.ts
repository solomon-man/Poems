export type LocalAiModel = 'qwen' | 'deepseek';

export interface AiChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface AiChatRequest {
  messages: AiChatMessage[];
  model?: LocalAiModel;
}

export interface AiReviewRequest {
  text: string;
  model?: LocalAiModel;
}

export interface AiResult {
  canceled?: boolean;
  message?: string;
}

export interface AiChatResult extends AiResult {
  text?: string;
}

export interface AiReviewResult extends AiResult {
  lines?: string[];
}

export interface ApplyLyricsReviewRequest {
  documentId?: string;
  originalText: string;
  originalLrc?: string;
  lines: string[];
}

export interface AppliedLyricsResult {
  text?: string;
  lrc?: string;
  message?: string;
}
