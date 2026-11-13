// Veri tazelik göstergesi testleri: durum geçişleri, piyasa takvimi (hafta sonu/tatil/erken kapanış), MD 15 dk notu,
// en kötü birleşim, mesaj temizleme (token maskesi, query atma, ≤160), bildirimlerin asla fırlatmaması. Ağ YOK.
import * as F from '../src/lib/freshness.ts';
import * as U from '../src/lib/usmarket.ts';

let fail = 0;
const pending: Promise<void>[] = [];
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const MIN = 60000;
const rec = (o: Partial<F.SourceRec> = {}): F.SourceRec => ({ ...F.emptyRec(), ...o });
const OPEN = Date.parse('2026-11-13T15:00:00Z');   // Cuma 10:00 ET, seans açık
const SAT = Date.parse('2026-11-14T15:00:00Z');    // Cumartesi
const ET = (iso: string) => Date.parse(iso);        // 13 Kasım: EST (UTC−5)

// ───── 1) Mesaj temizleme ─────
{
  const m = F.sanitizeMsg(new Error('GET https://api.marketdata.app/v1/stocks/quotes/MU/?token=SECRETabc123XYZ&x=1 HTTP 500'));
  ok('query atılır (token=… görünmez)', !m.includes('SECRETabc123XYZ') && !m.includes('?token') && !m.includes('x=1'), m);
  ok('URL kökü korunur', m.includes('https://api.marketdata.app/v1/stocks/quotes/MU/'), m);
  const a = F.sanitizeMsg('Authorization: Bearer eyJhbGciOi.payload.sig');
  ok('Authorization başlığı maskelenir', !/eyJhbGci|payload\.sig/.test(a), a);
  const b = F.sanitizeMsg('istek başarısız apikey=k_live_12 ve api_key: "zz9"');
  ok('apikey= / api_key: değerleri maskelenir', !/k_live_12|zz9/.test(b), b);
  F.registerSecret('tokenKayitli_987654');
  const c = F.sanitizeMsg('hata: tokenKayitli_987654 geçersiz');
  ok('kayıtlı token maskelenir', !c.includes('tokenKayitli_987654') && c.includes('***'), c);
  process.env.FRESH_TEST_TOKEN = 'envTokenValue9876';
  const d = F.sanitizeMsg('ortam değeri envTokenValue9876 sızdı');
  ok('ortam (process.env) token değeri maskelenir', !d.includes('envTokenValue9876'), d);
  delete process.env.FRESH_TEST_TOKEN;
  const long = F.sanitizeMsg('x '.repeat(400));
  ok('≤ 160 karakter (uzun metin)', long.length <= 160, String(long.length));
  const tok = F.sanitizeMsg('yanıt aBcDeF0123456789aBcDeF0123456789aBcDeF0123456789 gövdesi');
  ok('uzun token benzeri dizgi maskelenir', !tok.includes('aBcDeF0123456789aBcDeF'), tok);
  const weird = { toString() { throw new Error('boom'); } };
  ok('bozuk nesne fırlatmaz', typeof F.sanitizeMsg(weird) === 'string');
  ok('boş mesaj varsayılana düşer', F.sanitizeMsg('   ').length > 0);
}

