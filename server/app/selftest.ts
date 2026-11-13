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

/** 6) Koç uçtan uca (SAHTE Anthropic + Yahoo; ağ YOK, ücret YOK): çıkarma → bağlam → koçluk → karne, token kaydı, yedek model, sızıntı yok */
async function coachSelftest() {
  const KEY = 'sk-ant-SELFTEST-0000';
  const DAY = '2026-11-13';
  const NOW = Date.UTC(2026, 10, 14, 15, 0);   // Cumartesi 18:00 İst
  const extractJson = { trades: [{ ticker: 'QQQ', side: 'CALL', strike: 600, expiry: DAY, qty: 2, entryTime: DAY + 'T18:00', entryPrice: 1.0, exitTime: DAY + 'T18:40', exitPrice: 4.4, status: 'kapali', confidence: 'yuksek' }], okunamadi: null };
  const coachJson = { feedback: [{ index: 0, neYaptin: 'QQQ call aldın, 4,40\'ta çıktın.', dogruMu: 'evet', dogruAciklama: 'Hedef bölgesinde çıktın.', neden: 'Varsayım: kâr almak istedin.', birDahakine: 'Hedefi önceden not al.', cikis: 'dogru', etiketler: ['duygusal', 'uydurma'] }] };
  const karneJson = { ozet: 'Tek işlem, hedefte çıkış.', guclu: ['Pencere içi giriş'], tekrarlayanHata: [], yarinOdak: 'Hedefi işlem öncesi yaz.' };
  const bars: unknown[] = [], ts: number[] = [], o: number[] = [], h: number[] = [], l: number[] = [], c: number[] = [], v: number[] = [];
  for (let t = Date.UTC(2026, 10, 13, 14, 30); t <= Date.UTC(2026, 10, 13, 21, 0); t += 60000) {
    const i = ts.length; ts.push(t / 1000); const px = 600 + (i % 7) * 0.05;
    o.push(px); h.push(px + 0.2); l.push(px - 0.2); c.push(px + 0.05); v.push(1000 + (i === 250 ? 9000 : 0));
  }
  const yahoo = { chart: { result: [{ timestamp: ts, indicators: { quote: [{ open: o, high: h, low: l, close: c, volume: v }] } }] } };
  const calls: { model: string; key: string; system: string; maxTokens: number }[] = [];
  let modelReject = false;
  const fake = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u === ANTHROPIC_URL) {
      const body = JSON.parse(String(init?.body));
      const key = String((init?.headers as Record<string, string>)['x-api-key']);
      calls.push({ model: body.model, key, system: body.system, maxTokens: body.max_tokens });
      if (modelReject && body.model === 'bad-model') return new Response(JSON.stringify({ type: 'error', error: { type: 'not_found_error', message: 'model: bad-model not found' } }), { status: 404 });
      const payload = body.system.includes('GÖREV: Her işlem') ? coachJson : body.system.includes('Midas') ? extractJson : karneJson;
      return new Response(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(payload) }], usage: { input_tokens: 100, output_tokens: 50 }, stop_reason: 'end_turn' }), { status: 200 });
    }
    if (u.startsWith('https://query1.finance.yahoo.com/')) return new Response(JSON.stringify(yahoo), { status: 200 });
    return new Response('{}', { status: 404 });
  }) as typeof fetch;

  const logs: string[] = [];
  const mkCfg = (over: Record<string, unknown> = {}) => ({ ...loadConfig({ FLOW_DB: ':memory:', CREDENTIALS_DIRECTORY: '/nonexistent' }), anthropicKey: KEY, coachModel: 'claude-haiku-5-5', coachFallbackModel: '', coachDailyCap: 20, coachMinGapSec: 10, ...over });
  const png = 'iVBORw0KGgoAAAANSUhEUg==';
  const store = new Store(':memory:');
  const coach = new Coach({ cfg: mkCfg(), store, f: fake, now: () => NOW, log: m => logs.push(m) });
  const r = await coach.coachImage({ image: png, mime: 'image/png', day: DAY });
  ok('koç: işlem çıkarıldı (1)', r.trades.length === 1 && r.trades[0].trade.ticker === 'QQQ');
  ok('koç: geri bildirim doğrulandı', r.trades[0].feedback?.cikis === 'dogru' && r.warning === null);
  ok('koç: kurallar ve bağlam (duvar/akış yok → veri eksik listesi)', r.trades[0].rules.length >= 3 && r.trades[0].noData.some(x => x.includes('duvar')));
  ok('koç: iki Haiku çağrısı, aynı model, anahtar başlıkta', calls.length === 2 && calls.every(x => x.model === 'claude-haiku-5-5' && x.key === KEY));
  ok('koç: token kullanımı toplanır (2 × 150)', r.usage.inTok === 200 && r.usage.outTok === 100, JSON.stringify(r.usage));
  ok('koç: token kaydı SQLite\'ta', store.coachUsageOn(DAY).calls === 2 && store.coachUsageOn(DAY).inTok === 200);
  const dump = JSON.stringify(r) + logs.join('\n');
  ok('koç: anahtar ne yanıtta ne logda', !dump.includes(KEY) && !dump.includes('SELFTEST'));
  ok('koç: max_tokens sınırları (900 / 2000)', calls[0].maxTokens === 900 && calls[1].maxTokens === 2000);

  // Hız sınırı: aynı anda ikinci istek 429
  try { await coach.coachImage({ image: png, mime: 'image/png', day: DAY }); ok('koç: 10 sn içinde ikinci istek reddedilmeli', false); }
  catch (e) { ok('koç: 10 sn içinde ikinci istek 429', e instanceof CoachError && e.status === 429); }
  // Görüntü denetimi
  try { await coach.coachImage({ image: png, mime: 'image/gif', day: DAY }); ok('koç: GIF reddedilmeli', false); }
  catch (e) { ok('koç: GIF 400', e instanceof CoachError && e.status === 400); }

  // Karne ve görünüm
  const kr = await coach.karne(DAY);
  ok('koç: karne üretildi ve kaydedildi', (kr.karne as { yarinOdak: string }).yarinOdak.length > 0 && store.coachKarneOn(DAY) != null);
  ok('koç: GET görünümü işlem + karne', coach.view(DAY).trades.length === 1 && coach.view(DAY).karne != null);
  try { await coach.karne('2026-11-01'); ok('koç: kayıtsız gün 404', false); }
  catch (e) { ok('koç: kayıtsız gün 404', e instanceof CoachError && e.status === 404); }

  // Yedek model: yalnız açıkça tanımlıysa, loglanır ve işaretlenir
  modelReject = true;
  const coach2 = new Coach({ cfg: mkCfg({ coachModel: 'bad-model', coachFallbackModel: 'claude-haiku-5-5' }), store: new Store(':memory:'), f: fake, now: () => NOW, log: m => logs.push(m) });
  const fb = await coach2.coachImage({ image: png, mime: 'image/png', day: DAY });
  ok('koç: yedek model devreye girer ve işaretlenir', fb.fallback === true && logs.some(l => l.includes('yedek')));
  // Yedek tanımsızsa: açık hata, sessiz geçiş yok
  const coach3 = new Coach({ cfg: mkCfg({ coachModel: 'bad-model' }), store: new Store(':memory:'), f: fake, now: () => NOW, log: m => logs.push(m) });
  try { await coach3.coachImage({ image: png, mime: 'image/png', day: DAY }); ok('koç: yedeksiz model reddi hata vermeli', false); }
  catch (e) { ok('koç: yedeksiz model reddi açık hata (sessiz geçiş yok)', e instanceof CoachError && /model reddedildi/.test(e.message) && !(e.message.includes(KEY))); }
  // Anahtar yoksa: 503
  const coach4 = new Coach({ cfg: mkCfg({ anthropicKey: '' }), store: new Store(':memory:'), f: fake, now: () => NOW, log: m => logs.push(m) });
  try { await coach4.coachImage({ image: png, mime: 'image/png', day: DAY }); ok('koç: anahtarsız 503', false); }
  catch (e) { ok('koç: anahtarsız 503', e instanceof CoachError && e.status === 503); }
  store.close();
}

main().then(() => {
  console.log(fail ? `\n${fail} SUNUCU TESTİ BAŞARISIZ` : '\nSunucu öz-testi geçti');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('öz-test hatası:', e); process.exit(1); });
