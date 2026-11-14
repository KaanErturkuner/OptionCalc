/* Fırsat ekranı: işlem kartları (en güçlü 1–3 fırsat) ve BEKLE kartı. Saf: ağ, React, Node yok.
 * Yalnız sunum ve türetilmiş işlem alanları: vade/strike/prim/stop/hedef zaten verdict.ts'te; burada
 * adet (sizing.ts), komisyon ve net K/Z (costs.ts), gece etiketi (releases.ts) ve BEKLE tetikleyici metni hesaplanır.
 * Kağıt üstü; tavsiye değildir (AGENTS.md §1). */
import { MIN_SUM, type VerdictCard, type Crit } from './verdict.ts';
import { sizePosition } from '../paper/sizing.ts';
import { netPnl } from '../paper/costs.ts';
import type { Kademe } from '../paper/types.ts';
import { cardCalendarLines, eventsOn, nextTd, BLOCKING_KEYS } from '../calendar/releases.ts';
import { etDate } from '../usmarket.ts';
import { fmt } from '../format.ts';

export const MAX_TRADE_CARDS = 3;
/** Stop: prim %67 düşüş (giriş × 0,33). */
export const STOP_PCT = 67;

const TR_MONTHS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
const px = (x: number) => fmt(x, x % 1 ? 2 : 0);   // 690 → "690", 688,5 → "688,50"

export interface TradeAccount { capital: number; kademe: Kademe; commission: number }
export interface TradeSizing {
  capital: number; tierPct: number; contracts: number; commission: number;   // commission: kontrat başına tek yön ($)
  minCost: number;          // 1 kontrat için gereken tutar ($, prim + açılış komisyonu)
  premiumCost: number;      // prim maliyeti ($)
  openComm: number;         // açılış komisyonu ($)
  rtComm: number;           // gidiş-dönüş komisyon ($)
  stopNet: number;          // stopta net K/Z ($, komisyon dâhil, negatif)
  targetNet: number;        // 1:5 hedefte net K/Z ($)
  targetNet4: number;       // 1:4 yedekte net K/Z ($)
}
export interface OvernightLabel { carry: boolean; label: string; sub: string }
export interface TradeCard {
  key: string; ticker: string; dir: 'call' | 'put'; typeLabel: 'CALL' | 'PUT';
  spot: number; strike: number; otm: number;               // otm: spot'tan strike uzaklığı ($)
  dte: number; dteLabel: string; expiry: string; expiryLabel: string;
  entry: number; stop: number; t5: number; t4: number; riskPerContract: number; stopPct: number;
  strength: number; strengthText: string; sum: number;
  rationale: string;
  overnight: OvernightLabel;
  warnings: string[];                                      // makro uyarılar (bugün/yarın)
  sizing: TradeSizing | null;                              // hesap yoksa null
}
export interface WaitLine { ticker: string; text: string }
export interface WaitCard { reason: string; lines: WaitLine[] }
export interface Board { trades: TradeCard[]; wait: WaitCard | null }
export interface BoardEntry { ticker: string; verdict: VerdictCard }

/** "2026-11-14" → "14 Kas" */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split('-').map(Number);
  return `${d} ${TR_MONTHS[m - 1] ?? ''}`;
}

/** Vade etiketi: 0DTE / "1 gün" … */
export const dteLabelOf = (dte: number): string => (dte === 0 ? '0DTE' : `${dte} gün`);

/** Gece taşıma etiketi (§7.8 ve K4): 0DTE her zaman 15:45'te kapanır; 1–3 DTE, bugün/yarın FOMC/CPI/NFP varsa taşınmaz. */
export function overnightOf(dte: number, nowMs: number): OvernightLabel {
  if (dte < 1) return { carry: false, label: "15:45 ET'de kapat", sub: '0DTE: gün bitmeden kapanır' };
  const today = etDate(nowMs);
  const blocking = [...new Set([today, nextTd(today)]
    .flatMap(d => eventsOn(d).filter(e => BLOCKING_KEYS.has(e.key)).map(e => e.short)))];
  if (blocking.length) return { carry: false, label: "15:45 ET'de kapat", sub: `${blocking.join(', ')} nedeniyle gece taşınmaz` };
  return { carry: true, label: 'Gece taşınabilir', sub: '15:45 ET kararı: rejim ve gece riski kontrolü' };
}

/** Adet ve komisyon: kademe bütçesi (sermaye × %) ile floor(bütçe / (prim×100 + komisyon)). Net K/Z komisyon dâhil. */
export function tradeSizing(a: TradeAccount, entry: number, stop: number, t5: number, t4: number): TradeSizing {
  const sz = sizePosition(a.capital, a.kademe, entry, { commission: a.commission });
  const n = sz.contracts, comm = a.commission;
  return {
    capital: a.capital, tierPct: Math.round(a.kademe * 100), contracts: n, commission: comm,
    minCost: entry * 100 + comm,
    premiumCost: n * entry * 100, openComm: n * comm, rtComm: 2 * n * comm,
    stopNet: n > 0 ? netPnl(entry, stop, n, comm) : 0,
    targetNet: n > 0 ? netPnl(entry, t5, n, comm) : 0,
    targetNet4: n > 0 ? netPnl(entry, t4, n, comm) : 0,
  };
}