// ───── 2) Bildirimler asla fırlatmaz; kayıt güncellenir ─────
{
  let threw = false;
  try {
    F.reportOk('bilinmeyen' as any, {}); F.reportFail('news', null); F.reportFail('quotes', undefined, { provider: 'x' });
    F.reportOk('quotes', { at: NaN }); F.setExpected('news', -5); F.setExpected('quotes', null, 'yok'); F.nextRefresh('news', null);
  } catch { threw = true; }
  ok('reportOk/reportFail/setExpected fırlatmaz (geçersiz girdi)', !threw);
  F.resetForTests();
  F.reportFail('quotes', new Error('https://query1.finance.yahoo.com/v8?token=ZZZ999999'), { provider: 'yahoo', at: 1000 });
  const s = F.snapshot().quotes;
  ok('reportFail hatayı temizleyip saklar', s.errAt === 1000 && !!s.err && !s.err.includes('ZZZ999999'), String(s.err));
  F.reportOk('quotes', { provider: 'marketdata', at: 2000 });
  ok('reportOk provider ve zaman kaydeder', F.snapshot().quotes.okAt === 2000 && F.snapshot().quotes.provider === 'marketdata');
  F.setExpected('quotes', 2 * MIN, 'odte'); F.setExpected('quotes', 5 * MIN, 'radar');
  ok('etkin aralık = en kısa sahip (2 dk)', F.effectiveInterval(F.snapshot().quotes.owners) === 2 * MIN);
  F.setExpected('quotes', null, 'odte');
  ok('sahip kaldırılınca 5 dk', F.effectiveInterval(F.snapshot().quotes.owners) === 5 * MIN);
  let notified = 0; const un = F.subscribe(() => { notified++; });
  F.reportOk('news', { provider: 'yahoo', at: 3000 });
  pending.push(new Promise<void>(res => setTimeout(() => { un(); ok('abonelere bildirim (toplu)', notified >= 1); res(); }, 10)));
}

// ───── 3) Piyasa takvimi: seans, erken kapanış, hafta sonu, tatil ─────
{
  ok('cumartesi kapalı', !U.isSessionOpenNow(SAT));
  ok('cuma 10:00 ET açık', U.isSessionOpenNow(OPEN));
  ok('cuma 09:29 ET kapalı (seans öncesi)', !U.isSessionOpenNow(ET('2026-11-13T14:29:00Z')));
  ok('Şükran Günü ertesi (2026-11-27) erken kapanış 13:00 ET', U.sessionCloseMs('2026-11-27') === ET('2026-11-27T18:00:00Z'));
  ok('erken kapanış günü 12:55 ET açık', U.isSessionOpenNow(ET('2026-11-27T17:55:00Z')));
  ok('erken kapanış günü 13:05 ET kapalı', !U.isSessionOpenNow(ET('2026-11-27T18:05:00Z')));
  ok('24 Aralık 2026 (Perşembe) erken kapanış', U.sessionCloseMs('2026-12-24') === ET('2026-12-24T18:00:00Z'));
  ok('3 Temmuz 2025 (Perşembe) erken kapanış', U.sessionCloseMs('2025-07-03') === ET('2025-07-03T17:00:00Z'));
  ok('3 Temmuz 2026 tatil (4 Temmuz Cumartesi) → kapalı', U.sessionCloseMs('2026-07-03') === null && !U.isSessionOpenNow(ET('2026-07-03T15:00:00Z')));
  ok('normal gün kapanış 16:00 ET', U.sessionCloseMs('2026-11-13') === ET('2026-11-13T21:00:00Z'));
  ok('Noel 2026 (Cuma) tatil → kapalı', !U.isSessionOpenNow(ET('2026-12-25T15:00:00Z')));
  ok('erken kapanış değişikliği closeMs\'i etkilemez (16:00 ET kalır)', U.closeMs('2026-11-27') === ET('2026-11-27T21:00:00Z'));
}

