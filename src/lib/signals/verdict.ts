/*
 * Net karar ("Sonuç" kartı): yön (CALL / PUT / Bekle), güç 0–5, önerilen vade + strike, giriş (prim orta noktası),
 * stop (%67 prim stopu) ve hedef (1:5, yedek 1:4). Saf: ağ, React ve Node yerleşik modülü yok.
 * Kağıt üstü: bu bir tavsiye değildir; motor kanıtlanmış bir avantaj göstermemiştir (AGENTS.md §1).
 *
 * Puanlama şeffaftır: her kriter −1 / 0 / +1 katkı verir (+1 = CALL yönü). Toplam |puan| ≥ 3 ise yön oluşur;
 * güç = min(5, |puan|). Yön yoksa "Bekle"; güç yine de gösterilir (zayıf/çelişkili okuma).
 */
import { sizePosition } from '../paper/sizing.ts';
import type { Kademe } from '../paper/types.ts';

export type VerdictDir = 'call' | 'put' | 'bekle';
export type CritId = 'vwap' | 'orb' | 'flip' | 'wall' | 'pc' | 'unusual' | 'momentum';
export interface Crit { id: CritId; pts: -1 | 0 | 1; text: string }

/** Kriter girdileri. Eksik veri = null/0 → kriter 0 puan ("veri yok" metni). */
export interface VerdictInputs {
  S: number;
  vwap: number | null;
  orHigh: number | null; orLow: number | null;   // açılış aralığı (tamamlanmamışsa null)
  flip: number | null;                            // gamma flip
  callWall: number | null; putWall: number | null;
  emMove: number | null;                          // beklenen hareket ($), duvar yakınlığı için
  pcVol: number | null;                           // put/call hacim oranı
  unusualCall: number; unusualPut: number;        // sıra dışı hacim toplamları (kontrat)
  momentum: -1 | 0 | 1 | null;                    // fiyat momentumu (EMA/ çoklu zaman dilimi)
}

/** Yön eşiği: |puan| bu değerin altındaysa Bekle */
export const MIN_SUM = 3;

export function criteria(i: VerdictInputs): Crit[] {
  const out: Crit[] = [];
  if (i.vwap == null) out.push({ id: 'vwap', pts: 0, text: 'VWAP verisi yok' });
  else out.push(i.S > i.vwap ? { id: 'vwap', pts: 1, text: 'VWAP üstünde' } : { id: 'vwap', pts: -1, text: 'VWAP altında' });

  if (i.orHigh == null || i.orLow == null || !Number.isFinite(i.orHigh) || !Number.isFinite(i.orLow)) out.push({ id: 'orb', pts: 0, text: 'açılış aralığı tamamlanmadı' });
  else if (i.S > i.orHigh) out.push({ id: 'orb', pts: 1, text: 'açılış aralığı yukarı kırıldı' });
  else if (i.S < i.orLow) out.push({ id: 'orb', pts: -1, text: 'açılış aralığı aşağı kırıldı' });
  else out.push({ id: 'orb', pts: 0, text: 'açılış aralığının içinde' });

  if (i.flip == null) out.push({ id: 'flip', pts: 0, text: 'gamma flip yok' });
  else out.push(i.S > i.flip ? { id: 'flip', pts: 1, text: 'gamma flip üstünde' } : { id: 'flip', pts: -1, text: 'gamma flip altında' });

  // Duvar: yakın put duvarı (destek) → CALL; yakın call duvarı (direnç) → PUT. Her iki taraf da yakınsa net sonuç.
  const near = (wall: number | null, dist: number) => wall != null && i.emMove != null && i.emMove > 0 && dist > 0 && dist / i.emMove < 0.35;
  const putNear = near(i.putWall, i.S - (i.putWall ?? i.S)), callNear = near(i.callWall, (i.callWall ?? i.S) - i.S);
  const wallPts = (putNear ? 1 : 0) - (callNear ? 1 : 0);
  if (i.callWall == null && i.putWall == null) out.push({ id: 'wall', pts: 0, text: 'OI duvarı yok' });
  else if (wallPts > 0) out.push({ id: 'wall', pts: 1, text: 'put duvarı (destek) yakın' });
  else if (wallPts < 0) out.push({ id: 'wall', pts: -1, text: 'call duvarı (direnç) yakın' });
  else out.push({ id: 'wall', pts: 0, text: 'duvarlar uzak' });

  if (i.pcVol == null) out.push({ id: 'pc', pts: 0, text: 'P/C verisi yok' });
  else if (i.pcVol < 0.7) out.push({ id: 'pc', pts: 1, text: `düşük put/call (${i.pcVol.toFixed(2).replace('.', ',')})` });
  else if (i.pcVol > 1.3) out.push({ id: 'pc', pts: -1, text: `yüksek put/call (${i.pcVol.toFixed(2).replace('.', ',')})` });
  else out.push({ id: 'pc', pts: 0, text: 'put/call nötr' });

  const un = i.unusualCall - i.unusualPut;
  if (i.unusualCall + i.unusualPut === 0) out.push({ id: 'unusual', pts: 0, text: 'sıra dışı hacim yok' });
  else if (un > 0) out.push({ id: 'unusual', pts: 1, text: 'sıra dışı call hacmi' });
  else if (un < 0) out.push({ id: 'unusual', pts: -1, text: 'sıra dışı put hacmi' });
  else out.push({ id: 'unusual', pts: 0, text: 'sıra dışı hacim dengeli' });

  if (i.momentum == null) out.push({ id: 'momentum', pts: 0, text: 'momentum verisi yok' });
  else if (i.momentum > 0) out.push({ id: 'momentum', pts: 1, text: 'momentum yukarı' });
  else if (i.momentum < 0) out.push({ id: 'momentum', pts: -1, text: 'momentum aşağı' });
  else out.push({ id: 'momentum', pts: 0, text: 'momentum kararsız' });
  return out;
}