/** Düz Türkçe gerekçe: "Yükseliş yönünde: VWAP üstünde, açılış aralığı yukarı kırıldı." */
export function rationaleOf(v: VerdictCard): string {
  const side = v.dir === 'call' ? 'Yükseliş' : v.dir === 'put' ? 'Düşüş' : '';
  const why = v.fired.slice(0, 3);
  if (!side) return 'Göstergeler yön vermiyor.';
  return why.length ? `${side} yönünde: ${why.join(', ')}.` : `${side} yönünde, ama net bir gösterge yok.`;
}

/** Tek işlem kartı. Yön, strike, prim yoksa null (işlem önerilmez). */
export function tradeOf(e: BoardEntry, nowMs: number, acct: TradeAccount | null): TradeCard | null {
  const v = e.verdict;
  if (v.dir === 'bekle' || v.strike == null || v.entry == null || v.stop == null || v.t5 == null || v.t4 == null
    || v.dte == null || !v.expiry || v.riskPerContract == null) return null;
  const dir = v.dir;
  const spot = v.levels.S;
  return {
    key: `${e.ticker}|${dir}|${v.strike}|${v.expiry}`,
    ticker: e.ticker, dir, typeLabel: dir === 'call' ? 'CALL' : 'PUT',
    spot, strike: v.strike, otm: Math.abs(v.strike - spot),
    dte: v.dte, dteLabel: dteLabelOf(v.dte), expiry: v.expiry, expiryLabel: `${dteLabelOf(v.dte)} · ${shortDate(v.expiry)}`,
    entry: v.entry, stop: v.stop, t5: v.t5, t4: v.t4, riskPerContract: v.riskPerContract, stopPct: STOP_PCT,
    strength: v.strength, strengthText: v.strengthText, sum: v.sum,
    rationale: rationaleOf(v),
    overnight: overnightOf(v.dte, nowMs),
    warnings: cardCalendarLines(nowMs),
    sizing: acct ? tradeSizing(acct, v.entry, v.stop, v.t5, v.t4) : null,
  };
}

/**
 * BEKLE tetikleyicisi: net puanı eşiğe (±MIN_SUM) en az değiştirecek yönü seçer, o yönün seviyelerini sıralar
 * ve gerekli puanı tamamlayan en küçük kümeyi yazar. Örnek: "QQQ 690 üstü + VWAP 688 üstü → CALL".
 */
export function triggerText(ticker: string, v: VerdictCard): string {
  const call = v.sum >= 0;
  const need = call ? MIN_SUM - v.sum : v.sum + MIN_SUM;      // eşiğe kalan puan
  const want = call ? 1 : -1, L = v.levels, side = call ? 'üstü' : 'altı';
  const pts = (id: Crit['id']) => v.crits.find(c => c.id === id)?.pts ?? 0;
  const items: { gain: number; text: string }[] = [];
  const add = (id: Crit['id'], ok: boolean, text: string) => {
    const gain = Math.abs(want - pts(id));
    if (ok && gain > 0) items.push({ gain, text });
  };
  add('orb', L.orHigh != null && L.orLow != null, call ? `${px(L.orHigh ?? 0)} üstü` : `${px(L.orLow ?? 0)} altı`);
  add('vwap', L.vwap != null, `VWAP ${px(L.vwap ?? 0)} ${side}`);
  add('flip', L.flip != null, `gamma flip ${px(L.flip ?? 0)} ${side}`);
  add('momentum', true, call ? 'yukarı momentum' : 'aşağı momentum');
  const picked: string[] = [];
  let got = 0;
  for (const it of items.sort((a, b) => b.gain - a.gain)) {
    if (got >= need) break;
    picked.push(it.text); got += it.gain;
  }
  const label = call ? 'CALL' : 'PUT';
  if (!picked.length) return `${ticker}: tetikleyici seviye verisi yok`;
  return `${ticker} ${picked.join(' + ')} → ${label}`;
}

/**
 * Board: en güçlü en fazla 3 işlem kartı (güç azalan, eşitlikte |puan| büyük). Hiç işlem yoksa BEKLE kartı.
 * Yön var ama strike/prim yoksa BEKLE satırı bunu söyler.
 */
export function buildBoard(entries: BoardEntry[], nowMs: number, acct: TradeAccount | null): Board {
  const trades = entries
    .map(e => tradeOf(e, nowMs, acct))
    .filter((t): t is TradeCard => t != null)
    .sort((a, b) => b.strength - a.strength || Math.abs(b.sum) - Math.abs(a.sum))
    .slice(0, MAX_TRADE_CARDS);
  if (trades.length) return { trades, wait: null };
  if (!entries.length) return { trades: [], wait: { reason: 'Tarama bekleniyor; henüz veri yok.', lines: [] } };
  const anyDir = entries.some(e => e.verdict.dir !== 'bekle');
  const reason = anyDir
    ? 'Yön var ama uygun strike ve prim bulunamadı; bekliyorum.'
    : `Sinyaller yön vermiyor (eşik ±${MIN_SUM} puan); bekliyorum.`;
  const lines = entries.map(e => {
    const v = e.verdict;
    if (v.dir !== 'bekle' && (v.strike == null || v.entry == null)) {
      return { ticker: e.ticker, text: `${v.dir === 'call' ? 'CALL' : 'PUT'} yönü var, uygun strike/prim yok` };
    }
    return { ticker: e.ticker, text: triggerText(e.ticker, v) };
  });
  return { trades: [], wait: { reason, lines } };
}