// ───── 4) Durum geçişleri (saf) ─────
{
  const iv = { owners: { odte: 60 * 1000 } } as Partial<F.SourceRec>;
  const a1 = F.assess('quotes', rec({ ...iv, okAt: OPEN - MIN, provider: 'yahoo' }), OPEN, true);
  ok('açık seans, 1 dk önce başarı → güncel', a1.status === 'guncel', a1.status);
  const a2 = F.assess('quotes', rec({ ...iv, okAt: OPEN - 10 * MIN, provider: 'yahoo' }), OPEN, true);
  ok('açık seans, 10 dk önce başarı → gecikmeli', a2.status === 'gecikmeli', a2.status);
  const a3 = F.assess('quotes', rec({ ...iv, okAt: OPEN - 5 * MIN, errAt: OPEN - MIN, err: 'x' }), OPEN, true);
  ok('son deneme hata (hata > başarı) → hata', a3.status === 'hata', a3.status);
  const a4 = F.assess('quotes', rec({ ...iv, okAt: OPEN - MIN, errAt: OPEN - 2 * MIN }), OPEN, true);
  ok('son başarı hatadan yeni → güncel', a4.status === 'guncel', a4.status);
  const a5 = F.assess('md-options', rec({ errAt: OPEN - MIN, err: 'tek cihaz' }), OPEN, true);
  ok('açık seans, hiç başarı yok, hata var → hata', a5.status === 'hata', a5.status);
  const a6 = F.assess('md-options', rec(), OPEN, true);
  ok('hiç kullanılmadı → kullanilmiyor (kırmızı değil)', a6.status === 'kullanilmiyor', a6.status);
  const a7 = F.assess('md-options', rec({ okAt: SAT - 30 * MIN, errAt: SAT - MIN, err: 'tek cihaz' }), SAT, false);
  ok('kapalıyken son deneme hata → kapali (gri), hata metni detayda', a7.status === 'kapali' && !!a7.err && a7.closedNote, a7.status);
  const a8 = F.assess('md-options', rec({ okAt: SAT - MIN }), SAT, false);
  ok('kapalıyken son başarı detayda korunur (okAt)', a8.status === 'kapali' && a8.okAt === SAT - MIN);
  const n1 = F.assess('news', rec({ errAt: SAT, err: 'SEC HTTP 503' }), SAT, false);
  ok('haber: seans kapalıyken hata da gri (haber taraması seansa bağlı)', n1.status === 'kapali' && !!n1.err, n1.status);
  const n4 = F.assess('news', rec({ okAt: SAT - MIN, owners: { radar: 5 * MIN } }), SAT, false);
  ok('haber: seans dışında sarı değil (gri)', n4.status === 'kapali', n4.status);
  const n2 = F.assess('news', rec({ okAt: OPEN - 10 * MIN, owners: { radar: 5 * MIN } }), OPEN, true);
  ok('haber 10 dk önce (5 dk aralık, 15 dk tolerans) → güncel', n2.status === 'guncel', n2.status);
  const n3 = F.assess('news', rec({ okAt: OPEN - 30 * MIN, owners: { radar: 5 * MIN } }), OPEN, true);
  ok('haber 30 dk önce → gecikmeli', n3.status === 'gecikmeli', n3.status);
}

// ───── 5) MarketData hisse verisi: 15 dk notu, sarı/kırmızı yalnız gerçek sorunda ─────
{
  const owners = { odte: 2 * MIN };
  const m1 = F.assess('quotes', rec({ okAt: OPEN - MIN, provider: 'marketdata', owners }), OPEN, true);
  ok('MD hisse taze → güncel + delayNote (15 dk)', m1.status === 'guncel' && m1.delayNote, m1.status);
  const m2 = F.assess('quotes', rec({ okAt: OPEN - 12 * MIN, provider: 'marketdata', owners }), OPEN, true);
  ok('MD hisse 12 dk önce (15 dk gecikme payı içinde) → sarı değil', m2.status === 'guncel', m2.status);
  const m3 = F.assess('quotes', rec({ okAt: OPEN - 5 * MIN, errAt: OPEN - MIN, provider: 'marketdata', owners }), OPEN, true);
  ok('MD hisse: gerçek hata → kırmızı', m3.status === 'hata', m3.status);
  const y1 = F.assess('quotes', rec({ okAt: OPEN - 12 * MIN, provider: 'yahoo', owners }), OPEN, true);
  ok('Yahoo aynı yaşta → gecikmeli (delayNote yok)', y1.status === 'gecikmeli' && !y1.delayNote, y1.status);
  const m4 = F.assess('quotes', rec({ okAt: OPEN - 60 * MIN, provider: 'marketdata', owners }), OPEN, true);
  ok('MD: 15 dk payı da aşılırsa gecikmeli (beslemenin durması)', m4.status === 'gecikmeli', m4.status);
  ok('md-options MD hisse notu üretmez (yalnız quotes)', !F.assess('md-options', rec({ okAt: OPEN - MIN, provider: 'marketdata' }), OPEN, true).delayNote);
}