export interface Tally { dir: VerdictDir; strength: number; sum: number; crits: Crit[]; fired: Crit[] }

/** Puanlama: yön, güç, yöne uyan kriterler */
export function tally(crits: Crit[]): Tally {
  const sum = crits.reduce((a, c) => a + c.pts, 0);
  const dir: VerdictDir = sum >= MIN_SUM ? 'call' : sum <= -MIN_SUM ? 'put' : 'bekle';
  // fired = çağrılan yönü destekleyen kriterler (Bekle'de boş; eğilim crits listesinde görünür)
  const s = dir === 'call' ? 1 : dir === 'put' ? -1 : 0;
  const fired = s === 0 ? [] : crits.filter(c => c.pts === s);
  return { dir, strength: Math.min(5, Math.abs(sum)), sum, crits, fired };
}

export const strengthLabel = (s: number): string => s >= 5 ? 'çok güçlü' : s >= 4 ? 'güçlü' : s >= 3 ? 'orta' : s >= 2 ? 'zayıf' : 'çok zayıf';

/** İstanbul saati (UTC+3, yaz saati yok) dakika cinsinden (0–1439) */
export const istMinutes = (nowMs: number): number => (((nowMs / 60000 + 180) % 1440) + 1440) % 1440;
/** Istanbul 16:30–20:00 penceresi: 0DTE tercih edilir */
export const inZeroDteWindow = (nowMs: number): boolean => { const m = istMinutes(nowMs); return m >= 990 && m < 1200; };

export interface ExpiryOpt { date: string; dte: number }
/**
 * Vade seçimi (kural): 16:30–20:00 İst. penceresinde 0DTE varsa o; yoksa 0–3 DTE içinde en yakın vade.
 * Pencere dışında da en yakın vade (0DTE dâhil) seçilir → pencere, yalnız 0DTE'nin varlığında fark yaratır
 * ve bu, tasarım tercihi olarak açık bırakıldı (rapor: açık soru). Uygun vade yoksa null.
 */
export function pickExpiry(opts: ExpiryOpt[], nowMs: number): ExpiryOpt | null {
  const cands = opts.filter(o => o.dte >= 0 && o.dte <= 3).sort((a, b) => a.dte - b.dte || a.date.localeCompare(b.date));
  if (!cands.length) return null;
  if (inZeroDteWindow(nowMs)) { const z = cands.find(o => o.dte === 0); if (z) return z; }
  return cands[0];
}

export interface QuoteLite { type: 'call' | 'put'; strike: number; bid: number; ask: number; volume: number; oi: number }
export interface StrikePickOut { strike: number; bid: number; ask: number; mid: number; distance: number }
/**
 * Uzaklık kuralı: hedef = S ± d (d = k × EM). OTM, çift taraflı fiyatlı, spread ≤ %15 ve hacim/OI eşiği olan
 * strike'lardan hedefe en yakın olanı. Bulunamazsa null.
 */
export function pickRuleStrike(quotes: QuoteLite[], S: number, dir: 'call' | 'put', d: number,
  o: { maxSpreadPct?: number; minVol?: number; minOi?: number } = {}): StrikePickOut | null {
  const maxSp = o.maxSpreadPct ?? 15, minVol = o.minVol ?? 50, minOi = o.minOi ?? 100;
  const target = dir === 'call' ? S + d : S - d;
  let best: StrikePickOut | null = null, bestDist = Infinity;
  for (const q of quotes) {
    if (q.type !== dir) continue;
    if (dir === 'call' ? q.strike <= S : q.strike >= S) continue;          // yalnız OTM
    if (!(q.bid > 0) || !(q.ask > q.bid)) continue;
    const mid = (q.bid + q.ask) / 2;
    if ((q.ask - q.bid) / mid * 100 > maxSp) continue;
    if (q.volume < minVol && q.oi < minOi) continue;
    const dist = Math.abs(q.strike - target);
    if (dist < bestDist || (dist === bestDist && best && Math.abs(q.strike - S) < Math.abs(best.strike - S))) {
      bestDist = dist;
      best = { strike: q.strike, bid: q.bid, ask: q.ask, mid: +mid.toFixed(4), distance: +Math.abs(q.strike - S).toFixed(2) };
    }
  }
  return best;
}

