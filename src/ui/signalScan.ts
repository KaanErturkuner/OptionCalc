/* Fırsat tarama turu (Aşama 5 bağlantısı): veri → vade → snapshot → A1/A2/A3 → setuplar → strike + RR → skor → kart → onay/süre
 * → kâğıt pozisyon tick'i → bildirim. MarketData'ya HİÇ gitmez (zincir CBOE/Yahoo). Gerçek emir yok. */
import { loadSymbol, loadChain } from '@/lib/market';
import { loadBars, yahooDailyBars } from '@/lib/market/bars';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { trimChain } from '@/lib/odte/scan';
import { sessionBars, unusual, vwap, type Bar } from '@/lib/odte/analytics';
import { spotPrice } from '@/lib/signals/spot';
import { buildVerdict, pickExpiry, type QuoteLite, type VerdictCard } from '@/lib/signals/verdict';
import { regimeSummary, type RegimeKind } from '@/lib/market/regime';
import { adaptiveDecision, type AdaptiveDecision } from '@/lib/signals/adaptive';
import { openRange } from '@/lib/odte/strategies/util';
import { buildSnapshot } from '@/lib/radar/snapshot';
import { profileFor, auxSymbols } from '@/lib/signals/profiles';
import { autoK, otmDistance } from '@/lib/signals/otm';
import { dteWarning } from '@/lib/signals/tickers';
import { frameAligned, volRatio } from '@/lib/signals/features';
import { alignFor } from '@/lib/signals/align';
import { allowedFor, runSetups } from '@/lib/signals/setups/index';
import { qullDaily, type DailyBar } from '@/lib/signals/qull/daily';
import { enabledQ, isQ, Q_DEFAULT_PARAMS } from '@/lib/signals/qull/policy';
import { qNote } from '@/lib/signals/qull/note';
import { qExitTriggers } from '@/lib/signals/qull/exits';
import { scanStrikes, type Quote } from '@/lib/signals/strikes';
import { etMinutes, sessionLeftMin, timeToExpiryMin, timeToExpiryYears, scaleEm } from '@/lib/signals/session';
import { calendarCheck, isEtf, type CalendarCheck, type EarningsInfo } from '@/lib/calendar/events';
import { fetchFinnhubEarnings } from '@/lib/news/finnhub';
import { buildOpp, minRrFor, type Opp, type OppInput } from '@/lib/signals/opp';
import { t6Theta, modeTargetR, profitR, type TriggerId } from '@/lib/signals/riskwatch';
import { gateCheck, gateRecord, COOL_MS, type Sent } from '@/lib/signals/gate';
import { appendLog, type SignalLog } from '@/lib/signals/log';
import type { SetupCtx } from '@/lib/signals/types';
import { initAccount, startDay, openPosition, MODE_RULES, type Result } from '@/lib/paper/account';
import { nextTradingDay } from '@/lib/paper/overnight';
import { tickPosition, outcomeOf } from '@/lib/paper/engine';
import { approvalTtlMs, expiryReason, repriceOnApprove, resolveApproval, decisionLabel, type ApprovalSignal } from '@/lib/paper/approval';
import type { PaperAccount, OpenPosition, Kademe } from '@/lib/paper/types';
import { etDate } from '@/lib/usmarket';
import { radar } from '@/ui/radarStore';
import { notifyFirsat } from '@/ui/notify';
import { cached, SCAN_TTL } from './scanCache';
import { firsat, type TickerStatus, type Card, type PosLive } from './firsatStore';

let running = false;
const FRAMES = [1, 5, 15];
const START_CAPITAL = 300;                      // Kaan'ın örnek sermayesi; ayardan değiştirilir
const RADAR_WINDOW_MS = 30 * 60000;
const dteOf = (exp: string, today: string) => Math.round((Date.parse(exp) - Date.parse(today)) / 864e5);
const emptyStatus = (at: number): TickerStatus => ({
  at, spot: NaN, changePct: NaN, expiry: '', dte: 0, emPct: NaN, expectedMove: NaN,
  k: NaN, kSource: '', kNote: '', vwapSide: '—', frames: '', volRatio: null,
  source: '', delayedMin: 0, warn: null, setups: [],
});