// ───── 6) En kötü birleşim ─────
{
  const mk = (status: F.Status) => ({ status, source: 'news', label: '', statusLabel: '', provider: null, okAt: null, errAt: null, err: null, nextAt: null, intervalMs: 0, delayNote: false, closedNote: false }) as unknown as F.Assessment;
  ok('güncel + hata → hata', F.overall([mk('guncel'), mk('hata')]) === 'hata');
  ok('gecikmeli + güncel → gecikmeli', F.overall([mk('gecikmeli'), mk('guncel')]) === 'gecikmeli');
  ok('kapalı + güncel → güncel (kapalı yok sayılır)', F.overall([mk('kapali'), mk('guncel')]) === 'guncel');
  ok('hepsi kapalı → kapali', F.overall([mk('kapali'), mk('kapali')]) === 'kapali');
  ok('kullanılmıyor + güncel → güncel (kırmızı yapmaz)', F.overall([mk('kullanilmiyor'), mk('guncel')]) === 'guncel');
  ok('hepsi kullanılmıyor → kullanilmiyor', F.overall([mk('kullanilmiyor')]) === 'kullanilmiyor');
  ok('kapalı + kullanılmıyor → kapali', F.overall([mk('kapali'), mk('kullanilmiyor')]) === 'kapali');
}

// ───── 7) Tüm kaynaklar birleşik görünüm (saf) ─────
{
  const recs = { 'md-options': rec(), quotes: rec({ okAt: OPEN - MIN, provider: 'yahoo', owners: { odte: MIN } }), news: rec({ errAt: OPEN - 5 * MIN, err: 'Finnhub HTTP 401' }) };
  const v = F.assessAll(recs, OPEN);
  ok('birleşik: quotes güncel, news hata → genel hata', v.overall === 'hata' && v.sessionOpen, v.overall);
  ok('birleşik: kullanılmayan md-options listede kullanılmıyor', v.list.find(a => a.source === 'md-options')?.status === 'kullanilmiyor');
}

// ───── 8) Gerçek fetch yolu (fetch sahte: 401 yanıt; ağ YOK) — loadSymbol bildirimleri + token maskesi ─────
async function fetchPath() {
  const TOKEN = 'TESTTOKEN_abcdef123456789';
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ s: 'error', errmsg: 'Invalid token ' + TOKEN }), { status: 401 })) as typeof fetch;
  F.resetForTests();
  const MD = await import('../src/lib/market/index.ts');
  let threw = false;
  try { await MD.loadSymbol('ZZTEST', 'marketdata', { marketdata: TOKEN }); } catch { threw = true; }
  globalThis.fetch = realFetch;
  const r = F.snapshot();
  ok('loadSymbol başarısız → istisna', threw);
  ok('md-options hata kaydı (MarketData)', r['md-options'].errAt != null && /MarketData/.test(r['md-options'].err ?? ''), String(r['md-options'].err));
  ok('md-options hata metninde token YOK', !!r['md-options'].err && !r['md-options'].err.includes(TOKEN) && !r['md-options'].err.includes('Invalid token TESTTOKEN'), String(r['md-options'].err));
  ok('quotes hata kaydı (tüm sağlayıcılar)', r.quotes.errAt != null && r.quotes.okAt == null);
  const v = F.assessAll(r, Date.parse('2026-11-13T15:00:00Z'));
  ok('açık seans + hata → genel hata', v.overall === 'hata', v.overall);
  F.resetForTests();
}

(async () => {
  await fetchPath();
  await Promise.all(pending);
  console.log(fail ? `\n${fail} TEST BAŞARISIZ` : '\nTazelik testleri geçti');
  process.exit(fail ? 1 : 0);
})();
