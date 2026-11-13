/*
 * Sunucu öz-testi (ağ YOK): sentetik fixture ile uçtan uca tespit, anahtar karşılaştırması, hız sınırı,
 * Expo push (sahte fetch) ve bütçe freni. Çalıştırma: node server/app/selftest.ts  (npm run flow:selftest)
 */
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { FixtureSource, type FixturePoll } from './fixture.ts';
import { Poller } from './poller.ts';
import { ExpoPush, eventMessage } from './push.ts';
import { keyOk, RateLimit } from './http.ts';
import { MdClient, BudgetError } from './md.ts';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import type { FlowEvent } from '../../src/lib/flow/model.ts';
import { Coach, CoachError } from './coach.ts';
import { ANTHROPIC_URL } from '../../src/lib/coach/anthropic.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

async function main() {
  // 1) Uçtan uca tespit (sentetik fixture): ilk tarama referans, teyitli olaylar, soğuma, geniş spread push'a girmez
  const here = fileURLToPath(new URL('.', import.meta.url));
  const polls = JSON.parse(readFileSync(join(here, '../fixtures/synthetic-chain.json'), 'utf8')).polls as FixturePoll[];
  const cfg = { ...loadConfig({ FLOW_DB: ':memory:', CREDENTIALS_DIRECTORY: '/nonexistent' }), pushMinPremium: 100000 };
  const store = new Store(':memory:');
  const src = new FixtureSource(polls);
  const pushed: FlowEvent[][] = [];
  const push = { send: async (evs: FlowEvent[]) => { pushed.push(evs); return { sent: evs.length, ids: evs.map(e => e.id) }; } };
  const poller = new Poller({ ...cfg, tickers: ['QQQ'] }, store, src, push, () => {});
  src.i = 0;
  const s1 = await poller.pollOnce(Date.parse(polls[0].at), { force: true });
  ok('ilk tarama: olay yok, taban yazıldı', s1.events === 0 && store.baseCount(s1.day) === 3, JSON.stringify(s1));
  src.i = 1;
  const s2 = await poller.pollOnce(Date.parse(polls[1].at), { force: true });
  ok('ikinci tarama: 2 teyitli olay', s2.events === 2 && s2.confirmed === 2, JSON.stringify(s2));
  const evs = store.listEvents({ limit: 10 });
  const call585 = evs.find(e => e.strike === 585);
  ok('585C dV=1150 (canlı hacim 1250 − taban 100)', !!call585 && call585.dv === 1150 && call585.confirmed, JSON.stringify(call585));
  ok('push: yalnız teyitli + dar spread + eşik üstü (585C)', pushed.length === 1 && pushed[0].length === 1 && pushed[0][0].strike === 585,
    JSON.stringify(pushed.map(p => p.map(e => e.strike))));
  ok('585C pushed işaretlendi', store.listEvents({ limit: 10 }).find(e => e.strike === 585)!.pushed === true);
  src.i = 2;
  const s3 = await poller.pollOnce(Date.parse(polls[2].at), { force: true });
  ok('üçüncü tarama: soğuma nedeniyle yeni olay yok', s3.events === 0, JSON.stringify(s3));
  ok('sahte kaynakla gerçek MarketData çağrısı yok (fixture sayacı)', src.calls.chain === 3 && src.calls.quote === 2, JSON.stringify(src.calls));
  store.close();

  // 2) Anahtar karşılaştırması
  ok('anahtar: doğru', keyOk('abc123', 'abc123'));
  ok('anahtar: yanlış / boş / eksik → red', !keyOk('abc124', 'abc123') && !keyOk('', 'abc123') && !keyOk(undefined, 'abc123') && !keyOk('x', ''));

  // 3) Hız sınırı (dakikada)
  const rl = new RateLimit(2);
  const t0 = Date.parse('2026-11-16T15:00:00Z');
  ok('hız sınırı: 2 izin, 3. red, sonraki dakika açılır', rl.take(t0) && rl.take(t0) && !rl.take(t0) && rl.take(t0 + 60000));

  // 4) Expo push: mesaj biçimi + DeviceNotRegistered token temizliği (sahte fetch)
  const st = new Store(':memory:');
  st.addPushToken('ExponentPushToken[AAAAAAAAAAAAAAAA]', 1);
  st.addPushToken('ExponentPushToken[BBBBBBBBBBBBBBBB]', 1);
  const seen: any[] = [];
  const fakeFetch = (async (_u: any, init: any) => {
    const body = JSON.parse(init.body); seen.push(...body);
    return new Response(JSON.stringify({ data: body.map((m: any) => m.to.includes('BBBB') ? { status: 'error', details: { error: 'DeviceNotRegistered' } } : { status: 'ok' }) }), { status: 200 });
  }) as typeof fetch;
  const ev = { id: 7, ts: 0, day: '2026-11-16', ticker: 'QQQ', occ: 'QQQ261116C00585000', expiry: '2026-11-16', side: 'call', strike: 585, dv: 1150, volume: 1250, oi: 300,
    bid: 1, ask: 1.2, mid: 1.1, prem: 126500, volOi: 3.8, confirmed: true, wide: false, pushed: false, underlying: 580.5 } as FlowEvent;
  const r = await new ExpoPush(st, '', fakeFetch).send([ev]);
  ok('push: iki tokena gönderim, 1 başarılı', seen.length === 2 && r.sent === 1 && r.ids[0] === 7, JSON.stringify(r));
  ok('push: mesaj Türkçe ve kontrat etiketli', seen[0].title.includes('QQQ') && seen[0].body.includes('QQQ 16 Kas 585 C') && seen[0].data.type === 'flow');
  ok('push: DeviceNotRegistered → token silindi', st.pushTokens().length === 1 && st.pushTokens()[0].includes('AAAA'), JSON.stringify(st.pushTokens()));
  ok('push: teyitsiz başlık etiketi', eventMessage({ ...ev, confirmed: false }).title.includes('teyitsiz'));
  st.close();

  // 4b) Gün penceresi ve saklama: fromDay sorgusu + işlem günü bazlı silme (ağ YOK)
  {
    const ds = new Store(':memory:');
    const mk = (day: string, i: number) => ({ ts: Date.parse(day + 'T15:00:00Z'), day, ticker: 'QQQ', occ: 'QQQ' + day.replace(/-/g, '') + 'C00585000',
      expiry: day, side: 'call' as const, strike: 585, dv: 300, volume: 400, oi: 100, bid: 1, ask: 1.2, mid: 1.1, prem: 33000, volOi: 3,
      confirmed: true, wide: false, pushed: false, underlying: 580 + i });
    for (const [i, day] of ['2026-11-06', '2026-11-09', '2026-11-10', '2026-11-12', '2026-11-13', '2026-11-16'].entries()) ds.insertEvent(mk(day, i));
    ds.prune('2026-11-16', Date.parse('2026-11-16T15:00:00Z'));   // 5 işlem günü: 16,13,12,11(tatil yok, işlem günü),10
    const kept = ds.listEvents({ limit: 50 }).map(e => e.day).sort();
    ok('saklama: 5 işlem günü tutulur, daha eskisi silinir', kept.join(',') === '2026-11-10,2026-11-12,2026-11-13,2026-11-16', kept.join(','));
    const win = ds.listEvents({ limit: 50, fromDay: '2026-11-12' }).map(e => e.day).sort();
    ok('pencere (3 işlem günü): fromDay=12 Kas → yalnız 12,13,16', win.join(',') === '2026-11-12,2026-11-13,2026-11-16', win.join(','));
    const cnt = ds.listEvents({ limit: 50, fromDay: '2026-11-10' }).length;
    ok('fromDay ile sınırlı sayı (limit) ve yeni → eski sıra', cnt === 4 && ds.listEvents({ limit: 1, fromDay: '2026-11-10' })[0].day === '2026-11-16');
    ds.close();
  }

  // 5) Bütçe freni: token yok → MarketData'ya HİÇ istek atılmaz
  let fetched = 0;
  const md = new MdClient('', new Store(':memory:'), { flowDailyCap: 10, proxyDailyCap: 10, creditReserve: 1 }, (async () => { fetched++; return new Response('{}'); }) as typeof fetch);
  let blocked = false;
  try { await md.get('/stocks/quotes/SPY/', 'proxy'); } catch (e) { blocked = e instanceof BudgetError; }
  ok('bütçe: tokensız çağrı engellenir, ağa çıkılmaz', blocked && fetched === 0);

  await coachSelftest();
}

