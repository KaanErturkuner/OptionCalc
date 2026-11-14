/*
 * Uyarlanabilir çıkış niteliksel geri testi (SINYAL-FIRSAT §7.3). Yalnız Yahoo 1 dk barları (MarketData YOK, token gerekmez).
 * Hipotetik pozisyonlar: giriş anında yön ve dayanak fiyatı; her 1 dk'da (yalnız tamamlanmış barlarla) adaptiveDecision +
 * onaylı rejim (confirmedRegimeAt). ÇIK → pozisyon kapanır (kâğıt davranışı). Sonuç: karar geçişleri ve fiyatın sonrası.
 * Opsiyon primi YOK: kararın dayanakla ne yaptığını ölçer (niteliksel). Ağ: Yahoo v8 chart; ham yanıt önbelleğe alınır.
 *
 * Kullanım:  node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON backtest/riskwatch-replay.mts
 * Çıktı:     /workspace/backtest/reports/riskwatch-replay-2026-11-12_13.md (+ konsol)
 * Önbellek:  /workspace/backtest/yahoo/<SYM>-5d-1m.json   (429 gelirse üstel bekleme; hâlâ olmazsa dur)
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { parseYahooChart } from '../src/lib/market/bars.ts';
import * as RG from '../src/lib/market/regime.ts';
import { adaptiveDecision, type AdaptVerdict } from '../src/lib/signals/adaptive.ts';
import { etDate, closeMs } from '../src/lib/usmarket.ts';

const BT = process.env.BT_DIR ?? '/workspace/backtest';
const CACHE = `${BT}/yahoo`, OUT = `${BT}/reports/riskwatch-replay-2026-11-12_13.md`;
const MIN = 60000, H = 3600000;
const SYMS = ['QQQ', 'SPY'];
const DAYS = ['2026-11-12', '2026-11-13'];
const ist = (ms: number) => { const d = new Date(ms + 3 * H); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const pct = (x: number) => `${x >= 0 ? '+' : ''}${x.toFixed(2).replace('.', ',')}%`;
const lv = (x: number) => x.toFixed(2).replace('.', ',');
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Yahoo 1 dk (son 5 gün) — önbellek varsa ondan; 429'da üstel bekleme (en çok 4 deneme). */
async function yahooRaw(sym: string): Promise<any> {
  mkdirSync(CACHE, { recursive: true });
  const f = `${CACHE}/${sym}-5d-1m.json`;
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1m&range=5d&includePrePost=false`;
  for (let k = 0; k < 4; k++) {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (r.ok) { const j = await r.json(); writeFileSync(f, JSON.stringify(j)); return j; }
    if (r.status !== 429) throw new Error(`Yahoo ${sym}: HTTP ${r.status}`);
    const wait = 30000 * 2 ** k;
    console.error(`Yahoo ${sym}: 429, ${wait / 1000} sn bekleniyor`);
    await sleep(wait);
  }
  throw new Error(`Yahoo ${sym}: 429 sürdü; sonra tekrar dene (önbellek boş kaldı)`);
}

/** Bir ET gününün 1 dk barları (seans dışı dahil; çağıran seansı süzer). */
const dayBars = (all: RG.TapeBar[], day: string) => all.filter(b => etDate(b.t) === day);
const sessStart = (day: string) => closeMs(day) - 6.5 * H;

interface Pos { id: string; sym: string; dir: 'call' | 'put'; day: string; entryNote: string; entryT: number }
/** Hipotetik girişler. Dibi seçilenler: giriş = verilen aralıktaki en düşük low'un dakikası (bakışsız: yalnız o dakikadan sonra kullanılır). */
function positions(tapes: Record<string, RG.TapeBar[]>): Pos[] {
  const lowIn = (sym: string, day: string, fromEt: string, toEt: string): number => {
    const b = dayBars(tapes[sym], day).filter(x => { const e = etDate(x.t); const hm = etHm(x.t); return e === day && hm >= fromEt && hm <= toEt; });
    let best = b[0]; for (const x of b) if (x.l < best.l) best = x;
    return best.t + MIN;   // bar kapanışı: dip kararı tamamlanmış barla verilir
  };
  return [
    { id: 'P1', sym: 'QQQ', dir: 'put', day: '2026-11-13', entryNote: '13/11 18:10 İst (10:10 ET) PUT', entryT: Date.parse('2026-11-13T15:10:00Z') },
    { id: 'P2', sym: 'QQQ', dir: 'call', day: '2026-11-12', entryNote: '12/11 sabah dibi (09:30–11:30 ET) CALL', entryT: lowIn('QQQ', '2026-11-12', '09:30', '11:30') },
    { id: 'P3', sym: 'SPY', dir: 'put', day: '2026-11-13', entryNote: '13/11 20:00 İst (12:00 ET) SPY PUT', entryT: Date.parse('2026-11-13T17:00:00Z') },
    { id: 'P4', sym: 'QQQ', dir: 'call', day: '2026-11-13', entryNote: '13/11 öğleden sonra dibi (13:00–15:00 ET) CALL', entryT: lowIn('QQQ', '2026-11-13', '13:00', '15:00') },
  ];
}
/** ET saati (HH:MM). Kasım 2026: DST 1 Kasım'da bitti → EST = UTC−5 (İst = ET + 8 s). */
const etHm = (t: number) => { const d = new Date(t - 5 * H); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

interface Row { t: number; price: number; verdict: AdaptVerdict; counter: number; reason: string; regime: string }

async function main() {
  const raws: Record<string, any> = {};
  for (const s of SYMS) raws[s] = await yahooRaw(s);
  const tapes: Record<string, RG.TapeBar[]> = {};
  for (const s of SYMS) tapes[s] = parseYahooChart(raws[s]).map(b => ({ t: b.t, o: b.o, h: b.h ?? b.c, l: b.l ?? b.c, c: b.c, v: b.v ?? 0 }));

  const out: string[] = [];
  const log = (s = '') => { out.push(s); console.log(s); };
  log(`# Uyarlanabilir çıkış niteliksel geri testi — 12 ve 13 Kasım 2026`);
  log('');
  log('Veri: Yahoo 1 dk (QQQ, SPY), MarketData YOK. Dayanak fiyatı üzerinde karar; opsiyon primi modellenmedi. Karar her 1 dk, yalnız tamamlanmış barlarla; rejim = onaylı (histerezis).');
  log('Kural: karşı hareket ≥ %0,3 (girişten beri lehte uç nokta) → dönüş ↔ devam puanı: ÇIK / TUT / DİKKAT. ÇIK pozisyonu kapatır (kâğıt davranışı).');
  log('');
  const summary: string[] = [];
  for (const p of positions(tapes)) {
    const all = tapes[p.sym];
    const day = dayBars(all, p.day);
    const ss = sessStart(p.day), end = closeMs(p.day);
    const s = p.dir === 'call' ? 1 : -1;
    const entryBar = all.find(b => b.t + MIN === p.entryT) ?? day.find(b => b.t + MIN >= p.entryT);
    const entryPx = entryBar ? entryBar.c : NaN;
    log(`## ${p.id} · ${p.sym} ${p.dir.toUpperCase()} · ${p.entryNote}`);
    log(`Giriş: ${ist(p.entryT)} İst, dayanak ${lv(entryPx)} (son bar kapanışı). ${p.day === '2026-11-12' ? '12/11' : '13/11'} seans: ${ist(ss)}–${ist(end)} İst.`);
    log('');
    const rows: Row[] = [];
    let closedAt: Row | null = null;
    for (let now = p.entryT + MIN; now <= end; now += MIN) {
      const sessBars = day.filter(b => b.t >= ss && b.t + MIN <= now);
      if (sessBars.length < 6) continue;
      const cr = RG.confirmedRegimeAt(all, now, ss);
      const d = adaptiveDecision({ dirSign: s as 1 | -1, entryT: p.entryT, nowMs: now, bars: sessBars, regime: cr.confirmed.kind });
      const price = sessBars[sessBars.length - 1].c;
      const row: Row = { t: now, price, verdict: d.verdict, counter: d.counterPct, reason: d.reason, regime: `${cr.confirmed.label}${cr.pending ? ` (aday: ${cr.pending.kind} ${cr.pending.run}/${RG.REGIME_K.HYST_BARS})` : ''}` };
      rows.push(row);
      if (d.verdict === 'CIK') { closedAt = row; break; }
    }
    // Geçişler
    let prev: AdaptVerdict | null = null;
    const after = (t: number, px: number, mins: number) => {
      const b = all.filter(x => x.t + MIN <= t + mins * MIN && x.t + MIN > t).at(-1);
      return b ? s * (b.c - px) / px * 100 : NaN;
    };
    for (const r of rows) {
      if (r.verdict === 'YOK') { prev = 'YOK'; continue; }
      if (r.verdict === prev) continue;
      prev = r.verdict;
      const f15 = after(r.t, r.price, 15), f30 = after(r.t, r.price, 30);
      log(`- ${ist(r.t)} İst · ${p.sym} ${lv(r.price)} · karşı hareket %${r.counter.toFixed(2).replace('.', ',')} · **${r.verdict}** · ${r.reason}`);
      log(`  - Rejim: ${r.regime}. Sonra (pozisyon yönünde): +15 dk ${Number.isFinite(f15) ? pct(f15) : '—'}, +30 dk ${Number.isFinite(f30) ? pct(f30) : '—'}.`);
    }
    if (!rows.length) log('- Karar yok (veri yetersiz).');
    if (closedAt) {
      const t = closedAt.t, px = closedAt.price;
      const f15 = after(t, px, 15), f30 = after(t, px, 30), f60 = after(t, px, 60);
      const later = all.filter(x => x.t > t && x.t + MIN <= end);
      const fav = Math.max(...later.map(b => s * (b.c - px) / px * 100), -Infinity);
      const worst = Math.min(...later.map(b => s * (b.c - px) / px * 100), Infinity);
      const verdictTxt = f30 <= -0.10 ? 'dönüş doğrulandı (fiyat çıkıştan sonra pozisyona ters gitti)'
        : f30 >= 0.10 ? 'erken çıkış (fiyat çıkıştan sonra devam etti)' : 'yatay (30 dk ±0,10% içinde)';
      log(`- **ÇIKIŞ** ${ist(t)} İst · ${p.sym} ${lv(px)} · ${closedAt.reason}`);
      log(`  - Çıkıştan sonra (pozisyon yönünde): +15 dk ${pct(f15)}, +30 dk ${pct(f30)}, +60 dk ${Number.isFinite(f60) ? pct(f60) : '—'}; seans sonuna kadar en iyi ${Number.isFinite(fav) ? pct(fav) : '—'}, en kötü ${Number.isFinite(worst) ? pct(worst) : '—'}.`);
      log(`  - Değerlendirme: **${verdictTxt}**.`);
      summary.push(`| ${p.id} | ${p.sym} ${p.dir} | ${ist(t)} ÇIK | ${pct(f30)} (+30 dk) | ${verdictTxt} |`);
    } else {
      const last = rows.at(-1);
      const end30 = all.filter(x => x.t + MIN <= end).at(-1)!;
      const fin = s * (end30.c - (last?.price ?? entryPx)) / (last?.price ?? entryPx) * 100;
      log(`- Çıkış yok; seans sonu ${lv(end30.c)} (${pct(fin)} pozisyon yönünde, son karar anından).`);
      summary.push(`| ${p.id} | ${p.sym} ${p.dir} | yok | seans sonu ${pct(fin)} | çıkış yok (TUT/DİKKAT/YOK) |`);
    }
    log('');
  }
  // Histerezis kontrolü: ham (5 dk ölçümde anlık) ve onaylı rejim değişimleri, QQQ/SPY × 12/11, 13/11
  log('## Rejim histerezisi: ham ve onaylı değişimler (5 dk kapanışları)');
  log('');
  log('| Gün | Sembol | Ham değişim sayısı | Onaylı değişim sayısı | Ham değişimler (İst) | Onaylı değişimler (İst) |');
  log('|---|---|---|---|---|---|');
  for (const day of DAYS) for (const sym of SYMS) {
    const all = tapes[sym], ss = sessStart(day), end = closeMs(day);
    const raw: string[] = []; let prev: string | null = null;
    for (let t = ss + RG.REGIME_K.WINDOW_MIN_OK * MIN; t <= end; t += 5 * MIN) {
      const k = RG.regimeAt(all, t, ss).kind;
      if (k !== prev) { raw.push(`${ist(t)} ${k}`); prev = k; }
    }
    const conf = RG.regimeChanges(all, ss, end).map(c => `${ist(c.t)} ${c.kind}`);
    log(`| ${day.slice(8)}/${day.slice(5, 7)} | ${sym} | ${raw.length} | ${conf.length} | ${raw.join(' → ') || '—'} | ${conf.join(' → ') || '—'} |`);
  }
  log('');
  log('## Özet');
  log('| Pozisyon | Enstrüman | ÇIK | Sonra (+30 dk) | Değerlendirme |');
  log('|---|---|---|---|---|');
  for (const l of summary) log(l);
  writeFileSync(OUT, out.join('\n') + '\n');
  console.log(`\nYazıldı: ${OUT}`);
}

main().catch(e => { console.error(e.message ?? e); process.exit(1); });