/** Bir tarama turunda bir ticker için tüm girdi/çıktılar. */
export interface Scan {
  ticker: string; status: TickerStatus; cands: Opp[]; quotes: Quote[];
  S: number; ivAtm: number | null; sb: Bar[]; leftMin: number; etMin: number; emRemain: number;
  ratio: number; regimeSideNow: 1 | -1 | null; regimeKind: RegimeKind | null; chainAgeSec: number; barAgeSec: number; delayedMin: number; source: string;
}
interface Acct { mode: PaperAccount['mode']; capital: number; kademe: Kademe; commission: number; fractional: boolean; hasPosition: boolean; ttlMin: number | null }

async function loadAux(syms: string[], now: number): Promise<Record<string, Bar[] | undefined>> {
  const out: Record<string, Bar[] | undefined> = {};
  await Promise.all(syms.map(async s => {
    try { out[s] = sessionBars((await cached('aux:' + s, SCAN_TTL, () => loadBars(s))).bars, now); }
    catch { out[s] = undefined; }
  }));
  return out;
}

/** Radar uyarılarından son 30 dk'da aynı yön (toplam şiddet) ve ters yön (en büyük şiddet). */
function radarFor(t: string, dir: 'bull' | 'bear', now: number): { same: number; oppMax: number } {
  let same = 0, oppMax = 0;
  const opp = dir === 'bull' ? 'bear' : 'bull';
  for (const a of radar.get().alerts) {
    if (a.ticker !== t || now - a.at > RADAR_WINDOW_MS) continue;
    for (const s of a.signals) {
      if (s.direction === dir) same += s.severity;
      else if (s.direction === opp) oppMax = Math.max(oppMax, s.severity);
    }
  }
  return { same, oppMax };
}

const DAILY_TTL = 60 * 60000;
const dailyKey = (s: string) => `qd-v1:${s}`;
/** Günlük barlar (Yahoo 6 ay): ticker başına günde bir kez, AsyncStorage'da. Bugünkü kısmi bar dışarıda (sızıntı yok). Hata → null (Q üretmez). */
function dailyFor(sym: string, today: string): Promise<DailyBar[] | null> {
  return cached('qd:' + sym + ':' + today, DAILY_TTL, async () => {
    try {
      const raw = await AsyncStorage.getItem(dailyKey(sym));
      const j = raw ? JSON.parse(raw) : null;
      if (j && j.day === today && Array.isArray(j.bars)) return j.bars as DailyBar[];
    } catch { /* bozuk önbellek: yeniden çekilir */ }
    const bars = (await yahooDailyBars(sym)).filter(b => b.D < today);
    if (bars.length) AsyncStorage.setItem(dailyKey(sym), JSON.stringify({ day: today, bars })).catch(() => {});
    return bars;
  }).catch(() => null);
}

