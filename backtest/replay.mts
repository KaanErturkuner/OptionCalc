/*
 * Bugünü (ya da BT_DATE) dakika dakika tekrar oynat — MarketData'ya istek ATMAZ.
 *   BT_STEP=1 node backtest/replay.mts [MU,QQQ,INTC,AAOI,AXTI,AMD,NBIS]
 * Barlar: Yahoo 1 dk (bugün). Zincir: önceki günün (P) önbellekteki EOD zinciri (prep.mts ile aynı: IV + yarım spread + OI),
 * kayıtlı anlık görüntü (snaps/<D>) varsa gerçek kot (hybrid), yoksa modellenmiş fiyat.
 * Çıktı: her stratejinin tetiklenecek sinyalleri + sonuç; kapanış görünümü (seviyeler, yarın için kurulum).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseYahooChart } from '../src/lib/market/bars.ts';
import { closeMs, etDate, YEAR_MS } from '../src/lib/usmarket.ts';
import * as BS from '../src/lib/bs.ts';
import * as An from '../src/lib/odte/analytics.ts';
import * as STR from '../src/lib/odte/strategies/index.ts';
import { vwapAt, openRange } from '../src/lib/odte/strategies/util.ts';
import { SECTOR } from '../src/lib/odte/strategies/kaanMomentum.ts';
import { precompute, snapshot, tauYears, type Day } from './bt.mts';
import { runStrategy, type ETrade } from './engine.mts';
import { makeSource, loadSnaps } from './sources.mts';
import { CACHE } from './md.mts';
import type { Bar } from '../src/lib/odte/analytics.ts';

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`Kullanım: BT_STEP=1 node backtest/replay.mts [MU,QQQ,INTC,...]
Bugünü dakika dakika tekrar oynatır. MarketData'ya istek atmaz; bugünkü 1 dk barlar için Yahoo'ya internet gerekir.
Ortam: BT_DATE (YYYY-MM-DD, varsayılan bugün), BT_PREV (önceki işlem günü, varsayılan otomatik).`);
  process.exit(0);
}
const R = 0.04, tickers = (process.argv[2] || 'MU,QQQ,INTC,AAOI,AXTI,AMD,NBIS').split(','), PEERS = ['QQQ', 'SPY', 'SMH', 'IGV'];
const now = Date.now(), D = process.env.BT_DATE || etDate(now), open = closeMs(D) - 6.5 * 3600000;
const et = (t: number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit' });
const ist = (t: number) => new Date(t).toLocaleTimeString('en-GB', { timeZone: 'Europe/Istanbul', hour: '2-digit', minute: '2-digit' });
const f2 = (x: number | null | undefined, d = 2) => x == null || !isFinite(x) ? '—' : x.toFixed(d);
async function yahoo(sym: string) {
  let j: any;
  try {
    const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${sym}?interval=1m&range=1d&includePrePost=false`, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    j = await r.json();
  } catch {
    console.error(`Yahoo'ya ulaşılamadı (${sym}): internet yok ya da erişim engelli. Bu komut bugünkü dakika barları için ağ ister; MarketData kullanmaz.`);
    process.exit(1);
  } const bars = parseYahooChart(j).filter(b => b.t >= open && b.t + 60000 <= Math.min(now, closeMs(D)));
  return { bars, prev: j?.chart?.result?.[0]?.meta?.chartPreviousClose as number };
}
/** Önbellekte P günü EOD zinciri (prep.mts'in istek yolu: date=P&from=P…) */
let index: Map<string, string> | null = null;
function cachedChain(t: string, P: string): any | null {
  if (!index) { index = new Map(); for (const f of fs.readdirSync(CACHE)) { if (!f.endsWith('.json')) continue; const s = fs.readFileSync(path.join(CACHE, f), 'utf8'); const m = /"p":"(\/options\/chain\/[^"]+)"/.exec(s.slice(0, 300)); if (m) index.set(m[1], f); } }
  const key = [...index.keys()].find(k => k.startsWith(`/options/chain/${t}/?date=${P}&from=${P}&`)); if (!key) return null;
  const j = JSON.parse(fs.readFileSync(path.join(CACHE, index.get(key)!), 'utf8')).json; return j?.s === 'ok' ? j : null;
}
function buildDay(t: string, P: string, cP: any, SP: number, bars: Bar[], E: string): Day | null {
  const TP = (closeMs(E) - closeMs(P)) / YEAR_MS; let rows: any[] = [];
  cP.optionSymbol.forEach((_: string, k: number) => {
    if (etDate(cP.expiration[k] * 1000) !== E) return;
    const type = cP.side[k] === 'put' ? 'put' : 'call', K = cP.strike[k], bid = cP.bid[k] ?? 0, ask = cP.ask[k] ?? 0, m = bid > 0 && ask >= bid ? (bid + ask) / 2 : 0;
    let iv = NaN, half = NaN; if (m > 0) { iv = BS.impliedVol(type as any, m, SP, K, TP, R, 0) * Math.sqrt(TP / tauYears(closeMs(P), E)); half = Math.max(0.005, (ask - bid) / 2); }
    rows.push({ type, K, oi: cP.openInterest[k] ?? 0, iv: isFinite(iv) && iv > 0.02 && iv < 8 ? +iv.toFixed(4) : null, half: isFinite(half) ? +half.toFixed(3) : null, vol: cP.volume[k] ?? 0 });
  });
  const keep = new Set([...new Set(rows.map(r => r.K))].sort((a, b) => Math.abs(a - SP) - Math.abs(b - SP)).slice(0, 30));
  rows = rows.filter(r => keep.has(r.K)).sort((a, b) => a.K - b.K);
  for (const r of rows) if (r.iv == null || r.half == null) { const nb = rows.filter(x => x.type === r.type && x.iv != null && x.half != null).sort((a, b) => Math.abs(a.K - r.K) - Math.abs(b.K - r.K))[0]; if (nb) { r.iv ??= nb.iv; r.half ??= nb.half; } }
  rows = rows.filter(r => r.iv != null); if (rows.length < 6) return null;
  return { ticker: t, D, P, E, dte: Math.round((Date.parse(E) - Date.parse(D)) / 864e5), SP, SD: NaN, TD: (closeMs(E) - closeMs(D)) / YEAR_MS, bars, rows, open, close: closeMs(D), pts: [] } as Day;
}
const P = process.env.BT_PREV || (() => { let x = new Date(Date.parse(D) - 864e5); while ([0, 6].includes(x.getUTCDay())) x = new Date(+x - 864e5); return x.toISOString().slice(0, 10); })();
const Y: Record<string, { bars: Bar[]; prev: number }> = {};
for (const s of [...new Set([...tickers, ...PEERS])]) Y[s] = await yahoo(s);
const lastT = Math.max(...tickers.map(t => Y[t].bars.at(-1)?.t ?? 0));
const peers = (sym: string) => Y[sym]?.bars ?? null;
const STRATS = ['confluence-v2', 'kaan-momentum-0dte', 'kaan-momentum-1to3dte', 'kaan-momentum-gevsek-0dte', 'kaan-momentum-gevsek-1to3dte'].map(id => STR.strategyById(id)!);
const src = makeSource('hybrid'), out: string[] = [], view: string[] = [];
const sd = (b: Bar[]) => { const S = b.at(-1)!.c, v = vwapAt(b)!, or = openRange(b, 15)!; return { S, v, or, ret: S / b[0].o - 1, vw: S > v ? 'üstü' : 'altı', orb: S > or.high ? 'OR yukarı kırık' : S < or.low ? 'OR aşağı kırık' : 'OR içi' }; };
out.push(`# Gün tekrarı ${D} (önceki EOD zinciri ${P}) — son bar ${et(lastT)} ET / ${ist(lastT)} İstanbul\n`);
out.push('Endeks/sektör: ' + PEERS.map(s => { const x = sd(Y[s].bars); return `${s} ${f2(x.S)} (önceki kapanışa ${f2((x.S / Y[s].prev - 1) * 100)}%, açılıştan ${f2(x.ret * 100)}%, VWAP ${x.vw}, ${x.orb})`; }).join(' · ') + '\n');
out.push('| Strateji | Sembol | Giriş ET (İst) | Yön | Kontrat | Giriş $ | Çıkış ET | Neden | Çıkış $ | K/Z % | Fiyat kaynağı |\n|---|---|---|---|---|---:|---|---|---:|---:|---|');
const counts: Record<string, number> = {}, pnl: Record<string, number> = {}, pcts: Record<string, number[]> = {};
for (const t of tickers) {
  const yb = Y[t]; if (!yb.bars.length) { view.push(`- ${t}: Yahoo barı yok`); continue; }
  const cP = cachedChain(t, P); if (!cP) { view.push(`- ${t}: ${P} EOD zinciri önbellekte yok`); continue; }
  const exps = [...new Set<string>(cP.expiration.map((e: number) => etDate(e * 1000)))].filter(e => e >= D).sort();
  const dte = (e: string) => Math.round((Date.parse(e) - Date.parse(D)) / 864e5);
  const E0 = exps[0], E13 = exps.find(e => dte(e) >= 1 && dte(e) <= 3);
  const days: Record<string, Day | null> = {};
  for (const E of new Set([E0, E13].filter(Boolean) as string[])) { const d = buildDay(t, P, cP, yb.prev, yb.bars, E); if (d) precompute(d); days[E] = d; }
  for (const s of STRATS) {
    const p: any = s.defaults, E = p.dteMin >= 1 ? E13 : E0, d = E ? days[E] : null; if (!d) continue;
    const tr: ETrade[] = runStrategy([d], s, p, { source: src, peers: (sym) => peers(sym) });
    for (const x of tr) {
      counts[s.id] = (counts[s.id] ?? 0) + 1; pnl[s.id] = (pnl[s.id] ?? 0) + x.pnl; (pcts[s.id] ??= []).push(x.pct); const tin = d.open + x.m * 60000, live = x.exitT >= lastT;
      out.push(`| ${s.id} | ${t} | ${et(tin)} (${ist(tin)}) | ${x.dir} | ${x.K}${x.dir === 'call' ? 'C' : 'P'} ${d.E} | ${f2(x.entry)} | ${et(x.exitT)} | ${live ? 'AÇIK (son bara göre)' : x.why} | ${f2(x.exit)} | ${f2(x.pct * 100, 1)} | ${x.src} |`);
    }
  }
  // kapanış görünümü
  const b = yb.bars, x = sd(b), mo = An.momentum(b);
  const Etom = exps.find(e => e > D) ?? E0, inE = (k: number) => etDate(cP.expiration[k] * 1000) === Etom;
  const idx = cP.optionSymbol.map((_: string, k: number) => k).filter(inE);
  const strikes = [...new Set<number>(idx.map((k: number) => cP.strike[k]))].sort((a, c) => a - c);
  const near = (k: number) => { const n = strikes.length ? strikes.reduce((a, c) => Math.abs(c - k) < Math.abs(a - k) ? c : a) : k;
    const stp = strikes.length > 1 ? Math.min(...strikes.slice(1).map((x, i) => +(x - strikes[i]).toFixed(2)).filter(x => x > 0)) : 1;
    return Math.abs(n - k) > stp ? `~${f2(k, 1)} (önbellek zinciri ${n}'de bitiyor)` : String(n); };
  const oiAt = (side: string, cond: (K: number) => boolean) => { let best: number | null = null, bo = -1; for (const k of idx) if (cP.side[k] === side && cond(cP.strike[k]) && (cP.openInterest[k] ?? 0) > bo) { bo = cP.openInterest[k] ?? 0; best = cP.strike[k]; } return best == null ? '—' : `${best} (OI ${bo})`; };
  const w = { callWall: oiAt('call', K => K > x.S), putWall: oiAt('put', K => K < x.S) };
  const dTom = buildDay(t, P, cP, yb.prev, b, Etom);
  const atm = dTom ? dTom.rows.filter((r: any) => r.type === 'call').sort((a: any, c: any) => Math.abs(a.K - x.S) - Math.abs(c.K - x.S))[0] : null;
  const emD = atm ? x.S * atm.iv * Math.sqrt(1 / 252) : NaN;
  const isEtf = t === 'QQQ', otm = (isEtf ? 0.45 : 1.8) * emD;
  const sec = SECTOR[t], hiD = Math.max(...b.map(z => z.h)), loD = Math.min(...b.map(z => z.l));
  const bias = x.S > x.v && (mo?.ema9 ?? 0) > (mo?.ema21 ?? 0) ? 'yukarı' : x.S < x.v && (mo?.ema9 ?? 0) < (mo?.ema21 ?? 0) ? 'aşağı' : 'nötr';
  const secTxt = sec ? `${sec} göreli ${f2((sd(Y[sec].bars).ret - sd(Y.QQQ.bars).ret) * 100)}%` + (t === 'NBIS' ? `, IGV göreli ${f2((sd(Y.IGV.bars).ret - sd(Y.QQQ.bars).ret) * 100)}%` : '') : 'endeks';
  view.push(`- **${t}** ${f2(x.S)} (önceki kapanış ${f2(yb.prev)} → ${f2((x.S / yb.prev - 1) * 100)}%; açılıştan ${f2(x.ret * 100)}%) · VWAP ${f2(x.v)} ${x.vw} · eğilim ${bias} (EMA9 ${f2(mo?.ema9)} / EMA21 ${f2(mo?.ema21)}) · gün aralığı ${f2(loD)}–${f2(hiD)} · OR15 ${f2(x.or.low)}–${f2(x.or.high)}` +
    ` · OI duvarları (vade ${Etom}, ${P} OI; fiyat üstü/altı en büyük) call ${w.callWall} / put ${w.putWall} · günlük beklenen hareket ≈ ${f2(emD)} (ATM IV ${f2((atm?.iv ?? NaN) * 100, 0)}%) · ${secTxt}` +
    `\n  - Yarın kurulum (kağıt): **CALL** ancak ${f2(hiD)} üstü kırılım + VWAP üstü + QQQ/SPY${sec ? '/' + sec : ''} aynı yönde + hacim ≥1,5× → strike ≈ ${near(hiD + otm)}C ${Etom} (tetik+${f2(otm)});` +
    ` **PUT** ancak ${f2(loD)} altı kırılım + VWAP altı + endeksler ayı → strike ≈ ${near(loD - otm)}P ${Etom} (tetik−${f2(otm)}). 1–3 DTE adayları: ${exps.filter(e => e > D && dte(e) <= 4).join(', ') || '—'} (yarından itibaren 0–3 DTE).`);
}
out.push('\nÖzet (1 kontrat, komisyon dahil): ' + STRATS.map(s => `${s.id} ${counts[s.id] ?? 0} işlem` + (counts[s.id] ? `, toplam ${f2(pnl[s.id], 0)} $, ort. ${f2(pcts[s.id].reduce((a, b) => a + b, 0) / pcts[s.id].length * 100, 1)}%` : '')).join(' · '));
out.push('\n## Kapanış görünümü (son bara göre)\n' + view.join('\n'));
out.push('\n> KAĞIT İŞLEM. Tüm stratejiler 12 aylık backtestte RED. Fiyat kaynağı "real" = kayıtlı MarketData görüntüsü; "modeled" = önceki gün EOD IV ile BS (ucuz OTM\'de hata büyük).');
// model ↔ gerçek kayıt karşılaştırması (bugünkü anlık görüntüler)
const chk: string[] = [];
for (const t of tickers) {
  const snaps = loadSnaps(t, D); if (!snaps.length) continue; const cP = cachedChain(t, P); if (!cP) continue;
  const dd = buildDay(t, P, cP, Y[t].prev, Y[t].bars, snaps[0].E); if (!dd) continue; const ratios: number[] = [];
  for (const sn of snaps) { const mc = snapshot(dd, sn.S, sn.t); for (const r of sn.rows) { const mid = (r[2] + r[3]) / 2; if (!(mid > 0.1) || Math.abs(r[1] / sn.S - 1) > 0.08) continue;
    const q = (r[0] ? mc.puts : mc.calls).find(o => o.strike === r[1]); if (q) ratios.push(((q.bid + q.ask) / 2) / mid - 1); } }
  ratios.sort((a, b) => a - b); const med = ratios[Math.floor(ratios.length / 2)], mad = [...ratios].map(Math.abs).sort((a, b) => a - b)[Math.floor(ratios.length / 2)];
  chk.push(`${t} (${snaps.length} görüntü, n ${ratios.length}): model/gerçek orta fiyat sapması medyan ${f2(med * 100, 1)}%, medyan mutlak ${f2(mad * 100, 1)}%`);
}
if (chk.length) out.splice(out.findIndex(l => l.startsWith('\nÖzet')) + 1, 0, '\nModel doğrulaması (bugünkü kayıtlı kotlar, ±%8 strike): ' + chk.join(' · '));
const txt = out.join('\n'); console.log(txt);
if (process.env.BT_OUT) fs.writeFileSync(process.env.BT_OUT, txt + '\n');
