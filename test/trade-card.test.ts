// Fırsat işlem kartları (trade.ts): sıralama, adet/komisyon, gece etiketi, BEKLE tetikleyicisi. Ağ YOK.
import * as V from '../src/lib/signals/verdict.ts';
import * as T from '../src/lib/signals/trade.ts';
import { etMs } from '../src/lib/calendar/releases.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

const NOW = etMs('2026-11-16', '10:00');     // Pazartesi; yarın perakende (blokaj yok)
const EXP = '2026-11-16';
const CHAIN: V.QuoteLite[] = [
  { type: 'call', strike: 692.5, bid: 0.78, ask: 0.82, volume: 500, oi: 1000 },
  { type: 'put', strike: 687.5, bid: 0.70, ask: 0.74, volume: 300, oi: 500 },
];
const BASE: V.VerdictInputs = { S: 690, vwap: null, orHigh: null, orLow: null, flip: null, callWall: null, putWall: null, emMove: null,
  pcVol: null, unusualCall: 0, unusualPut: 0, momentum: null };
const card = (inputs: V.VerdictInputs, nowMs = NOW) => V.buildVerdict({ inputs, expiries: [{ date: EXP, dte: 0 }], nowMs,
  quotesFor: () => CHAIN, dOf: () => 2.5, kademe: 0.5, capital: 300 });

const BULL = card({ ...BASE, vwap: 688, orHigh: 689, orLow: 680, flip: 680, pcVol: 0.5, unusualCall: 1000, unusualPut: 100, momentum: 1 });   // +6 → CALL 5/5
const BEAR4 = card({ ...BASE, vwap: 700, orHigh: 705, orLow: 695, pcVol: 1.5, momentum: -1 });                                         // −4 → PUT 4/5
const WEAK = card({ ...BASE, vwap: 688, flip: 680, momentum: 1 });                                                                     // +3 → CALL 3/5
const BEKLE = card({ ...BASE, vwap: 688, orHigh: 695, orLow: 680, flip: 700 });                                                       // 0 → BEKLE

// ───── 1) Tek kart türetimi ─────
{
  ok('BULL: yön CALL, strike 692,5 (OTM 2,5)', BULL.dir === 'call' && BULL.strike === 692.5);
  const t = T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, { capital: 300, kademe: 0.5, commission: 1.5 })!;
  ok('kart: CALL etiketi, 0DTE + tarih', t.typeLabel === 'CALL' && t.expiryLabel === '0DTE · 16 Kas', t.expiryLabel);
  ok('kart: spot ve OTM uzaklık', t.spot === 690 && near(t.otm, 2.5), `${t.spot} ${t.otm}`);
  ok('kart: giriş 0,80, stop 0,48 (×0,60), hedef 1:5 = 2,40, yedek 1:4 = 2,08',
    t.entry === 0.8 && t.stop === 0.48 && t.t5 === 2.4 && t.t4 === 2.08, JSON.stringify([t.entry, t.stop, t.t5, t.t4]));
  ok('kart: stop yüzdesi 40', t.stopPct === 40);
  ok('kart: gerekçe düz Türkçe, yön öneki', t.rationale.startsWith('Yükseliş yönünde:'), t.rationale);
  ok('kart: güç 5/5 (çok güçlü)', t.strength === 5 && t.strengthText === 'çok güçlü');
  ok('bekle için kart yok', T.tradeOf({ ticker: 'QQQ', verdict: BEKLE }, NOW, null) === null);
  ok('strike yoksa kart yok', T.tradeOf({ ticker: 'QQQ', verdict: { ...BULL, strike: null } }, NOW, null) === null);
}

// ───── 2) Adet ve komisyon (kademe bütçesi, gidiş-dönüş) ─────
{
  const t = T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, { capital: 300, kademe: 0.5, commission: 1.5 })!;
  const s = t.sizing!;
  // bütçe 150 $; kontrat maliyeti 0,80 × 100 + 1,50 = 81,50 → 1 kontrat
  ok('300 $ · %50 → 1 kontrat', s.contracts === 1 && s.tierPct === 50 && s.capital === 300, JSON.stringify(s));
  ok('prim maliyeti 80 $, açılış komisyonu 1,50 $, gidiş-dönüş 3 $', near(s.premiumCost, 80) && near(s.openComm, 1.5) && near(s.rtComm, 3));
  ok('stopta net ≈ −35 $ (komisyon dâhil)', near(s.stopNet, -35), String(s.stopNet));
  ok('1:5 hedefte net ≈ +157 $', near(s.targetNet, 157), String(s.targetNet));
  ok('1:4 yedekte net ≈ +125 $', near(s.targetNet4, 125), String(s.targetNet4));
  const big = T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, { capital: 1000, kademe: 0.5, commission: 1.5 })!.sizing!;
  ok('1000 $ · %50 → 6 kontrat (bütçe 500 $)', big.contracts === 6 && near(big.rtComm, 18), JSON.stringify(big));
  const low = T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, { capital: 100, kademe: 0.3, commission: 1.5 })!.sizing!;
  ok('sermaye yetmez → 0 kontrat, minCost 81,50', low.contracts === 0 && near(low.minCost, 81.5), JSON.stringify(low));
  ok('hesap yoksa sizing null', T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, null)!.sizing === null);
}