async function scanOne(t: string, now: number, acct: Acct): Promise<Scan> {
  const today = etDate(now), p = profileFor(t);
  const data = await cached('fırsat:' + t, SCAN_TTL, async () => {
    const L = await loadSymbol(t, 'auto', {});
    const exps = L.expirations;
    const dtes = exps.map(e => dteOf(e, today));
    const pick = exps.find((_, i) => dtes[i] >= p.dte[0] && dtes[i] <= p.dte[1]) ?? exps[0];
    if (!pick) throw new Error('vade bulunamadı');
    const [chRaw, B] = await Promise.all([loadChain(L.provider, t, pick, {}, 40), loadBars(t)]);
    return { L, dtes, pick, chain: trimChain(chRaw, L.quote.price), bars: B.bars, at: Date.now() };
  });
  const sb = sessionBars(data.bars, now);
  // Dayanak: taze 1 dk barı (Yahoo) varsa o; yoksa kotasyon. CBOE kotasyonu 15 dk gecikmeli → eski "auto" sırası fiyatı geride tutuyordu.
  const lastBar = data.bars.length ? data.bars[data.bars.length - 1] : null;
  const spot = spotPrice(data.L.quote, lastBar, now);
  const price = spot.price;
  const srcLabel = spot.source === 'bar' ? `1 dk bar (${spot.ageSec} sn önce)` : data.L.quote.source;
  const dMin = spot.delayedMin;
  const changePct = spot.source === 'bar' && data.L.quote.prevClose ? (price / data.L.quote.prevClose - 1) * 100 : data.L.quote.changePct;
  // Qullamaggie (Kaan onayı yok): günlük bağlam yalnız açık Q setupları varsa çekilir
  const qEnabled = enabledQ(firsat.get().settings.q);
  const [dBars, spyBars] = qEnabled.length ? await Promise.all([dailyFor(t, today), dailyFor('SPY', today)]) : [null, null];
  const qd = dBars && dBars.length ? qullDaily(dBars, spyBars && spyBars.length ? spyBars : null, sb[0]?.o) : null;
  const snap = buildSnapshot({ ticker: t, price, changePct, chain: data.chain, expiry: data.pick, bars: data.bars, now,
    source: srcLabel, delayedMin: dMin, dataTime: data.L.quote.time, prevOi: null, atmIvSession0: null, sector: null });
  const vw = vwap(sb), or = openRange(sb, 15), ratio = volRatio(sb);
  const regimeNow = regimeSummary(data.bars, now);   // onaylı rejim (histerezis); kart ve risk izleyici aynısını kullanır
  const bullN = FRAMES.filter(m => frameAligned(sb, 'bull', m)).length, bearN = FRAMES.filter(m => frameAligned(sb, 'bear', m)).length;
  const ak = autoK({ rule: p.otm, ratios: [], ivRank: null });
  const dte = dteOf(data.pick, today);
  const setups: string[] = [];
  if (qEnabled.length && !qd) setups.push('Q: günlük veri yok');
  const cands: Opp[] = [];
  const etMin = etMinutes(now), leftMin = sessionLeftMin(now);
  const toExpMin = timeToExpiryMin(today, data.pick, leftMin);
  const T0 = timeToExpiryYears(toExpMin);
  const { emDay: em, emRemain } = scaleEm(snap.expectedMove ?? NaN, leftMin, toExpMin);
  const barAgeSec = sb.length ? Math.max(0, (now - sb[sb.length - 1].t) / 1000) : 0;
  const chainAgeSec = Math.max(0, (now - data.at) / 1000);
  let regimeSideNow: 1 | -1 | null = null;
  if (leftMin > 0 && Number.isFinite(em) && or && vw != null && sb.length >= 2 && Number.isFinite(ratio)) {
    const aux = await loadAux(auxSymbols([t]), now);
    aux[t] = sb; // rejimde kendi sembolü olan profiller (QQQ) için
    const bull = alignFor(p, aux, 'bull'), bear = alignFor(p, aux, 'bear');
    const prim = p.regime[0], pb = prim ? aux[prim.sym] : undefined;
    if (prim && pb && pb.length) {
      const v = vwap(pb), last = pb[pb.length - 1].c;
      const side = v == null ? 0 : Math.sign(last - v) * prim.sign;
      regimeSideNow = side > 0 ? 1 : side < 0 ? -1 : null;
    }
    const ctx: SetupCtx = { ticker: t, now, etMin, dte, bars: sb, S: price, em, emRemain, vwap: vw, orHi: or.high, orLo: or.low,
      volRatio: ratio, align: { bull: bull.all, bear: bear.all }, allowed: allowedFor(t, qEnabled), newsImpulse: null,
      walls: { call: snap.callWall, put: snap.putWall, gexNeg: (snap.netGex ?? 0) < 0 }, ivRank: null, rv10: null, atmIv: snap.atmIv ?? null,
      qd, orWin: { m5: openRange(sb, 5), m30: openRange(sb, 30) } };
    const quotes: Quote[] = [...data.chain.calls, ...data.chain.puts].map(q => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, iv: q.iv, volume: q.volume, oi: q.oi }));
    for (const c of runSetups(ctx)) {
      const type = c.dir === 'bull' ? 'call' : 'put';
      const pick = scanStrikes({ type, S: price, d: otmDistance(ak.k, em), quotes, T0, und: c.und, emRemain, sessionLeftMin: leftMin,
        minVol: p.minVol, minOi: p.minOi, maxSpreadPct: p.maxSpreadPct });
      if (pick) {
        const q = quotes.find(x => x.type === type && x.strike === pick.strike);
        if (q) {
          const al = c.dir === 'bull' ? bull : bear, other = c.dir === 'bull' ? bear : bull;
          const oi: OppInput = {
            ticker: t, setup: c.setup, dir: c.dir, pick, spot: price, und: c.und, reasons: c.reason,
            em, emRemain, expiry: data.pick, dte, etMin, leftMin, marketOpen: leftMin > 0, now,
            delayedMin: data.L.quote.delayedMin, barAgeSec, chainAgeSec,
            regime: { vwapAll: al.vwapAll, orAll: al.orAll, opposite: other.vwapAll },
            sector: { present: p.sector.length > 0, vwapOk: al.sectorAll },
            frames: c.dir === 'bull' ? bullN : bearN, volRatio: ratio,
            radar: radarFor(t, c.dir, now),
            maxSpreadPct: p.maxSpreadPct, spreadPct: q.ask > 0 ? ((q.ask - q.bid) / q.ask) * 100 : 100,
            liquid: q.volume >= p.minVol || q.oi >= p.minOi,
            account: { mode: acct.mode, capital: acct.capital, kademe: acct.kademe, commission: acct.commission, fractional: acct.fractional },
            ttlMin: approvalTtlMs(dte, acct.ttlMin ?? undefined) / 60000,
            quote: { bid: q.bid, ask: q.ask, iv: q.iv },
            qual: isQ(c.setup) && qd ? { score: c.dir === 'bull' ? qd.qualityUp : qd.qualityDown,
              note: qNote(c.setup, c.dir, qd, Q_DEFAULT_PARAMS.orMin, ratio) } : null,
          };
          const opp = buildOpp(oi);
          if (acct.hasPosition) { opp.eligible = false; opp.reason = 'açık pozisyon var'; }
          cands.push(opp);
          setups.push(opp.eligible
            ? `${c.setup} ${type} · strike ${pick.strike} · RR 1:${pick.rr.rr.toFixed(1)} · skor ${opp.score} · uygun`
            : `${c.setup} ${type} · strike ${pick.strike} · RR 1:${pick.rr.rr.toFixed(1)} · skor ${opp.score} · ${opp.reason}`);
          continue;
        }
      }
      setups.push(pick
        ? `${c.setup} ${type} · strike ${pick.strike} · RR 1:${pick.rr.rr.toFixed(1)} · dayanak ${c.und.stop.toFixed(2)} → ${c.und.target.toFixed(2)}`
        : `${c.setup} ${type}: uygun strike/RR yok`);
    }
  }
  // Sonuç kartı: vade (0–3 DTE kuralı), uzaklık k × EM, prim, 1:5 / 1:4 seviyeleri (kağıt üstü)
  const vOpts = data.L.expirations.map((e, i) => ({ date: e, dte: data.dtes[i] })).filter(o => o.dte >= 0 && o.dte <= 3);
  const vPick = pickExpiry(vOpts, now);
  let vQuotes: QuoteLite[] | null = null;
  if (vPick) {
    try {
      const vch = vPick.date === data.pick ? data.chain : trimChain(await loadChain(data.L.provider, t, vPick.date, {}, 40), price);
      vQuotes = [...vch.calls, ...vch.puts].map(q => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, volume: q.volume, oi: q.oi }));
    } catch { vQuotes = null; }
  }
  const uns = unusual(data.chain);
  const verdict: VerdictCard = buildVerdict({
    inputs: { S: price, vwap: vw, orHigh: or ? or.high : null, orLow: or ? or.low : null, flip: snap.flip ?? null,
      callWall: snap.callWall ?? null, putWall: snap.putWall ?? null, emMove: Number.isFinite(em) ? em : null, pcVol: snap.pcVol ?? null,
      unusualCall: uns.filter(u => u.type === 'call').reduce((a, u) => a + u.vol, 0), unusualPut: uns.filter(u => u.type === 'put').reduce((a, u) => a + u.vol, 0),
      momentum: bullN >= 2 ? 1 : bearN >= 2 ? -1 : 0, regime: regimeNow },
    expiries: vOpts, nowMs: now, quotesFor: e => (vPick && e === vPick.date ? vQuotes : null),
    dOf: () => (Number.isFinite(em) ? otmDistance(ak.k, em) : null), kademe: acct.kademe, capital: acct.capital });
  const status: TickerStatus = {
    at: now, spot: price, changePct, expiry: data.pick, dte, emPct: snap.emPct ?? NaN, expectedMove: snap.expectedMove ?? NaN,
    k: ak.k, kSource: ak.source, kNote: ak.note, vwapSide: vw == null ? '—' : price >= vw ? 'üstünde' : 'altında',
    frames: `yükseliş ${bullN}/3 · düşüş ${bearN}/3`, volRatio: Number.isFinite(ratio) ? +ratio.toFixed(2) : null,
    source: srcLabel, delayedMin: dMin, warn: dteWarning(t, data.dtes), setups, verdict,
  };
  const quotes: Quote[] = [...data.chain.calls, ...data.chain.puts].map(q => ({ type: q.type, strike: q.strike, bid: q.bid, ask: q.ask, iv: q.iv, volume: q.volume, oi: q.oi }));
  return { ticker: t, status, cands, quotes, S: price, ivAtm: snap.atmIv ?? null, sb, leftMin, etMin, emRemain: Number.isFinite(emRemain) ? emRemain : 0,
    ratio, regimeSideNow, regimeKind: regimeNow?.kind ?? null, chainAgeSec, barAgeSec, delayedMin: dMin, source: srcLabel };
}

