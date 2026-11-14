// Koç komut — sunucu tarafı: öneri (komutPropose, sahte Anthropic), onaylı uygulama (komutApply, SQLite :memory:).
// Saf doğrulama/önizleme testleri: test/coach-komut.test.ts. Ağ YOK. (server/ tsc dışında; bkz. server/README.md.)
import { Store } from './store.ts';
import { Coach, CoachError } from './coach.ts';
import type { Config } from './config.ts';
import { pairFills } from '../../src/lib/coach/fills.ts';
import type { KomutAction } from '../../src/lib/coach/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const DAY = '2026-11-13';

// ───── 3) Sunucu: öneri (sahte Anthropic) ve onaylı uygulama (SQLite :memory:) ─────
const NOW = Date.UTC(2026, 10, 13, 14, 0);   // 17:00 İstanbul (13.11.2026)
type Reply = { input: Record<string, unknown> };
function fakeFetch(replies: Reply[]) {
  let i = 0;
  return (async () => {
    const r = replies[Math.min(i++, replies.length - 1)];
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'tu', name: 'record_komut', input: r.input }], usage: { input_tokens: 120, output_tokens: 40 }, stop_reason: 'tool_use' }), { status: 200 });
  }) as unknown as typeof fetch;
}
function makeCoach(store: Store, f?: typeof fetch) {
  const cfg = { anthropicKey: 'test-anahtar-yalnız-bellekte', coachModel: 'claude-haiku-5-5', coachFallbackModel: '', coachDailyCap: 100, coachMinGapSec: 2, coachAuto: false } as unknown as Config;
  return new Coach({ cfg, store, f, now: () => NOW, log: () => {} });
}
function seed(store: Store) {
  const base = { shot: 'test', conf: 'yuksek' as const };
  const ids = {
    buy: store.coachFillInsert({ ...base, day: DAY, t: '2026-11-13T16:40', tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'buy', px: 2.1 }).id,
    sell: store.coachFillInsert({ ...base, day: DAY, t: '2026-11-13T16:55', tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'sell', px: 3.0 }).id,
    spyBuy: store.coachFillInsert({ ...base, day: DAY, t: '2026-11-13T15:30', tk: 'SPY', exp: DAY, k: 590, cp: 'P', q: 1, side: 'buy', px: 1.45 }).id,
  };
  return ids;
}
const tradeSig = (store: Store, tk: string) => {
  const fills = store.coachFillsSince(DAY).map(r => ({ id: r.id, t: r.t, tk: r.tk, exp: r.exp, k: r.k, cp: r.cp, q: r.q, side: r.side, px: r.px, conf: r.conf }));
  return pairFills(fills).trades.find(p => p.tk === tk);
};

