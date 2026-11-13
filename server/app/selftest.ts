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

  // 5) Bütçe freni: token yok → MarketData'ya HİÇ istek atılmaz
  let fetched = 0;
  const md = new MdClient('', new Store(':memory:'), { flowDailyCap: 10, proxyDailyCap: 10, creditReserve: 1 }, (async () => { fetched++; return new Response('{}'); }) as typeof fetch);
  let blocked = false;
  try { await md.get('/stocks/quotes/SPY/', 'proxy'); } catch (e) { blocked = e instanceof BudgetError; }
  ok('bütçe: tokensız çağrı engellenir, ağa çıkılmaz', blocked && fetched === 0);
}

main().then(() => {
  console.log(fail ? `\n${fail} SUNUCU TESTİ BAŞARISIZ` : '\nSunucu öz-testi geçti');
  process.exit(fail ? 1 : 0);
}).catch(e => { console.error('öz-test hatası:', e); process.exit(1); });
