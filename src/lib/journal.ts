/* İşlem günlüğü: açık/kapalı işlemler, P/L, istatistik, CSV. Saf TS (depolama UI tarafında). */
export interface Trade {
  id: string; ticker: string; type: 'call' | 'put' | 'stock'; strike?: number; expiry?: string; qty: number;
  entry: number; entryTime: number; exit?: number; exitTime?: number; note?: string;
  fromSignal?: boolean; target?: number; stop?: number;
  /** Dayanak hedef/stop ve sinyal anındaki dayanak fiyatı (opsiyon fiyatı yoksa uyarılar için) */
  undTarget?: number; undStop?: number; undRef?: number;
  /** Planlanan çıkış anı (UTC ms) ve zamanlanmış bildirim kimlikleri */
  exitAt?: number; notifIds?: string[];
  /** Gönderilen pozisyon uyarıları (tekrar gönderme) */
  alerts?: ('nearTarget' | 'target' | 'nearStop' | 'stop')[];
  /** Pozisyon uyarıları açık mı (varsayılan açık) */
  watch?: boolean;
}
export interface SignalLog {
  id: string; ticker: string; dir: 'call' | 'put'; strike: number; expiry: string; dte: number; entry: number; target: number; stop: number;
  undTarget: number; undStop: number; time: number; score: number; text: string;
  status: 'open' | 'target' | 'stop' | 'expired'; resolvedAt?: number;
}
export const mult = (t: Trade) => t.type === 'stock' ? 1 : 100;
export const pnl = (t: Trade, price: number) => (price - t.entry) * t.qty * mult(t);
export const realized = (t: Trade) => t.exit != null ? pnl(t, t.exit) : 0;
export const isOpen = (t: Trade) => t.exit == null;
export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

export interface Stats { n: number; wins: number; losses: number; winRate: number | null; total: number; avgWin: number; avgLoss: number; best: number; worst: number }
export function stats(trades: Trade[]): Stats {
  const closed = trades.filter(t => !isOpen(t)), ps = closed.map(realized);
  const w = ps.filter(p => p > 0), l = ps.filter(p => p <= 0);
  return {
    n: closed.length, wins: w.length, losses: l.length, winRate: closed.length ? w.length / closed.length : null,
    total: ps.reduce((a, b) => a + b, 0), avgWin: w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0,
    avgLoss: l.length ? l.reduce((a, b) => a + b, 0) / l.length : 0, best: ps.length ? Math.max(...ps) : 0, worst: ps.length ? Math.min(...ps) : 0,
  };
}
export function byTicker(trades: Trade[]): { ticker: string; s: Stats }[] {
  const m = new Map<string, Trade[]>();
  for (const t of trades) m.set(t.ticker, [...(m.get(t.ticker) || []), t]);
  return [...m.entries()].map(([ticker, ts]) => ({ ticker, s: stats(ts) })).filter(x => x.s.n > 0).sort((a, b) => b.s.total - a.s.total);
}
export function signalStats(sigs: SignalLog[]) {
  const done = sigs.filter(s => s.status !== 'open');
  const t = done.filter(s => s.status === 'target').length, st = done.filter(s => s.status === 'stop').length;
  return { n: sigs.length, resolved: done.length, target: t, stop: st, expired: done.length - t - st, hitRate: t + st ? t / (t + st) : null };
}
/** Opsiyon kodu: "SPY 590C 2026-11-12" */
export const label = (t: { ticker: string; type: string; strike?: number; expiry?: string }) =>
  t.type === 'stock' ? t.ticker : `${t.ticker} ${t.strike}${t.type === 'call' ? 'C' : 'P'} ${t.expiry ?? ''}`.trim();

const iso = (ms?: number) => ms ? new Date(ms).toISOString() : '';
const q = (s: unknown) => { const v = s == null ? '' : String(s); return /[",\n;]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
export function toCSV(trades: Trade[], sigs: SignalLog[] = []): string {
  const rows = [['id', 'ticker', 'type', 'strike', 'expiry', 'qty', 'entry', 'entry_time', 'exit', 'exit_time', 'pnl', 'signal', 'note']];
  for (const t of trades) rows.push([t.id, t.ticker, t.type, t.strike ?? '', t.expiry ?? '', t.qty, t.entry, iso(t.entryTime), t.exit ?? '', iso(t.exitTime),
    t.exit != null ? realized(t).toFixed(2) : '', t.fromSignal ? 'yes' : '', t.note ?? ''] as any);
  let out = rows.map(r => r.map(q).join(',')).join('\n');
  if (sigs.length) {
    out += '\n\nsignal_id,ticker,dir,strike,expiry,dte,entry,target,stop,time,score,status,resolved_at\n';
    out += sigs.map(s => [s.id, s.ticker, s.dir, s.strike, s.expiry, s.dte, s.entry, s.target, s.stop, iso(s.time), s.score, s.status, iso(s.resolvedAt)].map(q).join(',')).join('\n');
  }
  return out;
}
