/*
 * Giriş noktası.
 *   node server/app/main.ts                       — servis (systemd bunu çalıştırır)
 *   node server/app/main.ts --dry-run             — planı ve kredi tahminini yaz; MarketData'ya İSTEK ATMAZ
 *   node server/app/main.ts --dry-run --fixture server/fixtures/synthetic-chain.json
 *                                                  — tespiti sentetik yanıtlarla uçtan uca çalıştır (ağ yok)
 */
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { loadConfig, publicConfig, type Config } from './config.ts';
import { Store } from './store.ts';
import { MdClient } from './md.ts';
import { Poller, type PushSender } from './poller.ts';
import { ExpoPush } from './push.ts';
import { createHandler } from './http.ts';
import { FixtureSource, type FixturePoll } from './fixture.ts';
import { estimateCredits, planPoll } from '../../src/lib/flow/plan.ts';
import { flowExpiries } from '../../src/lib/flow/expiry.ts';
import { fmtIst, contractLabel } from '../../src/lib/flow/model.ts';

const log = (m: string) => console.log(`${new Date().toISOString()} ${m}`);
const args = process.argv.slice(2);
const argVal = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };

function dryRun(cfg: Config): Promise<void> | void {
  const fixturePath = argVal('--fixture');
  const now = Date.now();
  const plan = planPoll(now, cfg.tickers, cfg.intervalMin);
  const est = estimateCredits({ tickers: cfg.tickers.length, intervalMin: cfg.intervalMin, confirmsPerPoll: cfg.confirmsPerPoll });
  console.log('— Yapılandırma (sırsız):', JSON.stringify(publicConfig(cfg)));
  console.log('— Vadeler (bugün 0DTE + 3 ay Cuma; tatil Cuması → Perşembe):');
  for (const t of flowExpiries(now)) console.log(`   ${t.date}  dte=${t.dte}${t.zero ? '  (0DTE)' : ''}`);
  console.log(`— Poll başına planlanan MarketData istekleri (${plan.requests.length}; kredi ${plan.creditsCached}):`);
  for (const r of plan.requests) console.log(`   GET ${r.path}?dte=${r.query.dte}&mode=${r.query.mode}&maxage=${r.query.maxage}`);
  console.log(`— Günlük kredi tahmini (${cfg.intervalMin} dk aralık, piyasa saati ${est.polls} poll):`);
  console.log(`   önbellekli: ${est.cachedPerDay}   canlı teyit tavanı: ${est.confirmMaxPerDay}   toplam tavan: ${est.totalMaxPerDay}   (akış sınırı ${cfg.flowDailyCap})`);
  if (est.totalMaxPerDay > cfg.flowDailyCap) console.log('   UYARI: tahmin akış sınırını aşıyor');
  if (!fixturePath) return console.log('— Fixture verilmedi: tespit çalıştırılmadı (sentetik veri için --fixture).');

  const polls = JSON.parse(readFileSync(fixturePath, 'utf8')).polls as FixturePoll[];
  const src = new FixtureSource(polls);
  const store = new Store(':memory:');
  const poller = new Poller(cfg, store, src, null, () => {});
  return (async () => {
    for (let i = 0; i < polls.length; i++) {
      src.i = i;
      const at = Date.parse(polls[i].at);
      const st = await poller.pollOnce(at, { force: true });
      console.log(`— Tarama ${fmtIst(at)} İST: ${Object.entries(st.tickers).map(([k, v]) => `${k}:${v}`).join(', ')} | aday ${st.candidates}, teyitli ${st.confirmed}, teyitsiz ${st.unconfirmed}`);
      for (const e of store.listEvents({ limit: 50 }).filter(x => x.ts === at).reverse())
        console.log(`   · ${contractLabel(e)}  dV=${e.dv}  mid=${e.mid.toFixed(2)}  prim≈${Math.round(e.prem)} $  ${e.confirmed ? 'teyitli' : 'teyitsiz'}${e.wide ? ' geniş-spread' : ''}`);
    }
    console.log(`— Fixture bitti. Gerçek MarketData çağrısı: 0 (chain ${src.calls.chain}, quote ${src.calls.quote} sentetik)`);
    store.close();
  })();
}

async function serve(cfg: Config) {
  if (!cfg.mdToken) log('UYARI: MarketData tokenı yok (md_token) — proxy ve akış çalışmaz');
  if (!cfg.appKey) log('UYARI: uygulama anahtarı yok (app_key) — tüm uç noktalar 401 döner');
  const store = new Store(cfg.dbPath);
  const md = new MdClient(cfg.mdToken, store, { flowDailyCap: cfg.flowDailyCap, proxyDailyCap: cfg.proxyDailyCap, creditReserve: cfg.creditReserve });
  const push: PushSender = new ExpoPush(store, cfg.expoAccessToken, fetch, log);
  const poller = new Poller(cfg, store, {
    chain: (ticker, q, nowMs) => md.get(`/options/chain/${ticker}/?dte=${encodeURIComponent(q.dte)}&mode=cached&maxage=${encodeURIComponent(q.maxage)}`, 'flow', { nowMs }),
    quote: (occ, nowMs) => md.get(`/options/quotes/${occ}/`, 'flow', { nowMs }),
  }, push, log);
  const handler = createHandler({ cfg, store, md, poller });
  const server = createServer((req, res) => { void handler(req, res); });
  server.listen(cfg.port, cfg.host, () => log(`dinleniyor ${cfg.host}:${cfg.port}`));
  const timer = poller.start();
  log(`tarayıcı: ${cfg.pollEnabled ? 'açık' : 'kapalı'}, ${cfg.intervalMin} dk, ${cfg.tickers.join(' ')}`);
  const stop = () => { clearInterval(timer); server.close(); store.close(); log('kapanıyor'); process.exit(0); };
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}

const cfg = loadConfig(process.env);
if (args.includes('--dry-run')) {
  Promise.resolve(dryRun(cfg)).catch(e => { console.error('dry-run hatası:', (e as Error).message); process.exit(1); });
} else {
  serve(cfg).catch(e => { console.error('başlatma hatası:', (e as Error).message); process.exit(1); });
}
