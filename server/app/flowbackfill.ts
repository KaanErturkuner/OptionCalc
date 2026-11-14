/*
 * Geçmiş bir işlem gününün akış olaylarını gerçek MarketData verisinden yeniden kurar.
 * YALNIZ sunucuda, TEK MarketData istemcisi (md.ts). Push GÖNDERİLMEZ. Uydurma değer yok.
 *
 *   node server/app/flowbackfill.ts --day 2026-11-13 [--dry-run] [--max-credits 50000] [--tickers QQQ,SPY]
 *
 * Yöntem:
 *  1) Tarihsel zincir (`date=`): 1000 sembol / 1 kredi. Cuma oturumu bazı planlarda pazartesi
 *     09:30 ET'ye kadar tarihsel sayılmaz → 402 / no_data olabilir.
 *  2) Olmazsa `mode=eod` + vade + minVolume=200 (sembol başı 1 kredi). Yalnız `updated` istenen
 *     güne aitse kabul edilir.
 *  3) Opsiyon mumu / gün içi kotasyon dokümanda yok; bir kez yoklanır. Varsa 2 dk dV kurulur.
 *     Yoksa kontrat başına tek olay, zaman = kapanış 16:00 ET (gün içi an uydurulmaz).
 *  4) Eşikler canlı tarayıcıyla aynı. Vade kümesi de aynı: 0DTE + 3 ay Cuma.
 *  5) Olaylar reconstructed=1. Aynı günün önceki yeniden kurulan olayları silinir (canlıya dokunulmaz).
 *     Tam (date=) zincirde hist_chain özeti de yazılır (ek kredi yok).
 *
 * Token yazdırılmaz. 401/403/429 → dur. date= 402'si eod yedeklemesine düşer.
 */
import { loadConfig } from './config.ts';
import { Store } from './store.ts';
import { MdClient, mdErrorText } from './md.ts';
import { parseChainRows } from '../../src/lib/flow/rows.ts';
import type { ChainRow } from '../../src/lib/flow/detect.ts';
import { DEFAULT_THRESHOLDS } from '../../src/lib/flow/model.ts';
import {
  cumulativeFromIncrements, eodFlowEvents, eventsFromCumulativeVolume, type IncBar, type ReconstructedEvent,
} from '../../src/lib/flow/reconstruct.ts';
import { histExpiries, histSnapshot, type HistSnap } from '../../src/lib/reports/histchain.ts';
import { closeMs, etDate, isTradingDay } from '../../src/lib/usmarket.ts';
import { errText } from './poller.ts';

const args = process.argv.slice(2);
const argVal = (k: string) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const DRY = args.includes('--dry-run');
const log = (m: string) => console.log(m);
const STOP_STATUS = new Set([401, 403, 429]);
class StopError extends Error {}

type ChainMode = 'date' | 'eod';

function sessionDay(rows: ChainRow[]): string | null {
  const ts = rows.map(r => r.updated).filter(t => t > 0);
  if (!ts.length) return null;
  const mid = ts.slice().sort((a, b) => a - b)[Math.floor(ts.length / 2)];
  return etDate(mid);
}

function parseCandleBars(j: any): IncBar[] {
  if (!j || j.s === 'no_data' || j.s === 'error') return [];
  const t = Array.isArray(j.t) ? j.t : Array.isArray(j.time) ? j.time : [];
  const v = Array.isArray(j.v) ? j.v : Array.isArray(j.volume) ? j.volume : [];
  if (!t.length || t.length !== v.length) return [];
  const out: IncBar[] = [];
  for (let i = 0; i < t.length; i++) {
    let ts = Number(t[i]);
    if (!Number.isFinite(ts)) continue;
    if (ts < 1e12) ts *= 1000; // saniye → ms
    const vol = Number(v[i]);
    if (!Number.isFinite(vol)) continue;
    out.push({ t: ts, volume: vol });
  }
  return out.sort((a, b) => a.t - b.t);
}