// ───── 3) Gece etiketi ─────
{
  const z = T.overnightOf(0, NOW);
  ok('0DTE: 15:45 ET\'de kapat', !z.carry && z.label === "15:45 ET'de kapat");
  const n = T.overnightOf(1, NOW);
  ok('1 gün, blokaj yok: gece taşınabilir', n.carry && n.label === 'Gece taşınabilir', n.label);
  const cpi = T.overnightOf(2, etMs('2026-11-09', '10:00'));   // yarın (10 Kas) CPI
  ok('1–3 DTE, yarın CPI: taşınmaz ve CPI yazılır', !cpi.carry && cpi.sub.includes('CPI'), cpi.sub);
  ok('etiket: 1 gün · tarih', T.dteLabelOf(1) === '1 gün' && T.shortDate('2026-11-14') === '14 Kas');
}

// ───── 4) Makro uyarı satırları ─────
{
  const t = T.tradeOf({ ticker: 'QQQ', verdict: BULL }, etMs('2026-11-13', '10:00'), null)!;   // 13 Kas: PPI
  ok('makro uyarı: bugün PPI satırı', t.warnings.some(w => w.includes('PPI')), t.warnings.join(' | '));
  ok('makro uyarı: dizi döner (blokaj yok günü)', Array.isArray(T.tradeOf({ ticker: 'QQQ', verdict: BULL }, NOW, null)!.warnings));
}

// ───── 5) BEKLE tetikleyicisi ─────
{
  ok('BEKLE: yön yok, sum 0', BEKLE.dir === 'bekle' && BEKLE.sum === 0);
  const tx = T.triggerText('QQQ', BEKLE);
  ok('BEKLE tetikleyici: CALL yönü, gamma flip + açılış aralığı', tx === 'QQQ gamma flip 700 üstü + 695 üstü → CALL', tx);
  const put = card({ ...BASE, vwap: 700, orLow: 695, orHigh: 705, momentum: null });   // sum −2 → PUT'a 1 puan
  ok('BEKLE tetikleyici: PUT yönü, momentum', put.sum === -2 && T.triggerText('QQQ', put) === 'QQQ aşağı momentum → PUT', T.triggerText('QQQ', put));
  const noLevels = card({ ...BASE, momentum: null });
  ok('seviye yok: yalnız momentum tetikleyicisi kalır', T.triggerText('QQQ', noLevels) === 'QQQ yukarı momentum → CALL', T.triggerText('QQQ', noLevels));
  const noneAt = card({ ...BASE });                                                       // hiçbir veri yok → bekle, momentum da yok
  ok('hiçbir veri yok: "tetikleyici yok" değil, momentum tetikleyicisi', T.triggerText('QQQ', noneAt).endsWith('→ CALL'), T.triggerText('QQQ', noneAt));
}

// ───── 6) Pano: sıralama, en fazla 3, BEKLE ─────
{
  const entries = [
    { ticker: 'QQQ', verdict: BULL }, { ticker: 'NVDA', verdict: BEAR4 }, { ticker: 'GLD', verdict: WEAK }, { ticker: 'SPY', verdict: BULL },
  ];
  const b = T.buildBoard(entries, NOW, { capital: 300, kademe: 0.5, commission: 1.5 });
  ok('pano: en fazla 3 kart', b.trades.length === 3 && b.wait === null, String(b.trades.length));
  ok('pano: güce göre sıra (QQQ, SPY, NVDA); zayıf GLD dışarıda',
    b.trades.map(t => t.ticker).join(',') === 'QQQ,SPY,NVDA', b.trades.map(t => t.ticker).join(','));
  ok('pano: PUT kartı PUT etiketli', b.trades[2].typeLabel === 'PUT' && b.trades[2].dir === 'put');

  const none = T.buildBoard([{ ticker: 'QQQ', verdict: BEKLE }], NOW, null);
  ok('hiç işlem yok → BEKLE kartı', none.trades.length === 0 && none.wait !== null);
  ok('BEKLE: neden ve satır', none.wait!.reason.includes('bekliyorum') && none.wait!.lines.length === 1, none.wait!.reason);
  ok('BEKLE: yön var ama strike yok → ayrı neden', (() => {
    const w = T.buildBoard([{ ticker: 'QQQ', verdict: { ...BULL, strike: null } }], NOW, null).wait!;
    return w.reason.includes('strike') && w.lines[0].text.includes('uygun strike/prim yok');
  })());
  const empty = T.buildBoard([], NOW, null);
  ok('veri yokken BEKLE (tarama bekleniyor)', empty.wait !== null && empty.wait.reason.includes('Tarama'));
}

