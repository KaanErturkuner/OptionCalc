/* Fırsat tarama turu: veri → vade → snapshot → A1/A2 uyumu (yardımcı semboller) → setuplar (S1–S6) → strike + RR → durum.
 * Skor (Aşama 2 bağlantısı) ve bildirim bu tura henüz bağlı değil. MarketData'ya HİÇ gitmez (zincir CBOE/Yahoo). */
import { loadSymbol, loadChain } from '@/lib/market';
import { loadBars } from '@/lib/market/bars';
import { trimChain } from '@/lib/odte/scan';
import { sessionBars, vwap, type Bar } from '@/lib/odte/analytics';
import { openRange } from '@/lib/odte/strategies/util';
import { buildSnapshot } from '@/lib/radar/snapshot';
import { profileFor, auxSymbols } from '@/lib/signals/profiles';
import { autoK, otmDistance } from '@/lib/signals/otm';
import { dteWarning } from '@/lib/signals/tickers';
import { frameAligned, volRatio } from '@/lib/signals/features';
import { alignFor } from '@/lib/signals/align';
import { allowedFor, runSetups } from '@/lib/signals/setups/index';
import { scanStrikes } from '@/lib/signals/strikes';
import { etMinutes, sessionLeftMin, timeToExpiryMin, timeToExpiryYears, scaleEm } from '@/lib/signals/session';
import type { SetupCtx } from '@/lib/signals/types';
import { etDate } from '@/lib/usmarket';
import { cached, SCAN_TTL } from './scanCache';
import { firsat, type TickerStatus } from './firsatStore';

let running = false;
const FRAMES = [1, 5, 15];
const dteOf = (exp: string, today: string) => Math.round((Date.parse(exp) - Date.parse(today)) / 864e5);
const emptyStatus = (at: number): TickerStatus => ({
  at, spot: NaN, changePct: NaN, expiry: '', dte: 0, emPct: NaN, expectedMove: NaN,
  k: NaN, kSource: '', kNote: '', vwapSide: '—', frames: '', volRatio: null,
  source: '', delayedMin: 0, warn: null, setups: [],
});

async function loadAux(syms: string[], now: number): Promise<Record<string, Bar[] | undefined>> {
  const out: Record<string, Bar[] | undefined> = {};
  await Promise.all(syms.map(async s => {
    try { out[s] = sessionBars((await cached('aux:' + s, SCAN_TTL, () => loadBars(s))).bars, now); }
    catch { out[s] = undefined; }
  }));
  return out;
}