/** 6) Koç uçtan uca (SAHTE Anthropic + Yahoo; ağ YOK, ücret YOK): dolum çıkarma → eşleştirme → koçluk → karne;
 *    önbellek (aynı görüntü), sırasız yükleme, kısmi çıkış, hız sınırı (gap/daily), koçluk hatası ve kurtarma, anahtar sızıntısı */
async function coachSelftest() {
  const KEY = 'sk-ant-SELFTEST-0000';
  const DAY = '2026-11-13';
  let clock = Date.UTC(2026, 10, 14, 15, 0);   // Cumartesi 18:00 İst (elle ilerletilir)
  const fill = (o: Record<string, unknown>) => ({ tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'buy', px: 1.0, t: DAY + 'T18:00', conf: 'yuksek', ...o });
  const coachFeedback = { feedback: [{ index: 0, neOldu: { oncesi: 'Giriş öncesi sakin.', sirasinda: 'Yükseliş sürdü.', sonrasi: 'Devam etti.' }, cikis: { karar: 'erken', neden: 'acele etmişsin, yön doğruydu ama erken çıktın' }, giris: { karar: 'iyi', neden: 'VWAP yakını, pencere içi' }, strike: { karar: 'uygun', neden: 'OTM uygun' }, kacanFirsatYorum: 'Tahmini opsiyon kazancı kaçtı.', birDahakine: ['Hedefi önceden yaz.', 'Stop kuralını koru.', 'Hacim dönüşünü bekle.'], karne: { disiplinCikis: 7, girisZamanlamasi: 9, strikeSecimi: 8, aciklama: 'Tek işlem.' } }] };
  const karneJson = { ozet: 'Tek işlem, hedefte çıkış.', guclu: ['Pencere içi giriş'], tekrarlayanHata: [], yarinOdak: 'Hedefi işlem öncesi yaz.' };
  // Sahte Haiku: çıkarma yanıtı sıradaki dolum listesi; koçluk yanıtı (bozulabilir); karne
  let nextFills: unknown[] = [];
  let coachBroken = false;
  let modelReject = false;
  let extractProse = false;   // true: çıkarma modeli araç çağırmaz, düz metin yazar (ayrıştırma hatası yolu)
  const calls: { kind: string; model: string; key: string; maxTokens: number; images: number; tool: string | null; toolChoice: string | null }[] = [];
  const bars: unknown[] = [], ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  for (let t = Date.UTC(2026, 10, 13, 14, 30); t <= Date.UTC(2026, 10, 13, 21, 0); t += 60000) {
    const i = ts.length; ts.push(t / 1000); const px = 600 + (i % 7) * 0.05;
    o.push(px); h.push(px + 0.2); l.push(px - 0.2); c.push(px + 0.05); v.push(1000 + (i === 250 ? 9000 : 0));
  }
  const yahoo = { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === ANTHROPIC_URL) {
      const body = JSON.parse(String(init?.body));
      const key = String((init?.headers as Record<string, string>)['x-api-key']);
      const kind = body.system.includes('Midas') ? 'extract' : body.system.includes('GÖREV: Her işlem') ? 'coach' : 'karne';
      calls.push({ kind, model: body.model, key, maxTokens: body.max_tokens, images: body.messages[0].content.filter((b: { type: string }) => b.type === 'image').length, tool: body.tools?.[0]?.name ?? null, toolChoice: body.tool_choice?.name ?? null });
      if (modelReject && body.model === 'bad-model') return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: bad-model not found' } }), { status: 404 });
      if (kind === 'extract' && extractProse) return new Response(JSON.stringify({ content: [{ type: 'text', text: 'Bu görüntü bir test görüntüsü, işlem satırı yok.' }], usage: { input_tokens: 1235, output_tokens: 12 }, stop_reason: 'end_turn' }), { status: 200 });
      if (kind === 'extract' && body.tools) return new Response(JSON.stringify({ content: [{ type: 'tool_use', id: 'toolu_selftest', name: 'record_fills', input: { fills: nextFills, note: null } }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'tool_use' }), { status: 200 });
      let payload: unknown = kind === 'extract' ? { fills: nextFills, note: null } : kind === 'coach' ? (coachBroken ? { oops: true } : coachFeedback) : karneJson;
      if (kind === 'coach' && coachBroken) payload = { oops: true };
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn' }), { status: 200 });
    }
    if (u.startsWith('https://query1.finance.yahoo.com/')) return new Response(JSON.stringify(yahoo), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const logs: string[] = [];
  const mkCfg = (over: Record<string, unknown> = {}) => ({ ...loadConfig({ FLOW_DB: ':memory:', CREDENTIALS_DIRECTORY: '/nonexistent' }), anthropicKey: KEY, coachModel: 'claude-haiku-5-5', coachFallbackModel: '', coachDailyCap: 100, coachMinGapSec: 2, ...over });
  const store = new Store(':memory:');
  const coach = new Coach({ cfg: mkCfg(), store, f: fake, now: () => clock, log: m => logs.push(m) });
  const kinds = (k: string) => calls.filter(x => x.kind === k).length;
  const img = (n: number) => 'iVBORw0KGgoAAAANSUhEUg' + 'A'.repeat(n * 4) + '==';   // farklı görüntüler (PNG imzası + farklı kuyruk)
  const up = async (b64: string, fills: unknown[]) => { nextFills = fills; clock += 5000; return coach.coachImage({ image: b64, mime: 'image/png', day: DAY }); };

  // 1) Açılış: tek dolum, eşleşme yok → koçluk yok, bekleyen 0 (açık pozisyon)
  const r1 = await up(img(1), [fill({ px: 1.0, t: DAY + 'T18:00' })]);
  ok('koç: dolum çıkarıldı ve kaydedildi (1 yeni)', r1.added === 1 && r1.fills.length === 1 && !r1.duplicate, JSON.stringify(r1.fills));
  ok('koç: açılış tek başına → koçluk çağrısı yok', kinds('coach') === 0 && r1.coached === 0 && r1.pending === 0);
  ok('koç: açık pozisyon görünümde', coach.view(DAY).open.length === 1 && coach.view(DAY).open[0].qty === 2);

  // 2) Aynı görüntü tekrar: önbellek (Haiku yok, sayaç yok)
  const before = kinds('extract');
  const r1b = await up(img(1), [fill({ px: 1.0, t: DAY + 'T18:00' })]);
  ok('koç: aynı görüntü önbellekten (duplicate, Haiku yok)', r1b.duplicate === true && kinds('extract') === before && r1b.added === 0);
  ok('koç: önbellek yanıtı önceki dolum kimliğini verir', r1b.fills[0]?.id === r1.fills[0].id);

  // 3) Kapanış (ayrı ekran görüntüsü): eşleşir → bir koçluk çağrısı, rapor, net P/L kodda
  const r2 = await up(img(2), [fill({ side: 'sell', px: 4.4, t: DAY + 'T18:40', conf: 'orta' })]);
  ok('koç: kapanış eşleşti → 1 koçluk, bekleyen 0', r2.coached === 1 && r2.pending === 0 && kinds('coach') === 1, JSON.stringify({ c: r2.coached, p: r2.pending, w: r2.warnings }));
  const v2 = coach.view(DAY);
  const t2 = v2.trades[0];
  ok('koç: görünümde tek işlem, rapor hazır', v2.trades.length === 1 && t2.status === 'hazir' && t2.report !== null && v2.open.length === 0, JSON.stringify(v2.trades.map(x => x.status)));
  ok('koç: net P/L kodda (680 − 6 = 674)', t2.report?.header.netPnl === 674 && t2.report?.cikis.karar === 'erken', JSON.stringify(t2.report?.header));
  ok('koç: koçluk çağrısı metin (görüntü bloğu yok)', calls.filter(x => x.kind === 'coach').every(x => x.images === 0));

  // 4) Sırasız yükleme: önce satış (açığa satış gibi görünür), sonra alış (daha erken) → aynı eşleşme, koçluk 1 kez
  const sOut = await up(img(3), [fill({ k: 605, side: 'sell', px: 3.0, q: 1, t: DAY + 'T19:00' })]);
  ok('koç: sırasız — önce satış (açılışı yok): koçluk yok, eşleşmeyen satış', sOut.coached === 0 && coach.view(DAY).orphans.some(o => o.k === 605) && coach.view(DAY).trades.length === 1);
  const bOut = await up(img(4), [fill({ k: 605, side: 'buy', px: 1.0, q: 1, t: DAY + 'T18:30' })]);
  const tr605 = coach.view(DAY).trades.find(x => x.k === 605);
  ok('koç: sırasız — sonra alış (daha erken): işlem giriş 18:30, eşleşmeyen satış kalktı, koçluk 1', !!tr605 && tr605.entryT.endsWith('18:30') && bOut.coached === 1 && kinds('coach') === 2 && coach.view(DAY).orphans.every(o => o.k !== 605), JSON.stringify(tr605));

  // 5) Kısmi çıkış: 4 adet alış, 1 + 3 satış (ayrı ekranlar): tek işlem, çıkış ağırlıklı ortalama 2,75; ilk satıştan sonra açık pozisyon, koçluk yok
  const cK = 610;
  await up(img(5), [fill({ k: cK, px: 1.0, q: 4, t: DAY + 'T17:00' })]);
  const pa = await up(img(6), [fill({ k: cK, side: 'sell', px: 2.0, q: 1, t: DAY + 'T17:10' })]);
  const openK = coach.view(DAY).open.find(o => o.k === cK);
  ok('koç: kısmi çıkış → açık pozisyon kalan 3 / kapanan 1, koçluk yok', !!openK && openK.qty === 3 && openK.closedQty === 1 && pa.coached === 0);
  const pb = await up(img(7), [fill({ k: cK, side: 'sell', px: 3.0, q: 3, t: DAY + 'T17:20' })]);
  const tK = coach.view(DAY).trades.find(x => x.k === cK);
  ok('koç: kısmi çıkışlar tek işlemde (qty 4, çıkış ort. 2,75, 2 bacak)', !!tK && tK.qty === 4 && Math.abs(tK.exitPx - 2.75) < 1e-9 && tK.legs === 2 && pb.coached === 1, JSON.stringify(tK));

  // 6) Koçluk hatası: yükleme yine başarılı, bekleyen 1; sonra kurtarma (süre dolunca /process)
  coachBroken = true;
  const cF = 615;
  await up(img(8), [fill({ k: cF, px: 1.0, q: 1, t: DAY + 'T18:05' })]);
  const rf = await up(img(9), [fill({ k: cF, side: 'sell', px: 1.5, q: 1, t: DAY + 'T18:15' })]);
  ok('koç: koçluk hatası yüklemeyi bozmaz; uyarı + bekleyen 1', rf.added === 1 && rf.coached === 0 && rf.pending === 1 && rf.warnings.length === 1, JSON.stringify(rf.warnings));
  coachBroken = false;
  const proc1 = await coach.process(DAY);
  ok('koç: hata sonrası hemen tekrar denenmez (1 sa bekleme)', proc1.processed === 0 && proc1.errors.length === 1);
  clock += 3600_000 + 1000;
  const proc2 = await coach.process(DAY);
  ok('koç: süre dolunca /process koçluğu tamamlar', proc2.processed === 1 && proc2.pending === 0 && coach.view(DAY).pending === 0, JSON.stringify(proc2));

  // 7) Karne (günün raporlarından) ve görünüm
  const kr = await coach.karne(DAY);
  ok('koç: karne üretildi ve kaydedildi', (kr.karne as { yarinOdak: string }).yarinOdak.length > 0 && store.coachKarneOn(DAY) != null);
  ok('koç: karne yok gün → 404', await coach.karne('2026-11-01').then(() => false, e => e instanceof CoachError && e.status === 404));

  // 8) Hız sınırı: gap (2 sn) ve günlük üst sınır (ayrı örnek, cap 3)
  const cap = new Coach({ cfg: mkCfg({ coachDailyCap: 3 }), store: new Store(':memory:'), f: fake, now: () => clock, log: m => logs.push(m) });
  nextFills = [fill({ px: 1.0 })];
  await cap.coachImage({ image: img(10), mime: 'image/png', day: DAY });
  try { await cap.coachImage({ image: img(11), mime: 'image/png', day: DAY }); ok('koç: 2 sn içinde ikinci yükleme reddedilmeli', false); }
  catch (e) { ok('koç: gap → 429 kind=gap + retryAfterSec', e instanceof CoachError && e.status === 429 && e.extra.kind === 'gap' && typeof e.extra.retryAfterSec === 'number', JSON.stringify((e as CoachError).extra)); }
  clock += 3000;
  await cap.coachImage({ image: img(12), mime: 'image/png', day: DAY });
  clock += 3000;
  await cap.coachImage({ image: img(13), mime: 'image/png', day: DAY });
  clock += 3000;
  try { await cap.coachImage({ image: img(14), mime: 'image/png', day: DAY }); ok('koç: günlük üst sınır (3) aşılmamalı', false); }
  catch (e) { ok('koç: 24 sa sınırı → 429 kind=daily', e instanceof CoachError && e.status === 429 && e.extra.kind === 'daily', JSON.stringify((e as CoachError).extra)); }
  // önbellek sınıra takılmaz
  ok('koç: önbellekli görüntü sınıra takılmaz', (await cap.coachImage({ image: img(10), mime: 'image/png', day: DAY })).duplicate === true);

  // 9) Denetim: GIF reddi, boş dolum → 422, yedek model, anahtarsız 503, anahtar sızıntısı yok
  try { await coach.coachImage({ image: img(15), mime: 'image/gif', day: DAY }); ok('koç: GIF reddedilmeli', false); }
  catch (e) { ok('koç: GIF 400', e instanceof CoachError && e.status === 400); }
  clock += 5000;
  nextFills = [{ tk: 'QQQ' }];
  try { await coach.coachImage({ image: img(16), mime: 'image/png', day: DAY }); ok('koç: geçersiz dolum → 422', false); }
  catch (e) { ok('koç: geçersiz dolum 422 (kısmi kayıt yok)', e instanceof CoachError && e.status === 422); }
  // Araç yanıtı yerine düz metin (JSON yok): 422 + sunucu logunda stop/token/örnek
  extractProse = true; const nLogs = logs.length; clock += 5000;
  try { await coach.coachImage({ image: img(20), mime: 'image/png', day: DAY }); ok('koç: JSON yoksa 422', false); }
  catch (e) { const line = logs.slice(nLogs).find(l => l.includes('dolum çıkarılamadı')) ?? ''; ok('koç: JSON yok → 422 ve log (stop, token, örnek)', e instanceof CoachError && e.status === 422 && line.includes('stop=end_turn') && line.includes('out=12') && line.includes('test görüntüsü') && !line.includes(KEY), line); }
  extractProse = false;
  ok('koç: çıkarma isteği zorunlu araç + max_tokens ≥ 1000', calls.filter(c => c.kind === 'extract').every(c => c.tool === 'record_fills' && c.toolChoice === 'record_fills' && c.maxTokens >= 1000));
  modelReject = true;
  const coachFb = new Coach({ cfg: mkCfg({ coachModel: 'bad-model', coachFallbackModel: 'claude-haiku-5-5' }), store: new Store(':memory:'), f: fake, now: () => clock, log: m => logs.push(m) });
  nextFills = [fill({ px: 1.0 })];
  const fb = await coachFb.coachImage({ image: img(17), mime: 'image/png', day: DAY });
  ok('koç: yedek model devreye girer ve işaretlenir', fb.fallback === true && logs.some(l => l.includes('yedek')));
  const coach3 = new Coach({ cfg: mkCfg({ coachModel: 'bad-model' }), store: new Store(':memory:'), f: fake, now: () => clock, log: m => logs.push(m) });
  try { await coach3.coachImage({ image: img(18), mime: 'image/png', day: DAY }); ok('koç: yedeksiz model reddi hata vermeli', false); }
  catch (e) { ok('koç: yedeksiz model reddi açık hata (sessiz geçiş yok)', e instanceof CoachError && /model reddedildi/.test(e.message) && !e.message.includes(KEY)); }
  modelReject = false;
  const coach4 = new Coach({ cfg: mkCfg({ anthropicKey: '' }), store: new Store(':memory:'), f: fake, now: () => clock, log: m => logs.push(m) });
  try { await coach4.coachImage({ image: img(19), mime: 'image/png', day: DAY }); ok('koç: anahtarsız 503', false); }
  catch (e) { ok('koç: anahtarsız 503', e instanceof CoachError && e.status === 503); }
  const dump = JSON.stringify(coach.view(DAY)) + JSON.stringify(r2) + logs.join('\n');
  ok('koç: anahtar ne yanıtta ne görünümde ne logda', !dump.includes(KEY) && !dump.includes('SELFTEST'));
  ok('koç: çağrı logu durma nedenini (stop=) yazar', logs.some(m => m.includes('koç extract') && m.includes('stop=end_turn')));
  ok('koç: max_tokens çıkarma 1024 / koçluk 3500', calls.filter(x => x.kind === 'extract').every(x => x.maxTokens === 1024) && calls.filter(x => x.kind === 'coach').every(x => x.maxTokens === 3500));
  ok('koç: çıkarma çağrısı tek görüntü', calls.filter(x => x.kind === 'extract').every(x => x.images === 1));
  ok('koç: token kaydı SQLite\'ta (çıkarma + koçluk)', store.coachUsageOn(DAY).calls > 0 && store.coachUsageOn(DAY).inTok > 0);
  store.close();
}

// ───── Örnek rapor: example bayrağı, yalnız örnek silme, nokta-zamanlı akış sorgusu ─────
{
  const st = new Store(':memory:');
  const DAYX = '2026-11-13';
  st.insertReport({ key: 'ornek:' + DAYX + ':premarket', kind: 'premarket', day: DAYX, ts: 1, title: 'Örnek · x', body: 'b', pushTitle: 'p', pushBody: 'b', example: true });
  st.insertReport({ key: DAYX + ':intra1', kind: 'intra1', day: DAYX, ts: 2, title: 'gerçek', body: 'b', pushTitle: 'p', pushBody: 'b' });
  const rows = st.listReports(10);
  ok('örnek: example=true ve gerçek example=false döner', rows.some(r => r.title === 'Örnek · x' && r.example === true) && rows.some(r => r.title === 'gerçek' && r.example === false));
  ok('örnek: silme yalnız örnek satırı (gerçek rapor kalır)', st.deleteExampleReport('ornek:' + DAYX + ':premarket') === 1 && st.deleteExampleReport(DAYX + ':intra1') === 0 && st.listReports(10).length === 1);
  st.insertEvent({ ts: 100, day: DAYX, ticker: 'QQQ', occ: 'O1', expiry: DAYX, side: 'call', strike: 500, dv: 10, volume: 10, oi: 1, bid: 1, ask: 1.1, mid: 1.05, prem: 1000, volOi: 10, confirmed: true, wide: false, pushed: false, underlying: 500 } as never);
  st.insertEvent({ ts: 900, day: DAYX, ticker: 'QQQ', occ: 'O1', expiry: DAYX, side: 'call', strike: 500, dv: 5, volume: 15, oi: 1, bid: 1, ask: 1.1, mid: 1.05, prem: 500, volOi: 10, confirmed: true, wide: false, pushed: false, underlying: 500 } as never);
  ok('nokta-zamanlı akış: ts < 500 yalnız ilk olay (dV 10)', st.flowAgg(DAYX, 500).reduce((a, x) => a + x.contracts, 0) === 10);
  ok('akış yok (poll kaydı yok) → pollSeenBefore false', !st.pollSeenBefore('2026-11-16', 1e15) && st.pollSeenBefore(DAYX, 500));
  st.close();
}

main().then(() => {
  console.log(fail ? `\n${fail} SUNUCU TESTİ BAŞARISIZ` : '\nSunucu öz-testi geçti');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('öz-test hatası:', e); process.exit(1); });