const acctOf = (a: PaperAccount, ttlMin: number | null): Acct => ({
  mode: a.mode, capital: a.capital, kademe: a.kademe, commission: a.settings.commission, fractional: a.settings.fractional,
  hasPosition: !!a.position, ttlMin,
});
const ensurePaper = (now: number): PaperAccount => firsat.get().paper ?? initAccount(START_CAPITAL, {}, etDate(now));

/** Pozisyon tetikleri: yalnız T6 (teta/zaman). T1–T3 yerine uyarlanabilir çıkış (adaptive.ts) kullanılır. */
function flagsFor(sc: Scan, pos: OpenPosition): Partial<Record<TriggerId, boolean>> {
  return {
    T6: pos.und ? t6Theta(pos.dte, sc.leftMin, Math.abs(pos.und.target - sc.S), sc.emRemain) : false,
  };
}

/** Uyarlanabilir çıkış girdisi: girişten beri 1 dk barlar + onaylı rejim (QQQ/SPY yerine kendi tickerı; kart ile aynı). */
function adaptiveFor(sc: Scan, pos: OpenPosition, now: number): AdaptiveDecision {
  return adaptiveDecision({ dirSign: pos.dir === 'call' ? 1 : -1, entryT: pos.openedAt, nowMs: now, bars: sc.sb, regime: sc.regimeKind });
}

