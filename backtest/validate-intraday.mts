/*
 * Model ↔ GERÇEK gün içi fiyat doğrulaması (record.mts kayıtları gerekir): her kayıtlı anlık görüntüde, |delta| 0,25–0,75 kontratlar için
 * modellenmiş orta fiyat (önceki gün EOD IV) vs gerçek orta fiyat; ayrıca gerçek yarım spread vs model yarım spread.
 * Sonuç, 12 aylık MODELLENMİŞ backtest'e ne kadar güvenilebileceğini söyler. Çıktı: /workspace/backtest/validation-intraday.json
 *   node backtest/validate-intraday.mts [SPY,QQQ,IWM]
 */
import fs from 'node:fs';
import { loadDays } from './bt.mts';
import { loadSnaps, modeledSource } from './sources.mts';

const tickers = (process.argv[2] || 'SPY,QQQ,IWM').split(',');
const ms = modeledSource({ fee: 0, slip: 0, spreadMult: 1 });
const err: number[] = [], sprR: number[] = [], byHour = new Map<number, number[]>(); let snaps = 0, days = 0;
for (const d of loadDays(tickers)) {
  const ss = loadSnaps(d.ticker, d.D).filter(s => s.E === d.E); if (!ss.length) continue; days++;
  for (const s of ss) {
    snaps++;
    const h = Math.floor((s.t - d.open) / 3600000);
    for (const r of s.rows) {
      const type = r[0] ? 'put' : 'call', [K, bid, ask, , delta] = [r[1], r[2], r[3], r[4], r[5]];
      if (!(bid > 0 && ask > bid) || Math.abs(delta) < 0.25 || Math.abs(delta) > 0.75) continue;
      const q = ms.quote(d, type, K, s.S, s.t); if (!q) continue;
      const real = (bid + ask) / 2, mod = (q.bid + q.ask) / 2, e = mod / real - 1;
      err.push(e); if (!byHour.has(h)) byHour.set(h, []); byHour.get(h)!.push(e);
      sprR.push((q.ask - q.bid) / (ask - bid));
    }
  }
}
const qt = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(p * (s.length - 1))] : NaN; };
const out = { days, snaps, n: err.length, bias: qt(err, 0.5), absMed: qt(err.map(Math.abs), 0.5), p90abs: qt(err.map(Math.abs), 0.9),
  modelSpreadOverReal: qt(sprR, 0.5), byHourET: Object.fromEntries([...byHour].sort((a, b) => a[0] - b[0]).map(([h, v]) => [`${9 + h}:30`, { n: v.length, bias: qt(v, 0.5), absMed: qt(v.map(Math.abs), 0.5) }])) };
fs.writeFileSync('/workspace/backtest/validation-intraday.json', JSON.stringify(out, null, 1)); console.log(JSON.stringify(out, null, 1));
if (!days) console.error('Kayıt bulunamadı: önce record.mts ile seans kaydı + ertesi gün fetch.mts/prep.mts (gün kaydı) gerekir.');
