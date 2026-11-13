/* Açık kâğıt pozisyonun tek tick adımı: gap (ertesi sabah), 15:45 gece kararı, risk izleyici, çıkış. Saf.
 * Girdi: kontratın bid'i ve tetik bayrakları (çağıran zincir ve barlardan hesaplar). SINYAL-FIRSAT §7.3, §7.8. */
import type { PaperAccount, ClosedTrade, ExitReason, OpenPosition } from './types.ts';
import { startDay, closePosition } from './account.ts';
import { exitFill } from './costs.ts';
import { overnightDecision, gapOpenAction } from './overnight.ts';
import { evaluatePosition, type TriggerId } from '../signals/riskwatch.ts';

export interface TickIn {
  day: string;                 // bugünkü işlem günü (ET)
  now: number;
  etMin: number;               // ET dakika
  bid: number | null;          // kontratın alınabilir bid'i; yoksa karar verilmez
  flags: Partial<Record<TriggerId, boolean>>;
  S: number;                   // dayanak (son fiyat)
  ivAtm: number;               // ATM IV (gece riski için)
  openUnd?: number; openBid?: number;   // ertesi sabah ilk bar (gap)
  eventBeforeOpen: boolean;    // bilanço/makro açılıştan önce
  strongTriggerLast30: boolean;
  regimeAligned: boolean;
}

export interface TickEvent { kind: 'warn' | 'close' | 'carry' | 'info'; text: string; trade?: ClosedTrade }
export interface TickResult { acc: PaperAccount; events: TickEvent[] }

const REASON_TEXT: Record<ExitReason, string> = {
  hedef: 'hedefe ulaştı', stop: 'stop vurdu', 'prim-stop': 'prim tavanı vurdu', 'iz-suren-stop': 'iz süren stop vurdu',
  risk: 'risk artıyor', zaman: '15:45 zorunlu çıkış', gap: 'ertesi sabah gap', 'gece-kapanis': 'gece taşınamadı, 15:45 kapanış',
  vade: 'vade', manuel: 'elle kapatıldı',
};

/** Çıkış nedeni → kalibrasyon sonucu (§5.5). */
export const outcomeOf = (r: ExitReason): 'hedef' | 'stop' | 'zaman' =>
  r === 'hedef' ? 'hedef' : r === 'zaman' || r === 'gece-kapanis' || r === 'vade' || r === 'manuel' ? 'zaman' : 'stop';

export function tickPosition(acc0: PaperAccount, t: TickIn): TickResult {
  const acc = startDay(acc0, t.day);
  const events: TickEvent[] = [];
  let p: OpenPosition | null = acc.position;
  if (!p || t.bid === null || !Number.isFinite(t.bid)) return { acc, events };
  const slip = acc.settings.slippage;
  const dirSign = p.dir === 'call' ? 1 : -1;
  let flags = t.flags;

  const close = (a: PaperAccount, bid: number, reason: ExitReason, text: string, gap = false): TickResult => {
    const r = closePosition(a, exitFill(bid, slip), reason, t.now, t.day, gap);
    if (!r.ok) return { acc: a, events };
    const trade = r.acc.trades[r.acc.trades.length - 1];
    events.push({ kind: 'close', text: `Başkan, ${text}. Kâğıt pozisyonu ${trade.netPnl >= 0 ? '+' : ''}${trade.netPnl.toFixed(0)} $ ile kapattım.`, trade });
    return { acc: r.acc, events };
  };

  // 1) Ertesi sabah (gece taşınan pozisyon): gap yönetimi. Açılış yoksa karar yok.
  if (p.overnight && p.day !== t.day) {
    if (t.openUnd === undefined || t.openBid === undefined || t.etMin < 571) return { acc, events };
    const stopUnd = p.und?.stop ?? NaN;
    const g = gapOpenAction({ pos: p, openUnd: t.openUnd, openBid: t.openBid, stopUnd, etMin: t.etMin }, dirSign as 1 | -1);
    if (g.action === 'gap-close') return close(acc, t.openBid, 'gap', REASON_TEXT.gap, true);
    if (g.action === 'wait') flags = {};   // 09:45 öncesi: yalnız stop/hedef (T1–T7 devre dışı)
  }

  // 2) Risk izleyici önce (hedef/stop/iz süren/risk/0DTE 15:45). 15:45'te hedef veya stop vurmuşsa gece taşınmaz.
  const dec = evaluatePosition(p, { bid: t.bid, etMin: t.etMin, mode: acc.mode, flags });
  if (dec.action === 'close') {
    const r = dec.reason ?? 'stop';
    const trig = dec.triggers.length ? ` (${dec.triggers.join(', ')})` : '';
    return close({ ...acc, position: dec.pos }, t.bid, r, `${REASON_TEXT[r]}${r === 'risk' ? trig : ''}`);
  }
  p = dec.pos;
  if (dec.action === 'warn') {
    events.push({ kind: 'warn', text: `Başkan, ${dec.message ?? 'risk artıyor'}.` });
  }

  // 3) 15:45 ET: hâlâ açıksa 1–3 DTE gece kararı (0DTE yukarıda zorunlu çıkışla kapanır).
  if (p.dte >= 1 && t.etMin >= 945 && p.nightDay !== t.day) {
    const d = overnightDecision({
      pos: p, day: t.day, S: t.S, ivAtm: t.ivAtm, eventBeforeOpen: t.eventBeforeOpen,
      strongTriggerLast30: t.strongTriggerLast30, regimeAligned: t.regimeAligned,
    });
    p = { ...p, nightDay: t.day };
    if (d.carry) {
      p = { ...p, overnight: true };
      events.push({ kind: 'carry', text: `Başkan, ${p.ticker} ${p.dte}DTE pozisyonu gece taşıyorum. Kötü senaryo −${Math.round(d.badLoss)} $ (${d.badR.toFixed(1)}R). Yarın 09:31'de gap kontrolü yapacağım.` });
      return { acc: { ...acc, position: p }, events };
    }
    return close({ ...acc, position: p }, t.bid, 'gece-kapanis', `gece taşınamadı (${d.reasons.join(', ')})`);
  }

  return { acc: { ...acc, position: p }, events };
}