async function main(): Promise<void> {
  const day = argVal('--day') ?? '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('kullanım: --day YYYY-MM-DD [--dry-run] [--max-credits N] [--tickers A,B]');
  if (!isTradingDay(day)) throw new Error(`${day} bir ABD işlem günü değil`);
  const cfg = loadConfig(process.env);
  if (!cfg.mdToken) throw new Error('MarketData tokenı yüklenmedi (LoadCredential md_token)');
  const tickers = (argVal('--tickers') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
  const list = tickers.length ? tickers : cfg.tickers;
  const maxCredits = Number(argVal('--max-credits') ?? 50000);
  const store = new Store(cfg.dbPath);
  const md = new MdClient(cfg.mdToken, store, { flowDailyCap: maxCredits, proxyDailyCap: maxCredits, creditReserve: cfg.creditReserve });
  const expiries = histExpiries(day);
  const asOf = closeMs(day);
  const th = cfg.thresholds;
  let total = 0;
  const bump = (n: number) => { total += n; if (total >= maxCredits) throw new StopError(`kredi tavanı (${maxCredits}) doldu; durduruldu`); };

  log(`akış geri doldurma ${day} (kapanış 16:00 ET); vade ${expiries.length}: ${expiries.join(', ')}`);
  log(`ticker: ${list.join(', ')}; kredi tavanı ${maxCredits}${DRY ? '; DRY-RUN (DB yazılmaz)' : ''}`);
  log(`eşikler: minPremium=${th.minPremium} minVolume=${th.minVolume} minVolOi=${th.minVolOi} minMid=${th.minMid}`);

  // ── 1) tarihsel date= yoklaması (ucuz) ──
  let mode: ChainMode | null = null;
  {
    const probeExp = expiries[0];
    const r = await md.get(`/options/chain/${list[0]}/?date=${day}&expiration=${probeExp}`, 'proxy', { timeoutMs: 60000 });
    bump(r.consumed);
    log(`yoklama date= ${list[0]} ${probeExp}: HTTP ${r.status} kredi ${r.consumed} kalan ${r.remaining ?? '?'}`);
    if (STOP_STATUS.has(r.status)) throw new StopError(`${mdErrorText(r.status, r.json)} — durdu`);
    if ((r.status === 200 || r.status === 203) && r.json?.s !== 'no_data') {
      const rows = parseChainRows(r.json).filter(x => x.expiry === probeExp);
      const sd = sessionDay(rows);
      if (rows.length && (sd === day || sd == null)) {
        mode = 'date';
        log(`  tarihsel zincir kullanılacak (${rows.length} satır${sd ? `, updated gün=${sd}` : ''})`);
      } else {
        log(`  date= yanıtı istenen güne ait değil (updated=${sd ?? 'yok'}); eod yedeği denenecek`);
      }
    } else {
      log(`  date= kullanılamadı (${r.status === 402 ? mdErrorText(402, r.json) : r.json?.s ?? r.status}); eod yedeği denenecek`);
    }
  }

  // ── 2) eod yoklaması (pahalı olabilir; dar filtre) ──
  if (!mode) {
    const probeExp = expiries[0];
    const r = await md.get(`/options/chain/${list[0]}/?mode=eod&expiration=${probeExp}&strikeLimit=2`, 'proxy', { timeoutMs: 60000 });
    bump(r.consumed);
    log(`yoklama mode=eod ${list[0]} ${probeExp} strikeLimit=2: HTTP ${r.status} kredi ${r.consumed} kalan ${r.remaining ?? '?'}`);
    if (STOP_STATUS.has(r.status)) throw new StopError(`${mdErrorText(r.status, r.json)} — durdu`);
    if (!((r.status === 200 || r.status === 203) && r.json?.s !== 'no_data')) {
      throw new StopError(`${day} kapanış zinciri henüz yok (tarihsel pazartesi 09:30 ET'de açılır). Uydurma veri yazılmadı.`);
    }
    const rows = parseChainRows(r.json);
    const sd = sessionDay(rows);
    if (sd && sd !== day) {
      throw new StopError(`mode=eod ${sd} verisi döndü, istenen gün ${day} değil. Yazılmadı.`);
    }
    mode = 'eod';
    log(`  mode=eod kullanılacak (${rows.length} satır, updated gün=${sd ?? 'bilinmiyor'}; minVolume=${th.minVolume} ile çekilecek)`);
  }

  // ── 3) tüm ticker × vade ──
  const byTicker = new Map<string, ChainRow[]>();
  const notes: string[] = [];
  for (const t of list) {
    const rows: ChainRow[] = [];
    const got: string[] = [];
    let credits = 0;
    try {
      for (const e of expiries) {
        if (total >= maxCredits) throw new StopError(`kredi tavanı (${maxCredits}) doldu; durduruldu`);
        const q = mode === 'date'
          ? `/options/chain/${t}/?date=${day}&expiration=${e}`
          : `/options/chain/${t}/?mode=eod&expiration=${e}&minVolume=${th.minVolume}`;
        const r = await md.get(q, 'proxy', { timeoutMs: 60000 });
        bump(r.consumed); credits += r.consumed;
        if (r.status === 204 || r.json?.s === 'no_data') continue;
        if (!(r.status === 200 || r.status === 203)) {
          const msg = mdErrorText(r.status, r.json);
          if (STOP_STATUS.has(r.status)) throw new StopError(`${msg} (${t} ${e}) — durdu`);
          notes.push(`${t} ${e}: ${msg}`);
          continue;
        }
        let parsed = parseChainRows(r.json).filter(x => x.expiry === e);
        if (mode === 'eod') {
          const sd = sessionDay(parsed);
          if (sd && sd !== day) { notes.push(`${t} ${e}: eod günü ${sd}, atlandı`); continue; }
        }
        if (parsed.length) got.push(e);
        rows.push(...parsed);
      }
    } catch (e) {
      if (e instanceof StopError) throw e;
      notes.push(`${t}: ${errText(e)}`);
    }
    byTicker.set(t, rows);
    log(`  ${t}: vade ${got.length}/${expiries.length}, satır ${rows.length}, kredi ${credits}`);
  }

  // ── 4) EOD olayları ──
  const allRows = [...byTicker.values()].flat();
  let events: ReconstructedEvent[] = eodFlowEvents(allRows, day, asOf, th);
  log(`EOD eşik geçen kontrat: ${events.length} (satır ${allRows.length})`);

  // ── 5) gün içi mum yoklaması (dokümanda yok; 1 istek) ──
  let candleOk = false;
  const probeOcc = events[0]?.occ;
  if (probeOcc) {
    const from = `${day}T09:30:00-05:00`;
    const to = `${day}T16:00:00-05:00`;
    const path = `/options/candles/5/${probeOcc}/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    try {
      const r = await md.get(path, 'proxy', { timeoutMs: 30000 });
      bump(r.consumed);
      const bars = parseCandleBars(r.json);
      log(`yoklama mum ${probeOcc}: HTTP ${r.status} kredi ${r.consumed} çubuk ${bars.length}`);
      candleOk = (r.status === 200 || r.status === 203) && bars.length >= 2;
      if (r.status === 401 || r.status === 403 || r.status === 429) throw new StopError(mdErrorText(r.status, r.json));
    } catch (e) {
      if (e instanceof StopError) throw e;
      log(`yoklama mum: ${errText(e)} — gün içi zaman damgası yok, kapanış kullanılacak`);
    }
  }

  if (candleOk && probeOcc) {
    const from = `${day}T09:30:00-05:00`;
    const to = `${day}T16:00:00-05:00`;
    const timed: ReconstructedEvent[] = [];
    let candleCredits = 0, candleFail = 0;
    // Yalnız eşikleri gün toplamıyla geçen kontratlar (sadık + bütçe)
    for (const ev of events) {
      if (total >= maxCredits) { notes.push('mum çekimi kredi tavanında kesildi'); break; }
      const row = allRows.find(x => x.occ === ev.occ);
      if (!row) continue;
      try {
        const r = await md.get(`/options/candles/5/${ev.occ}/?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, 'proxy', { timeoutMs: 30000 });
        bump(r.consumed); candleCredits += r.consumed;
        if (!(r.status === 200 || r.status === 203)) { candleFail++; continue; }
        const inc = parseCandleBars(r.json);
        if (inc.length < 2) { candleFail++; continue; }
        const dayBars = inc.filter(b => etDate(b.t) === day);
        const evs = eventsFromCumulativeVolume(row, cumulativeFromIncrements(dayBars), day, { ...th, ...{ /* same */ } }, { intervalMin: 2, cooldownMin: cfg.cooldownMin });
        // Çubuk hacmi zaten artış ise cumulativeFromIncrements doğru; eğer API kümülatif veriyorsa
        // ikinci kez biriktirmek şişirir. Kontrol: son çubuk toplamı satır hacmine yakınsa kümülatif kabul et.
        const last = dayBars[dayBars.length - 1]?.volume ?? 0;
        const use = (row.volume > 0 && last >= row.volume * 0.7 && last <= row.volume * 1.3)
          ? eventsFromCumulativeVolume(row, dayBars, day, th, { intervalMin: 2, cooldownMin: cfg.cooldownMin })
          : evs;
        if (use.length) timed.push(...use);
        else timed.push(ev); // çubuk eşik üretmezse EOD olayını koru (gerçek hacim var)
      } catch (e) {
        if (e instanceof StopError) throw e;
        candleFail++;
        timed.push(ev);
      }
    }
    log(`mum ile zaman damgası: ${timed.length} olay (${events.length} kontrat, başarısız ${candleFail}, kredi ${candleCredits})`);
    events = timed.sort((a, b) => b.prem - a.prem || a.ts - b.ts);
  } else {
    log('gün içi opsiyon mumu yok; her kontrat için tek olay, zaman = kapanış 16:00 ET');
  }

  // ── 6) özet ──
  const byTk = new Map<string, number>();
  for (const e of events) byTk.set(e.ticker, (byTk.get(e.ticker) ?? 0) + 1);
  log(`olay toplam: ${events.length} · ` + list.map(t => `${t}:${byTk.get(t) ?? 0}`).join(' ') + ` · kredi ${total} · kalan ${md.lastRemaining ?? '?'}`);
  if (notes.length) log('notlar:\n  ' + notes.join('\n  '));
  if (!events.length) log('eşik geçen gerçek kontrat yok; DB’ye olay yazılmayacak.');

  if (DRY) {
    for (const e of events.slice(0, 15)) {
      log(`  ${e.ticker} ${e.expiry} ${e.strike} ${e.side} dV=${e.dv} mid=${e.mid.toFixed(2)} prim=${Math.round(e.prem)} volOi=${e.volOi.toFixed(2)}${e.wide ? ' WIDE' : ''}`);
    }
    if (events.length > 15) log(`  … +${events.length - 15} olay`);
    store.close();
    return;
  }

  const deleted = store.deleteReconstructedEvents(day);
  if (deleted) log(`önceki yeniden kurulan olay silindi: ${deleted}`);
  let written = 0;
  for (const e of events) { store.insertEvent(e); written++; }

  if (mode === 'date') {
    for (const [t, rows] of byTicker) {
      if (!rows.length) continue;
      const { wall, flow } = histSnapshot(rows, day, asOf);
      const snap: HistSnap = { srcDay: day, reportDay: day, asOf, expiries: [...new Set(rows.map(r => r.expiry))].sort(), rows: rows.length, wall, flow };
      store.histPut(day, t, asOf, snap);
    }
    log('hist_chain özeti yazıldı (tam date= zinciri)');
  } else {
    log('hist_chain yazılmadı (eod minVolume süzmesi duvar için eksik kalır)');
  }

  log(`yazılan olay: ${written}; tüketilen kredi: ${total}; kalan: ${md.lastRemaining ?? 'bilinmiyor'}`);
  store.close();
}

main().catch(e => { console.error('akış geri doldurma hatası:', errText(e)); process.exit(1); });