/** Prim seviyeleri: giriş = mid; stop = %67 prim stopu (giriş × 0,33); hedef = giriş + R × (giriş − stop), R = 5 ya da 4 */
export function levelsFor(entry: number): { entry: number; stop: number; t5: number; t4: number; riskPerContract: number } | null {
  if (!(entry >= 0.05) || !Number.isFinite(entry)) return null;
  const e = Math.round(entry * 100) / 100;
  const stop = Math.round(e * 0.33 * 100) / 100;
  const risk = e - stop;
  return { entry: e, stop, t5: Math.round((e + 5 * risk) * 100) / 100, t4: Math.round((e + 4 * risk) * 100) / 100, riskPerContract: Math.round(risk * 10000) / 100 };
}

export const TIER_LABEL = '%50 / %40 / %30 kademe';

export interface VerdictCard {
  dir: VerdictDir; strength: number; strengthText: string; sum: number;
  crits: Crit[]; fired: string[];
  expiry: string | null; dte: number | null;
  strike: number | null; bid: number | null; ask: number | null; mid: number | null;
  entry: number | null; stop: number | null; t5: number | null; t4: number | null; riskPerContract: number | null;
  tierPct: number | null; contracts: number | null;   // kademe ve (hesap varsa) adet
  rationale: string; note: string;
}
export const CARD_NOTE = 'Kâğıt üstü · tavsiye değildir. Komisyon (1,50 $/kontrat, açılış+kapanış) hariç; prim brüt.';

export interface BuildInput {
  inputs: VerdictInputs;
  expiries: ExpiryOpt[]; nowMs: number;
  quotesFor: (expiry: string) => QuoteLite[] | null;      // vadenin zinciri (yoksa null)
  dOf: (expiry: string) => number | null;                 // uzaklık d = k × EM (vade için; yoksa null)
  kademe?: Kademe; capital?: number;                      // Fırsat hesabı varsa adet hesaplanır
}

const trNum = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace('.', ',') : '—');

/** Tam sonuç: yön + vade/strike/prim + gerekçe. Yön Bekle ise strike/prim yine de önerilir (gösterim için) ama giriş açılmaz. */
export function buildVerdict(b: BuildInput): VerdictCard {
  const t = tally(criteria(b.inputs));
  const base = { dir: t.dir, strength: t.strength, strengthText: strengthLabel(t.strength), sum: t.sum, crits: t.crits,
    fired: t.fired.map(c => c.text), tierPct: b.kademe != null ? Math.round(b.kademe * 100) : null, contracts: null, note: CARD_NOTE };
  const exp = pickExpiry(b.expiries, b.nowMs);
  const none = (why: string): VerdictCard => ({ ...base, expiry: exp?.date ?? null, dte: exp?.dte ?? null, strike: null, bid: null, ask: null, mid: null,
    entry: null, stop: null, t5: null, t4: null, riskPerContract: null, rationale: why });
  if (!exp) return none(t.dir === 'bekle' ? `Bekle: yön yok (net puan ${t.sum})` : 'Uygun vade yok (0–3 DTE)');
  const quotes = b.quotesFor(exp.date);
  const d = b.dOf(exp.date);
  const dirSide: 'call' | 'put' = t.dir === 'put' ? 'put' : 'call';
  const pick = quotes && d != null && d > 0 ? pickRuleStrike(quotes, b.inputs.S, dirSide, d) : null;
  const lv = pick ? levelsFor(pick.mid) : null;
  if (t.dir === 'bekle') return none(`Bekle: yön yok (net puan ${t.sum}; eşik ±${MIN_SUM})`);
  const label = t.dir === 'call' ? 'CALL' : 'PUT';
  const why = t.fired.slice(0, 3).map(c => c.text).join(', ') || 'gösterge yok';
  if (!pick || !lv) return none(`${label}, ${strengthLabel(t.strength)} (${t.strength}/5): ${why}; uygun strike/prim yok`);
  const contracts = b.kademe != null && b.capital != null ? sizePosition(b.capital, b.kademe, lv.entry).contracts : null;
  return {
    ...base, contracts,
    expiry: exp.date, dte: exp.dte, strike: pick.strike, bid: pick.bid, ask: pick.ask, mid: pick.mid,
    entry: lv.entry, stop: lv.stop, t5: lv.t5, t4: lv.t4, riskPerContract: lv.riskPerContract,
    rationale: `${label}, ${strengthLabel(t.strength)} (${t.strength}/5): ${why}; giriş ${trNum(lv.entry)} stop ${trNum(lv.stop)} hedef ${trNum(lv.t5)}`,
  };
}