/** Onay girdisi: kartın dayanak seviyeleri ve süresi. */
const sigOf = (c: Card): ApprovalSignal => ({
  createdAt: c.createdAt, dte: c.dte, dirSign: c.dir === 'bull' ? 1 : -1, spot0: c.spot0,
  entryUnd: c.und.entry, stopUnd: c.und.stop, targetUnd: c.und.target, ask0: c.ask,
  mode: c.mode ?? 'AGRESIF', windowEndMin: c.dte === 0 ? 14 * 60 + 30 : 16 * 60,
});

function logPut(entry: SignalLog) {
  const log = firsat.get().log.filter(x => x.id !== entry.id);
  firsat.setLog(appendLog(log, entry));
}
function logOf(c: Card, decision?: SignalLog['decision']): SignalLog {
  return {
    id: c.id, t: c.createdAt, ticker: c.ticker, setup: c.setup, dir: c.dir, score: c.score, label: c.label,
    components: Object.fromEntries(c.components.map(x => [x.key, x.pts])), vetoes: c.vetoes,
    source: firsat.get().status[c.ticker]?.source ?? '', dataAgeSec: c.barAgeSec, decision,
  };
}

/** Kart yaşam döngüsü: bekleyen kartların süresi/geçersizliği, yeni uygun adaylar (soğuma ve günlük kapı). */
function refreshCards(scans: Scan[], now: number, ttlMin: number | null, accMode: PaperAccount['mode']) {
  const cards = firsat.get().cards.map(c => ({ ...c }));
  let sent: Sent[] = firsat.get().sent;
  const byT = new Map(scans.map(s => [s.ticker, s]));
  const floorRR = minRrFor(accMode);
  const floorScore = accMode === 'GUVENLI_ZARAR' ? MODE_RULES.GUVENLI_ZARAR.minScore
    : accMode === 'GUVENLI_KAR' ? MODE_RULES.GUVENLI_KAR.minScore : MODE_RULES.AGRESIF.minScore;
  for (const c of cards) {
    if (c.state !== 'bekliyor') continue;
    const sc = byT.get(c.ticker);
    if (!sc) continue;
    const fresh = sc.cands.find(x => x.key === c.key);
    // Geçersizlik tabanı hesap modunun tabanı (Agresif'te 1:4 hâlâ geçerli; kart etiketi AGRESIF diye 1:5'e kilitleme).
    const reason = expiryReason(sigOf(c), { now, spot: sc.S, etMin: sc.etMin, marketOpen: sc.leftMin > 0,
      fresh: fresh ? { score: fresh.score, rr: fresh.rr, minScore: floorScore, minRR: floorRR } : null }, c.ttlMs);
    if (reason) {
      c.state = 'suresi-doldu'; c.note = reason; c.decidedAt = now;
      logPut(logOf(c, 'süresi doldu'));
    } else if (fresh) {
      c.freshAsk = fresh.ask; c.freshRr = fresh.rr; c.freshScore = fresh.score; c.freshAt = now;
    }
  }
  for (const sc of scans) for (const cand of sc.cands) {
    if (cards.some(c => c.key === cand.key && c.state === 'bekliyor')) continue;
    if (!cand.eligible) {
      // Q adayı: kâğıda uygun değil → yalnız kart (Onayla yok); bildirim ve günlük kaydı yok; aynı ticker+setup için 30 dk soğuma
      if (!isQ(cand.setup) || cards.some(c => c.ticker === cand.ticker && c.setup === cand.setup && now - c.createdAt < COOL_MS)) continue;
      cards.push({ ...cand, id: `${cand.key}|${now}`, state: 'bekliyor', ask: cand.ask, ttlMs: approvalTtlMs(cand.dte, ttlMin ?? undefined),
        freshAsk: cand.ask, freshRr: cand.rr, freshScore: cand.score, freshAt: now });
      continue;
    }
    const day = etDate(now);
    const g = gateCheck(sent, `${cand.ticker}|${cand.setup}`, now, day);
    if (!g.ok) continue;
    sent = gateRecord(sent, `${cand.ticker}|${cand.setup}`, now, day);
    const card: Card = { ...cand, id: `${cand.key}|${now}`, state: 'bekliyor', ask: cand.ask, ttlMs: approvalTtlMs(cand.dte, ttlMin ?? undefined),
      freshAsk: cand.ask, freshRr: cand.rr, freshScore: cand.score, freshAt: now };
    cards.push(card);
    logPut(logOf(card));
    notifyFirsat(`Fırsat · ${card.text.title}`, `${card.text.body} (${card.ttlMs / 60000} dk)`, card.id).catch(() => {});
  }
  firsat.setCards(cards);
  firsat.setSent(sent);
}

