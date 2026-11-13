// Koç dolum zaman sağlaması (saf): İstanbul seans penceresi, 0DTE vade günü, ±7/±8 sa düzeltme, uyarılar. Ağ YOK.
import { checkFillTime, fillTimeValid, sessionDay } from '../src/lib/coach/sanity.ts';
import { istToMs } from '../src/lib/coach/time.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const EXP = '2026-11-13';

// Canlı test: alış 17:57, satış gerçek 18:05 (Midas, İstanbul). Model 01:05 (+7 sa) yazdı → düzeltilmeli.
{
  const r = checkFillTime('2026-11-14T01:05', EXP);
  ok('canlı: 01:05 (11-14) → 18:05 (11-13), düzeltildi', r.corrected && r.t === '2026-11-13T18:05', JSON.stringify(r));
  ok('canlı: uyarı Türkçe ve düzeltmeyi gösteriyor', !!r.warn && r.warn.includes('saat dilimi düzeltildi') && r.warn.includes('2026-11-14 01:05') && r.warn.includes('2026-11-13 18:05') && r.warn.includes('-7 sa'), String(r.warn));
  ok('canlı: düzeltilmiş zaman geçerli', fillTimeValid(istToMs(r.t)!, EXP));
  const buy = checkFillTime('2026-11-13T17:57', EXP);
  ok('canlı: alış 17:57 dokunulmadan geçer', buy.t === '2026-11-13T17:57' && buy.warn === null && !buy.corrected);
  ok('canlı: 18:05 (doğru saat) dokunulmaz', checkFillTime('2026-11-13T18:05', EXP).warn === null);
}

// Seans penceresi sınırları (İstanbul 16:30 → ertesi gün 00:15), 0DTE vade günü
{
  ok('pencere: 16:30 geçerli (vade günü)', fillTimeValid(istToMs('2026-11-13T16:30')!, EXP));
  ok('pencere: 16:29 geçersiz (seans öncesi)', !fillTimeValid(istToMs('2026-11-13T16:29')!, EXP));
  ok('pencere: ertesi gün 00:10 geçerli (ET 16:10 kapanışı, vade 11-13)', fillTimeValid(istToMs('2026-11-14T00:10')!, EXP));
  ok('pencere: ertesi gün 00:20 geçersiz', !fillTimeValid(istToMs('2026-11-14T00:20')!, EXP));
  ok('seans günü: 00:10 (11-14) → işlem günü 11-13', sessionDay(istToMs('2026-11-14T00:10')!) === EXP);
}

// Düzeltilemeyen: 0DTE şekilli ama hiçbir ±7/±8 kayma geçerli değil → değiştirme, uyarı
{
  const r = checkFillTime('2026-11-13T05:00', EXP);
  ok('düzeltilemez: 05:00 değişmez, uyarı var', r.t === '2026-11-13T05:00' && !r.corrected && !!r.warn && r.warn.includes('şüpheli'), JSON.stringify(r));
}

// 0DTE düzeltmesi vade gününe düşmek zorunda: 05:00 (vade 11-13) −7 sa → 11-12 22:00 kabul edilmez
{
  const r = checkFillTime('2026-11-13T05:00', EXP);
  ok('0DTE: önceki güne kayan düzeltme kabul edilmez', !r.corrected);
}

// Belirsiz: −7 ve −8 ikisi de geçerli → −7 seçilir, alternatif uyarıda
{
  const r = checkFillTime('2026-11-14T01:05', EXP);
  ok('belirsiz: −7 seçilir, −8 (17:05) alternatifi uyarıda', r.corrected && r.t.endsWith('18:05') && !!r.warn && r.warn.includes('17:05'), String(r.warn));
}

// Tatil ve sonraki vade (0DTE değil): geçerli işlem günü seansı; tatilde seans yok
{
  ok('vade sonraki gün: 11-10 19:00, vade 11-20 → geçerli, dokunulmaz', checkFillTime('2026-11-10T19:00', '2026-11-20').warn === null);
  const h = checkFillTime('2026-11-26T19:00', '2026-11-27');
  ok('tatil (Şükran 26 Kas): seans yok → değiştirmeden uyarı', h.t === '2026-11-26T19:00' && !h.corrected && !!h.warn, JSON.stringify(h));
}

// Bozuk biçim: zaman olduğu gibi döner (validateFills zaten reddeder)
ok('biçim bozuk: değişmeden, uyarı yok', (() => { const r = checkFillTime('bozuk', EXP); return r.t === 'bozuk' && r.warn === null; })());

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm zaman sağlaması testleri geçti');
process.exit(fail ? 1 : 0);
