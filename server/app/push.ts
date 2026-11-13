/* Expo push (HTTPS): https://exp.host/--/api/v2/push/send — yalnız sunucudan; token ve içerik loglanmaz. */
import type { FlowEvent } from '../../src/lib/flow/model.ts';
import { contractLabel, fmtUsdShort } from '../../src/lib/flow/model.ts';
import type { Store } from './store.ts';
import type { PushSender } from './poller.ts';

const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

export function eventMessage(e: FlowEvent): { title: string; body: string; data: Record<string, unknown> } {
  const tag = e.confirmed ? '' : ' (teyitsiz)';
  return {
    title: `Olağandışı akış · ${e.ticker}${tag}`,
    body: `${contractLabel(e)} · ${e.dv.toLocaleString('tr-TR')} kontrat · ~${fmtUsdShort(e.prem)} prim`,
    data: { type: 'flow', id: e.id, occ: e.occ },
  };
}

export class ExpoPush implements PushSender {
  private readonly store: Store;
  private readonly accessToken: string;
  private readonly fetchImpl: typeof fetch;
  private readonly log: (m: string) => void;
  constructor(store: Store, accessToken: string, fetchImpl: typeof fetch = fetch, log: (m: string) => void = () => {}) {
    this.store = store; this.accessToken = accessToken; this.fetchImpl = fetchImpl; this.log = log;
  }

  async send(events: FlowEvent[]): Promise<{ sent: number; ids: number[] }> {
    const tokens = this.store.pushTokens();
    if (!tokens.length || !events.length) return { sent: 0, ids: [] };
    const messages = [];
    const idOf: number[] = [];
    for (const e of events) for (const to of tokens) {
      const m = eventMessage(e);
      messages.push({ to, title: m.title, body: m.body, data: m.data, sound: 'default', priority: 'high', channelId: 'flow' });
      idOf.push(e.id);
    }
    const ids = new Set<number>();
    let sent = 0;
    for (let i = 0; i < messages.length; i += 100) {
      const chunk = messages.slice(i, i + 100);
      const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
      if (this.accessToken) headers.Authorization = `Bearer ${this.accessToken}`;
      const r = await this.fetchImpl(EXPO_URL, { method: 'POST', headers, body: JSON.stringify(chunk), signal: AbortSignal.timeout(15000) });
      const j: any = await r.json().catch(() => null);
      const tickets: any[] = Array.isArray(j?.data) ? j.data : [];
      tickets.forEach((t, k) => {
        const msg = chunk[k];
        if (t?.status === 'ok') { sent++; ids.add(idOf[i + k]); return; }
        const code = t?.details?.error;
        if (code === 'DeviceNotRegistered' && msg) this.store.removePushToken(msg.to);
        this.log(`push başarısız: ${code ?? 'bilinmeyen'}`);
      });
      if (!r.ok && !tickets.length) this.log(`push HTTP ${r.status}`);
    }
    return { sent, ids: [...ids] };
  }
}
