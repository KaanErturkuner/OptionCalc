/*
 * Anthropic Messages API gövdesi ve yanıt ayrıştırma (saf; ağ çağrısı sunucuda: server/app/coach.ts).
 * Anahtar bu dosyada YOK. Sürüm başlığı: anthropic-version 2023-06-01.
 */
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MODEL = 'claude-haiku-5-5';

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };

export function buildMessagesBody(a: { model: string; system: string; content: ContentBlock[]; maxTokens: number }) {
  return { model: a.model, max_tokens: a.maxTokens, system: a.system, messages: [{ role: 'user' as const, content: a.content }] };
}

export interface ParsedReply { text: string; inTokens: number; outTokens: number; stopReason: string | null }

/** Yanıt: metin blokları birleşir; usage ve stop_reason alınır. Yapısı bozuksa text boş döner. */
export function parseMessagesReply(j: any): ParsedReply {
  const blocks: unknown[] = Array.isArray(j?.content) ? j.content : [];
  const text = blocks.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
  return {
    text,
    inTokens: Number(j?.usage?.input_tokens ?? 0) || 0,
    outTokens: Number(j?.usage?.output_tokens ?? 0) || 0,
    stopReason: typeof j?.stop_reason === 'string' ? j.stop_reason : null,
  };
}
