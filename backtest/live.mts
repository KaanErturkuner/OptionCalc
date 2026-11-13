/*
 * ŞU ANKİ tavsiye (kağıt işlem): token KULLANMAZ. Zincir = record.mts'in son anlık görüntüsü (snaps/<D>/<T>.jsonl), barlar = Yahoo 1 dk.
 *   node backtest/live.mts [MU,QQQ,INTC]
 * confluence-v2 (uygulama motoru, SG.analyze) + kaan-momentum-0dte / -1to3dte (varsayılan parametreler) + koşul dökümü.
 */
import { yahooBars } from '../src/lib/market/bars.ts';
import { etDate, closeMs } from '../src/lib/usmarket.ts';
import * as SG from '../src/lib/odte/signal.ts';
import * as STR from '../src/lib/odte/strategies/index.ts';
import { vwapAt, openRange, hi, lo, avgVol } from '../src/lib/odte/strategies/util.ts';
import { loadSnaps, snapToChain } from './sources.mts';
import type { Bar } from '../src/lib/odte/analytics.ts';

const tickers = (process.argv[2] || 'MU,QQQ,INTC').split(','), PEERS = ['QQQ', 'SPY', 'SMH'];
const now = Date.now(), D = etDate(now), open = closeMs(D) - 6.5 * 3600000, m = Math.floor((now - open) / 60000);
const et = (t: number) => new Date(t).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour12: false });
const bars: Record<string, Bar[]> = {};
for (const s of [...new Set([...tickers, ...PEERS])]) bars[s] = (await yahooBars(s)).filter(b => b.t >= open && b.t + 60000 <= now);
const f2 = (x: number | null | undefined, d = 2) => x == null || !isFinite(x) ? '—' : x.toFixed(d);
const side = (b: Bar[]) => { const S = b[b.length - 1].c, v = vwapAt(b)!, or = openRange(b, 15)!; return { S, v, vw: S > v ? 'üstü' : 'altı', or: S > or.high ? 'yukarı kırık' : S < or.low ? 'aşağı kırık' : 'aralık içi', ret: S / b[0].o - 1 }; };
console.log(`Şimdi ${et(now)} ET (seans dk ${m}) · Yahoo son tam bar: ${et(bars[tickers[0]].at(-1)!.t)} ET`);
for (const s of PEERS) { const x = side(bars[s]); console.log(`  ${s}: ${f2(x.S)} VWAP ${f2(x.v)} (${x.vw}), OR15 ${x.or}, gün ${f2(x.ret * 100)}%`); }
const K0 = STR.strategyById('kaan-momentum-0dte')!, K13 = STR.strategyById('kaan-momentum-1to3dte')!;
for (const T of tickers) {
  const b = bars[T], S = b[b.length - 1].c, snaps = loadSnaps(T, D), sn = snaps.at(-1);
  console.log(`\n== ${T}  S=${f2(S)}  VWAP ${f2(vwapAt(b))} (${S > vwapAt(b)! ? 'üstü' : 'altı'})`);
  if (!sn) { console.log('  zincir anlık görüntüsü yok'); continue; }
  const ch = snapToChain(sn), age = Math.round((now - sn.t) / 1000), dte = Math.round((Date.parse(sn.E) - Date.parse(D)) / 864e5);
  console.log(`  zincir: vade ${sn.E} (DTE ${dte}), görüntü ${et(sn.t)} ET, yaş ${age} sn, görüntüdeki S ${sn.S}`);
  const r = SG.analyze(T, S, ch, b, now, SG.DEFAULT_OPTS);
  console.log(`  confluence-v2: puan ${r.score} → ${r.signal ? JSON.stringify(r.signal) : 'SİNYAL YOK: ' + r.noSignal}`);
  const F = SG.features(S, ch, b, now, 15), em0 = F.em ? F.em.move / Math.sqrt(1 + dte) : null;
  const n = b.length, last = b[n - 1], or = openRange(b, 15)!, sec = T === 'QQQ' ? null : 'SMH';
  const vr = last.v / avgVol(b, n - 21, n - 1);
  console.log(`  kaan koşulları: em(günlük) ${f2(em0)} · salınım30 H ${f2(hi(b, n - 31, n - 1))} L ${f2(lo(b, n - 31, n - 1))} · OR15 ${f2(or.low)}–${f2(or.high)} · son bar hacim ${f2(vr)}× ort20 · callWall ${F.w.callWall} putWall ${F.w.putWall}` +
    (sec ? ` · ${sec}−QQQ göreli ${f2((side(bars[sec]).ret - side(bars.QQQ).ret) * 100)}%` : ''));
  for (const st of [K0, K13]) {
    const p: any = st.defaults;
    const ctx: any = { ticker: T, S, t: now, m, bars: b, F, day: { ticker: T, date: D, dte, prevClose: null, openPx: b[0].o, em0 }, chain: () => ch, mem: {}, peer: (s: string) => bars[s] ?? null };
    const e = st.evaluate(ctx, p);
    if (!e) { console.log(`  ${st.id}: SİNYAL YOK${dte < p.dteMin || dte > p.dteMax ? ` (kayıtlı vade DTE ${dte}, varyant ${p.dteMin}–${p.dteMax})` : ''}`); continue; }
    const q = STR.pickStrike(ch, e.dir, e.strike!, p, S);
    if (!q) { console.log(`  ${st.id}: ${e.dir} sinyali ama likit kontrat yok`); continue; }
    const mid = (q.bid + q.ask) / 2, dl = q.delta ?? 0.3, gm = q.gamma ?? 0;
    const px = (X: number) => Math.max(0.01, mid + dl * (X - sn.S) + 0.5 * gm * (X - sn.S) ** 2);
    console.log(`  ${st.id}: ${e.dir.toUpperCase()} ${T} ${q.strike} ${sn.E} · bid/ask ${q.bid}/${q.ask} mid ${f2(mid)} (yaş ${age} sn) · Δ ${f2(dl)} · hedef dayanak ${f2(e.undTarget)} (~opsiyon ${f2(px(e.undTarget))}) · stop dayanak ${f2(e.undStop)} (~opsiyon ${f2(px(e.undStop))}) · en geç ${et(now + e.maxHoldMin! * 60000)} ET · ${e.note}`);
  }
}