/** Gece takvim kapısı (D12): bilanço (ETF değil; anahtar yoksa bilinmiyor) + FOMC/CPI/NFP. Gün başına bir kez sorgulanır. */
const calCache = new Map<string, CalendarCheck>();
async function nightCalendar(ticker: string, day: string): Promise<CalendarCheck> {
  const key = `${ticker}|${day}`;
  const hit = calCache.get(key);
  if (hit) return hit;
  const next = nextTradingDay(day), fkey = radar.get().settings.finnhubKey;
  let earn: EarningsInfo;
  if (isEtf(ticker)) earn = { kind: 'etf' };
  else if (!fkey) earn = { kind: 'bilinmiyor' };
  else {
    try {
      const d = await fetchFinnhubEarnings(ticker, fkey, day, next);
      earn = d ? { kind: 'var', date: d } : { kind: 'yok' };
    } catch { earn = { kind: 'bilinmiyor' }; }
  }
  const r = calendarCheck(day, next, earn);
  calCache.set(key, r);
  return r;
}

/** Açık pozisyonu tick'ler: risk, gece, gap. Sonuçları kaydeder ve bildirir. */
function tickPaper(paper: PaperAccount, scans: Scan[], now: number, calendar: CalendarCheck | null): PaperAccount {
  const pos = paper.position;
  if (!pos) { firsat.setPosLive(null); return paper; }
  const sc = scans.find(s => s.ticker === pos.ticker);
  if (!sc) return paper;
  const q = sc.quotes.find(x => x.type === pos.dir && x.strike === pos.strike);
  const flags = flagsFor(sc, pos);
  const adaptive = adaptiveFor(sc, pos, now);
  const r = tickPosition(paper, {
    day: etDate(now), now, etMin: sc.etMin, bid: q ? q.bid : null, flags, adaptive, S: sc.S, ivAtm: sc.ivAtm ?? NaN,
    openUnd: sc.sb.length ? sc.sb[0].o : undefined, openBid: q?.bid,
    qExit: qExitTriggers(pos, sc.sb, { lod: firsat.get().settings.q.exitLod, ema: firsat.get().settings.q.exitEma }),
    calendar: calendar ?? { ok: false, reasons: ['takvim sorgulanmadı'] }, strongTriggerLast30: adaptive.rev > adaptive.cont, regimeAligned: !adaptive.regimeAgainst,
  });
  for (const e of r.events) {
    notifyFirsat(`Fırsat · ${pos.ticker} kâğıt`, e.text, `${pos.id}|${e.kind}|${now}`).catch(() => {});
    if (e.kind === 'close' && e.trade) {
      const log = firsat.get().log;
      firsat.setLog(log.map(l => l.id === pos.id ? { ...l, result: outcomeOf(e.trade!.reason), r: e.trade!.rMultiple } : l));
    }
  }
  const np = r.acc.position;
  const live: PosLive | null = np && q
    ? { bid: q.bid, rMult: profitR(np, q.bid), at: now, triggers: Object.entries(flags).filter(([, v]) => v).map(([k]) => k), stop: np.stopPrem,
      adaptive: adaptive.verdict === 'YOK' ? null : adaptive.reason }
    : null;
  firsat.setPosLive(live);
  return r.acc;
}