{
  // Öneri: sahte Anthropic iki işlem döndürür; biri bilinmeyen kimlik (düşer), biri geçerli add.
  const store = new Store(':memory:');
  seed(store);
  const coach = makeCoach(store, fakeFetch([{ input: { actions: [
    { op: 'add', fill: { t: '2026-11-13T16:55', tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'sell', px: 3.2 } },
    { op: 'delete', id: 777 },
  ], note: null } }]));
  const p = await coach.komutPropose({ text: "QQQ 600C 3.20'den kapattım", day: DAY });
  ok('öneri: bilinmeyen kimlik düşer, uyarı kalır', p.actions.length === 1 && p.warnings.some(w => w.includes('#777')), JSON.stringify(p.warnings));
  ok('öneri: önizleme kodda kurulur', p.lines.length === 1 && p.lines[0] === 'Ekle: QQQ 600C 13.11 · 2 kontrat SATIŞ @ 3.20 · 16:55', p.lines[0]);
  ok('öneri: kayıt DEĞİŞMEDİ (dolum sayısı 3)', store.coachFillsSince(DAY).length === 3);
  ok('öneri: note null (işlem var)', p.note === null);

  // Gün sınırı ve metin sınırı
  let e1: unknown = null; try { await coach.komutPropose({ text: 'x'.repeat(501), day: DAY }); } catch (e) { e1 = e; }
  ok('500 karakterden uzun metin → 400', e1 instanceof CoachError && (e1 as CoachError).status === 400);
  let e2: unknown = null; try { await coach.komutPropose({ text: 'x', day: '2099-01-01' }); } catch (e) { e2 = e; }
  ok('gelecek gün → 400', e2 instanceof CoachError && (e2 as CoachError).status === 400);

  // Ortak hız sınırı: aynı anda ikinci komut (komut çağrısı sayılır) → 429
  let e3: unknown = null; try { await coach.komutPropose({ text: 'QQQ 600C 3.20 kapattım', day: DAY }); } catch (e) { e3 = e; }
  ok('ikinci komut hemen → 429 (ortak havuz, 2 sn)', e3 instanceof CoachError && (e3 as CoachError).status === 429, String(e3));
  store.close();
}
{
  // Anlaşılmadı: boş actions → varsayılan not
  const store = new Store(':memory:');
  seed(store);
  const coach = makeCoach(store, fakeFetch([{ input: { actions: [], note: null } }]));
  const p = await coach.komutPropose({ text: 'bilmem', day: DAY });
  ok('boş öneri → "Anlaşılamadı" notu', p.actions.length === 0 && (p.note ?? '').startsWith('Anlaşılamadı'), String(p.note));
  store.close();
}
{
  // Onaylı uygulama: fiyat düzeltmesi raporu ve karneyi geçersiz kılar (sig fiyata bağlı değil → içerik karşılaştırması)
  const store = new Store(':memory:');
  const ids = seed(store);
  const coach = makeCoach(store);
  const trade = tradeSig(store, 'QQQ')!;
  store.coachReportPut({ sig: trade.sig, day: DAY, ts: NOW, model: 'm', trade: trade.trade, rules: [], feedback: { x: 1 }, context: null });
  store.coachSaveKarne(DAY, NOW, 'm', { ozet: 'o', guclu: [], tekrarlayanHata: [], yarinOdak: 'y' });
  const r = coach.komutApply({ day: DAY, actions: [{ op: 'update', id: ids.sell, set: { px: 3.4 } }] as KomutAction[] });
  ok('düzeltme uygulandı (applied=1)', r.applied === 1);
  ok('fiyat DB\'de güncel (3.40)', store.coachFillsSince(DAY).find(f => f.id === ids.sell)?.px === 3.4);
  ok('aynı sig ama değişen işlem → rapor silindi', store.coachReportGet(trade.sig) == null);
  ok('etkilenen günün karnesi silindi', store.coachKarneOn(DAY) == null);
  ok('görünüm: işlem "bekliyor" (koçluk yeniden)', r.view.trades.some(t => t.tk === 'QQQ' && t.status === 'bekliyor' && t.exitPx === 3.4));
  store.close();
}
{
  // Tek işlemde ya da hiç: bilinmeyen kimlik → 400, hiçbir şey yazılmaz
  const store = new Store(':memory:');
  const ids = seed(store);
  const coach = makeCoach(store);
  let err: unknown = null;
  try { coach.komutApply({ day: DAY, actions: [{ op: 'delete', id: ids.spyBuy }, { op: 'delete', id: 9999 }] }); } catch (e) { err = e; }
  ok('bilinmeyen kimlik → 400', err instanceof CoachError && (err as CoachError).status === 400);
  ok('hiçbiri uygulanmadı (SPY alışı hâlâ duruyor)', store.coachFillsSince(DAY).some(f => f.id === ids.spyBuy));
  store.close();
}
{
  // Tekrar eden ekleme: aynı batch'te önceki ekleme de geri alınır (transaction)
  const store = new Store(':memory:');
  seed(store);
  const coach = makeCoach(store);
  const before = store.coachFillsSince(DAY).length;
  let err: unknown = null;
  try {
    coach.komutApply({ day: DAY, actions: [
      { op: 'add', fill: { t: '2026-11-13T17:30', tk: 'SPY', exp: DAY, k: 590, cp: 'P', q: 1, side: 'sell', px: 1.8 } },
      { op: 'add', fill: { t: '2026-11-13T16:40', tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'buy', px: 2.1 } },
    ] });
  } catch (e) { err = e; }
  ok('aynı dolum tekrar eklenirse 409', err instanceof CoachError && (err as CoachError).status === 409);
  ok('geri alma: batch içindeki ilk ekleme de yazılmadı', store.coachFillsSince(DAY).length === before);
  store.close();
}
{
  // Yeni ekleme: SPY açık alışı kapatır → yeni işlem "bekliyor"; silme → açık pozisyon/işlem kalkar
  const store = new Store(':memory:');
  const ids = seed(store);
  const coach = makeCoach(store);
  const r = coach.komutApply({ day: DAY, actions: [
    { op: 'add', fill: { t: '2026-11-13T18:30', tk: 'SPY', exp: DAY, k: 590, cp: 'P', q: 1, side: 'sell', px: 1.8 } },
  ] });
  ok('ekleme uygulandı, yeni SPY işlemi "bekliyor"', r.applied === 1 && r.view.trades.some(t => t.tk === 'SPY' && t.status === 'bekliyor'));
  const r2 = coach.komutApply({ day: DAY, actions: [{ op: 'delete', id: ids.spyBuy }] });
  ok('alış silinince SPY işlemi kalkar', r2.applied === 1 && !r2.view.trades.some(t => t.tk === 'SPY'));
  store.close();
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm koç komut (sunucu) testleri geçti');
process.exit(fail ? 1 : 0);
