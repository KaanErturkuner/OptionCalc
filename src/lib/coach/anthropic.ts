/*
 * Anthropic Messages API gövdesi ve yanıt ayrıştırma (saf; ağ çağrısı sunucuda: server/app/coach.ts).
 * Anahtar bu dosyada YOK. Sürüm başlığı: anthropic-version 2023-06-01.
 */
export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const ANTHROPIC_VERSION = '2023-06-01';
export const DEFAULT_MODEL = 'claude-haiku-5-5';

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg'; data: string } };

/** Araç tanımı: verilirse model YALNIZ bu aracı çağırır (tool_choice zorunlu) → çıktı şema-uyumlu JSON olur. */
export interface ToolDef { name: string; description: string; input_schema: Record<string, unknown> }

export interface MessagesBody {
  model: string; max_tokens: number; system: string; messages: { role: 'user'; content: ContentBlock[] }[];
  tools?: ToolDef[]; tool_choice?: { type: 'tool'; name: string };
}

export function buildMessagesBody(a: { model: string; system: string; content: ContentBlock[]; maxTokens: number; tool?: ToolDef }): MessagesBody {
  const body: MessagesBody = { model: a.model, max_tokens: a.maxTokens, system: a.system, messages: [{ role: 'user', content: a.content }] };
  if (a.tool) { body.tools = [a.tool]; body.tool_choice = { type: 'tool', name: a.tool.name }; }
  return body;
}

export interface ParsedReply { text: string; toolInput: Record<string, unknown> | null; inTokens: number; outTokens: number; stopReason: string | null }

/** Yanıt: metin blokları birleşir; ilk tool_use girdisi (nesne) alınır; usage ve stop_reason alınır. Yapısı bozuksa text boş döner. */
export function parseMessagesReply(j: any): ParsedReply {
  const blocks: unknown[] = Array.isArray(j?.content) ? j.content : [];
  const text = blocks.filter((b: any) => b?.type === 'text' && typeof b.text === 'string').map((b: any) => b.text).join('\n');
  const tu = blocks.find((b: any) => b?.type === 'tool_use' && !!b.input && typeof b.input === 'object' && !Array.isArray(b.input)) as { input: Record<string, unknown> } | undefined;
  return {
    text,
    toolInput: tu ? tu.input : null,
    inTokens: Number(j?.usage?.input_tokens ?? 0) || 0,
    outTokens: Number(j?.usage?.output_tokens ?? 0) || 0,
    stopReason: typeof j?.stop_reason === 'string' ? j.stop_reason : null,
  };
}