/** Bir tur: ayardaki tüm sinyal tickerları (+ açık pozisyonun tickerı). Aynı anda ikinci tur başlamaz. Döner: başarılı ticker sayısı. */
export async function runSignalScan(): Promise<number> {
  if (running) return 0;
  running = true;
  let ok = 0;
  try {
    await firsat.load();
    const now = Date.now();
    let paper = startDay(ensurePaper(now), etDate(now));
    firsat.setPaper(paper);
    const ttl = firsat.get().settings.ttlMin;
    const tickers = [...firsat.get().settings.tickers];
    if (paper.position && !tickers.includes(paper.position.ticker)) tickers.push(paper.position.ticker);
    const scans: Scan[] = [];
    for (const t of tickers) {
      try {
        const sc = await scanOne(t, now, acctOf(paper, ttl));
        scans.push(sc); firsat.setStatus(t, sc.status); ok++;
      } catch (e) {
        const prev = firsat.get().status[t];
        const msg = e instanceof Error ? e.message : 'veri alınamadı';
        firsat.setStatus(t, { ...(prev ?? emptyStatus(now)), at: now, error: msg, setups: prev?.setups ?? [] });
      }
    }
    // Gece kararı yalnız 15:45 ET'de verilir; takvim o andan önce sorgulanmaz (ağ çağrısı tasarrufu).
    const pos = paper.position;
    const calendar = pos && pos.dte >= 1 && etMinutes(now) >= 945 ? await nightCalendar(pos.ticker, etDate(now)) : null;
    paper = tickPaper(paper, scans, now, calendar);
    refreshCards(scans, now, ttl, paper.mode);
    firsat.setPaper(paper);
    firsat.setLastScan(now);
  } finally { running = false; }
  return ok;
}

