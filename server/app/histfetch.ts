/*
 * Tarihsel (EOD) opsiyon zinciri çekimi — YALNIZ sunucuda, TEK MarketData istemcisi (md.ts) üzerinden (tek IP kuralı).
 *
 *   node server/app/histfetch.ts --date 2026-11-12 --report-day 2026-11-13 [--tickers QQQ,SPY] [--max-credits 450]
 *
 * --date: zincir tarihi (önceki kapanış, 16:00 ET verisi). --report-day: vade kümesinin ait olduğu işlem günü (akışla aynı:
 * 0DTE + 3 ay içindeki Cuma vadeleri). Her ticker × vade için ayrı istek (`expiration=`): yalnız hedef vadeler ücretlenir.
 * Yalnız özet yazılır (duvar + en büyük OI birikimi → hist_chain tablosu); ham zincir saklanmaz. Token burada yazdırılmaz;
 * kredi MdClient tarafından DB'ye kaydedilir (yanıt başlığı x-api-ratelimit-consumed).
 * Hata: 401/402/403/429 → tüm çalıştırma durur. Diğer ticker hatası → o ticker atlanır, not düşülür.
 */
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { MdClient, mdErrorText } from './md.ts';
import { parseChainRows } from '../../src/lib/flow/rows.ts';
import type { ChainRow } from '../../src/lib/flow/detect.ts';
import { histExpiries, histSnapshot, type HistSnap } from '../../src/lib/reports/histchain.ts';
import { closeMs, isTradingDay } from '../../src/lib/usmarket.ts';
import { errText } from './poller.ts';

const args = process.argv.slice(2);
const argVal = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const log = (m: string) => console.log(m);
const STOP_STATUS = new Set([401, 402, 403, 429]);
/** Çalıştırmayı durdurur (kredi tavanı, yetki/kota hatası): ticker bazlı hata yutulmaz */
class StopError extends Error {}

async function main(): Promise<void> {
  const date = argVal('--date') ?? '', reportDay = argVal('--report-day') ?? '';
  const re = /^\d{4}-\d{2}-\d{2}$/;
  if (!re.test(date) || !re.test(reportDay)) throw new Error('kullanım: --date YYYY-MM-DD --report-day YYYY-MM-DD [--tickers A,B] [--max-credits N]');
  if (!isTradingDay(date)) throw new Error(`${date} bir ABD işlem günü değil`);
  const cfg = loadConfig(process.env);
  if (!cfg.mdToken) throw new Error('MarketData tokenı yüklenmedi (LoadCredential md_token)');
  const tickers = (argVal('--tickers') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const list = tickers.length ? tickers : cfg.tickers;
  const maxCredits = Number(argVal('--max-credits') ?? 450);
  const store = new Store(cfg.dbPath);
  const md = new MdClient(cfg.mdToken, store, { flowDailyCap: cfg.flowDailyCap, proxyDailyCap: cfg.proxyDailyCap, creditReserve: cfg.creditReserve });
  const expiries = histExpiries(reportDay);
  const asOf = closeMs(date);
  let total = 0;
  log(`geçmiş zincir ${date} (kapanış 16:00 ET); vade kümesi ${reportDay}: ${expiries.length} vade; ${list.join(', ')}; kredi tavanı ${maxCredits}`);

  for (const t of list) {
    const rows: ChainRow[] = [];
    const got: string[] = [];
    let credits = 0;
    let note = '';
    try {
      for (const e of expiries) {
        if (total >= maxCredits) throw new StopError(`kredi tavanı (${maxCredits}) doldu; durduruldu`);
        const r = await md.get(`/options/chain/${t}/?date=${date}&expiration=${e}`, 'proxy', { timeoutMs: 60000 });
        total += r.consumed; credits += r.consumed;
        if (r.status === 204 || r.json?.s === 'no_data') continue;
        if (!(r.status === 200 || r.status === 203)) {
          const msg = mdErrorText(r.status, r.json);
          if (STOP_STATUS.has(r.status)) throw new StopError(`${msg} (${t} ${e}) — tüm çalıştırma durdu`);
          note = `${e}: ${msg}`;
          continue;
        }
        const parsed = parseChainRows(r.json).filter(x => x.expiry === e);
        if (parsed.length) got.push(e);
        rows.push(...parsed);
      }
    } catch (e) {
      if (e instanceof StopError) throw e;
      note = errText(e);
    }
    if (!rows.length) { log(`  ${t}: veri yok${note ? ` (${note})` : ''}; kredi ${credits}`); continue; }
    const { wall, flow } = histSnapshot(rows, reportDay, asOf);
    const snap: HistSnap = { srcDay: date, reportDay, asOf, expiries: got, rows: rows.length, wall, flow };
    store.histPut(date, t, asOf, snap);
    log(`  ${t}: vade ${got.length}/${expiries.length}, satır ${rows.length}, duvar ${wall ? 'var' : 'yok'}, birikim ${flow.length}, kredi ${credits}${note ? ` · not: ${note}` : ''}`);
  }
  log(`toplam tüketilen kredi (yanıt başlıkları): ${total}; son kalan (başlık): ${md.lastRemaining ?? 'bilinmiyor'}`);
  store.close();
}

main().catch(e => { console.error('geçmiş zincir hatası:', errText(e)); process.exit(1); });