// ───── 7) Hotfix: eski / eksik alanlı kartlar (AsyncStorage) asla fırlatmaz ─────
{
  const { levels: _l, crits: _c, fired: _f, ...noLv } = BULL as Record<string, unknown> & V.VerdictCard;
  const oldCard = noLv as unknown as V.VerdictCard;                                  // levels/crits/fired yok
  const sat = etMs('2026-11-14', '10:00');                                           // Cumartesi: veri/seans yok
  const sized = { capital: 300, kademe: 0.5, commission: 1.5 } as const;

  ok('normalize: null/sayı/string → null', T.normalizeVerdict(null) === null && T.normalizeVerdict(42) === null && T.normalizeVerdict('x') === null);
  const nv = T.normalizeVerdict(oldCard)!;
  ok('normalize: eksik levels → S NaN, crits/fired []', nv !== null && Number.isNaN(nv.levels.S) && nv.crits.length === 0 && nv.fired.length === 0, JSON.stringify(nv?.levels));
  ok('normalize: bozuk dir → bekle, bozuk band → null', T.normalizeVerdict({ dir: 'xx', levels: { S: 690, band: { high: 'a' } } })!.dir === 'bekle'
    && T.normalizeVerdict({ levels: { S: 690, band: { high: 'a' } } })!.levels.band === null);
  ok('tradeOf: levels yok → işlem kartı yok (throw yok)', (() => { try { return T.tradeOf({ ticker: 'QQQ', verdict: oldCard }, NOW, sized) === null; } catch { return false; } })());
  ok('tradeOf: spot NaN/yok → kart yok', T.tradeOf({ ticker: 'QQQ', verdict: { ...BULL, levels: { ...BULL.levels, S: NaN } } }, NOW, null) === null);
  const noCrit = T.tradeOf({ ticker: 'QQQ', verdict: { ...BULL, crits: undefined as unknown as V.Crit[], fired: undefined as unknown as string[] } }, NOW, sized);
  ok('tradeOf: crits/fired yok → kart var, gerekçe yine yazılır', noCrit !== null && noCrit.rationale.startsWith('Yükseliş yönünde'), noCrit?.rationale);
  ok('tradeOf: null entry/verdict → null', T.tradeOf(null as unknown as T.BoardEntry, NOW, null) === null
    && T.tradeOf({ ticker: 'QQQ', verdict: null as unknown as V.VerdictCard }, NOW, null) === null);
  ok('triggerText: levels/crits yok → throw yok, metin döner',
    (() => { try { return T.triggerText('QQQ', oldCard).startsWith('QQQ'); } catch { return false; } })());
  ok('triggerText: null verdict → seviye verisi yok', T.triggerText('QQQ', null) === 'QQQ: tetikleyici seviye verisi yok');
  ok('buildBoard: eksik levels/crits/fired → BEKLE, throw yok',
    (() => { try { const b = T.buildBoard([{ ticker: 'QQQ', verdict: oldCard }], NOW, sized); return b.trades.length === 0 && b.wait !== null; } catch { return false; } })());
  const mixed = T.buildBoard([null as unknown as T.BoardEntry, { ticker: 'SPY', verdict: BULL }, { ticker: '', verdict: BULL },
    { ticker: 'GLD', verdict: 'bozuk' as unknown as V.VerdictCard }, { ticker: 'NVDA', verdict: oldCard }], NOW, sized);
  ok('buildBoard: bozuk girişler atlanır, geçerli kart kalır', mixed.trades.length === 1 && mixed.trades[0].ticker === 'SPY', JSON.stringify(mixed.trades.map(t => t.ticker)));
  ok('buildBoard: boş pano → tarama bekleniyor', T.buildBoard([], NOW, null).wait?.reason.includes('Tarama') === true);
  ok('buildBoard: null/undefined girdi → tarama bekleniyor (throw yok)', T.buildBoard(null, NOW, null).wait?.reason.includes('Tarama') === true
    && T.buildBoard(undefined, NOW, null).trades.length === 0);
  const wk = T.buildBoard([], sat, null);
  ok('hafta sonu, veri yok → BEKLE', wk.trades.length === 0 && wk.wait !== null);
  const wkBekle = T.buildBoard([{ ticker: 'QQQ', verdict: { ...BEKLE, levels: undefined as unknown as V.VerdictLevels } }], sat, null);
  ok('hafta sonu, bekle kartı eksik levels → BEKLE satırı', wkBekle.trades.length === 0 && wkBekle.wait!.lines.length === 1);
}

if (fail) { console.log(`\n${fail} test başarısız`); process.exit(1); }
console.log('\ntrade-card testleri tamam');