/** "Onayla": kart süresi ve fiyat kontrolü (zincir taze çekilir), yeniden fiyatlama, kâğıt pozisyon açılır. Dönüş: Türkçe sonuç. */
export async function approveCard(id: string): Promise<string> {
  const card = firsat.get().cards.find(c => c.id === id);
  if (!card || card.state !== 'bekliyor') return 'Bu kartın kararı verilmiş.';
  if (!card.eligible) return `Bu fırsat kâğıda uygun değil (${card.reason}).`;
  const now = Date.now();
  let paper = firsat.get().paper;
  if (!paper) return 'Hesap yok.';
  const ttl = firsat.get().settings.ttlMin;
  let fresh: Opp | undefined, spot = NaN, etMin = etMinutes(now), leftMin = sessionLeftMin(now), scanOk = false;
  try {
    const sc = await scanOne(card.ticker, now, acctOf(paper, ttl));
    fresh = sc.cands.find(x => x.key === card.key);
    spot = sc.S; etMin = sc.etMin; leftMin = sc.leftMin; scanOk = true;
    firsat.setStatus(card.ticker, sc.status);
  } catch { /* taze veri yok: piyasa saatini yerelde hesapla, taramasız geçersizleşme uygulama */ }
  const floorRR = minRrFor(paper.mode);
  const floorScore = paper.mode === 'GUVENLI_ZARAR' ? MODE_RULES.GUVENLI_ZARAR.minScore
    : paper.mode === 'GUVENLI_KAR' ? MODE_RULES.GUVENLI_KAR.minScore : MODE_RULES.AGRESIF.minScore;
  // Tarama başarısızsa son bilinen skor/RR ile süre kuralları çalışır; "geçersizleşti" sayılmaz.
  const freshForExpiry = fresh
    ? { score: fresh.score, rr: fresh.rr, minScore: floorScore, minRR: floorRR }
    : (!scanOk ? { score: card.freshScore ?? card.score, rr: card.freshRr ?? card.rr, minScore: floorScore, minRR: floorRR } : null);
  const expired = expiryReason(sigOf(card), { now, spot: Number.isFinite(spot) ? spot : card.spot0, etMin, marketOpen: leftMin > 0,
    fresh: freshForExpiry }, card.ttlMs);
  const rep = fresh ? repriceOnApprove({ ask0: card.ask }, { ask: fresh.ask, rr: fresh.rr, minRR: floorRR }, paper.settings.slippage) : null;
  if (!scanOk && !expired) {
    return 'Başkan, taze fiyat alınamadı, tekrar dener misin? Kart duruyor.';
  }
  const res = resolveApproval('bekliyor', 'onayla', expired, rep);
  let state = res.state;
  let note = res.reason ?? '';
  if (state === 'onaylandi' && rep && rep.ok && fresh) {
    const mode = card.mode ?? 'AGRESIF';
    const o: Result = openPosition(paper, {
      id: card.id, ticker: card.ticker, setup: card.setup, dir: card.type, expiry: card.expiry, dte: card.dte, strike: card.strike,
      fill: rep.fill, stopPrem: card.stopPrem * (rep.fill / card.fill), targetPrem: fresh.primTarget, targetR: modeTargetR(mode, fresh.rr),
      mode, now, day: etDate(now), und: card.und,
    });
    if (o.ok) { paper = o.acc; firsat.setPaper(paper); }
    else { state = 'reddedildi'; note = o.reason; }
  } else if (state === 'fiyat-kacti') {
    note = rep && !rep.ok ? rep.detail : note;
  }
  const label = decisionLabel(state);
  const cards = firsat.get().cards.map(c => c.id === id ? { ...c, state, note, decidedAt: now } : c);
  firsat.setCards(cards);
  const updated = cards.find(c => c.id === id);
  if (updated) logPut(logOf(updated, label === 'bekliyor' ? undefined : label));
  if (state === 'onaylandi') return `Başkan, ${card.ticker} kâğıt pozisyonu açıldı (${rep && rep.ok ? rep.fill.toFixed(2).replace('.', ',') : ''} $).`;
  if (state === 'fiyat-kacti') return `Başkan, fiyat kaçtı, girmedim (${note}).`;
  return `Başkan, ${card.ticker} fırsatının süresi doldu veya girilemedi (${note || state}).`;
}

/** "Geç": kâğıt hesabı ve sayaçları etkilemez; kalibrasyona reddedildi olarak girer (§7.7). */
export function passCard(id: string): void {
  const now = Date.now();
  const cards = firsat.get().cards.map(c => c.id === id && c.state === 'bekliyor' ? { ...c, state: 'reddedildi' as const, decidedAt: now } : c);
  firsat.setCards(cards);
  const c = cards.find(x => x.id === id);
  if (c && c.state === 'reddedildi') logPut(logOf(c, 'reddedildi'));
}

/** Yeni hesap (eski hesap arşivlenir). */
export function resetAccount(startCapital: number): void {
  const old = firsat.get().paper;
  if (old) firsat.archive({ at: Date.now(), account: old });
  firsat.setPaper(initAccount(startCapital, old ? { ...old.settings, startCapital } : { startCapital }, etDate(Date.now())));
  firsat.setCards(firsat.get().cards.map(c => c.state === 'bekliyor' ? { ...c, state: 'suresi-doldu' as const, note: 'hesap sıfırlandı' } : c));
  firsat.setPosLive(null);
}

/** Hesap ayarlarını günceller (komisyon, kayma, kesirli, DURDU). Sermaye yalnızca sıfırlamada değişir. */
export function updatePaperSettings(p: Partial<PaperAccount['settings']>): void {
  const paper = firsat.get().paper ?? initAccount(START_CAPITAL, {}, etDate(Date.now()));
  firsat.setPaper({ ...paper, settings: { ...paper.settings, ...p } });
}