async function scanOne(t: string, now: number): Promise<TickerStatus> {
  const today = etDate(now), p = profileFor(t);
  const data = await cached('fırsat:' + t, SCAN_TTL, async () => {
    const L = await loadSymbol(t, 'auto', {});
    const exps = L.expirations;
    const dtes = exps.map(e => dteOf(e, today));
    const pick = exps.find((_, i) => dtes[i] >= p.dte[0] && dtes[i] <= p.dte[1]) ?? exps[0];
    if (!pick) throw new Error('vade bulunamadı');
    const [chRaw, B] = await Promise.all([loadChain(L.provider, t, pick, {}, 40), loadBars(t)]);
    return { L, dtes, pick, chain: trimChain(chRaw, L.quote.price), bars: B.bars };
  });
  const sb = sessionBars(data.bars, now);
  const price = data.L.quote.price;
  const snap = buildSnapshot({ ticker: t, price, changePct: data.L.quote.changePct, chain: data.chain, expiry: data.pick, bars: data.bars, now,
    source: data.L.quote.source, delayedMin: data.L.quote.delayedMin, dataTime: data.L.quote.time, prevOi: null, atmIvSession0: null, sector: null });
  const vw = vwap(sb), or = openRange(sb, 15), ratio = volRatio(sb);
  const bullN = FRAMES.filter(m => frameAligned(sb, 'bull', m)).length, bearN = FRAMES.filter(m => frameAligned(sb, 'bear', m)).length;
  // Geçmiş oranı henüz birikmediği için k başlangıç değeridir
  const ak = autoK({ rule: p.otm, ratios: [], ivRank: null });
  const dte = dteOf(data.pick, today);
  const setups: string[] = [];
  // Setuplar: seans açık, EM/OR/VWAP/hacim hazırsa çalışır
  const etMin = etMinutes(now), leftMin = sessionLeftMin(now);
  const toExpMin = timeToExpiryMin(today, data.pick, leftMin);
  const T0 = timeToExpiryYears(toExpMin);
  const { emDay: em, emRemain } = scaleEm(snap.expectedMove ?? NaN, leftMin, toExpMin);
  if (leftMin > 0 && Number.isFinite(em) && or && vw != null && sb.length >= 2 && Number.isFinite(ratio)) {
    const aux = await loadAux(auxSymbols([t]), now);
    aux[t] = sb; // rejimde kendi sembolü olan profiller (QQQ) için
    const align = { bull: alignFor(p, aux, 'bull').all, bear: alignFor(p, aux, 'bear').all };
    const ctx: SetupCtx = { ticker: t, now, etMin, dte, bars: sb, S: price, em, emRemain, vwap: vw, orHi: or.high, orLo: or.low,
      volRatio: ratio, align, allowed: allowedFor(t), newsImpulse: null,
      walls: { call: snap.callWall, put: snap.putWall, gexNeg: (snap.netGex ?? 0) < 0 }, ivRank: null, rv10: null, atmIv: snap.atmIv ?? null };
    const quotes = [...data.chain.calls, ...data.chain.puts].map(q => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, iv: q.iv, volume: q.volume, oi: q.oi }));
    for (const c of runSetups(ctx)) {
      const type = c.dir === 'bull' ? 'call' : 'put', dl = type === 'call' ? 'call' : 'put';
      const pick = scanStrikes({ type, S: price, d: otmDistance(ak.k, em), quotes, T0, und: c.und, emRemain, sessionLeftMin: leftMin,
        minVol: p.minVol, minOi: p.minOi, maxSpreadPct: p.maxSpreadPct });
      setups.push(pick
        ? `${c.setup} ${dl} · strike ${pick.strike} · RR 1:${pick.rr.rr.toFixed(1)} · dayanak ${c.und.stop.toFixed(2)} → ${c.und.target.toFixed(2)}`
        : `${c.setup} ${dl}: uygun strike/RR yok`);
    }
  }
  return {
    at: now, spot: price, changePct: data.L.quote.changePct, expiry: data.pick, dte, emPct: snap.emPct ?? NaN, expectedMove: snap.expectedMove ?? NaN,
    k: ak.k, kSource: ak.source, kNote: ak.note, vwapSide: vw == null ? '—' : price >= vw ? 'üstünde' : 'altında',
    frames: `yükseliş ${bullN}/3 · düşüş ${bearN}/3`, volRatio: Number.isFinite(ratio) ? +ratio.toFixed(2) : null,
    source: data.L.quote.source, delayedMin: data.L.quote.delayedMin, warn: dteWarning(t, data.dtes), setups,
  };
}

/** Bir tur: ayardaki tüm sinyal tickerları. Aynı anda ikinci tur başlamaz. Döner: başarılı ticker sayısı. */
export async function runSignalScan(): Promise<number> {
  if (running) return 0;
  running = true;
  let ok = 0;
  try {
    await firsat.load();
    const now = Date.now();
    for (const t of firsat.get().settings.tickers) {
      try { firsat.setStatus(t, await scanOne(t, now)); ok++; }
      catch (e) {
        const prev = firsat.get().status[t];
        const msg = e instanceof Error ? e.message : 'veri alınamadı';
        firsat.setStatus(t, { ...(prev ?? emptyStatus(now)), at: now, error: msg, setups: prev?.setups ?? [] });
      }
    }
    firsat.setLastScan(now);
  } finally { running = false; }
  return ok;
}
