// Koç elle düzenleme (saf): form ayrıştırma (fiyat/vade/saat/adet), kapat/düzenle/sil işlemleri, dolum kimliği çözümü. Ağ YOK.
import {
  buildCloseAction, buildEntryEdit, buildTradeEdit, deleteActions, exitEditability, istNowHm, parseExpiry, parseHm, parsePrice, parseQty, parseStrike,
  tradeFillIds,
} from '../src/lib/coach/manual.ts';
import type { KomutAction } from '../src/lib/coach/types.ts';

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };
const err = (r: { ok: boolean } | any): string | null => (r && r.ok === false ? String(r.error) : null);

const REF = '2026-11-14';

// ───── 1) Ayrıştırma ─────
{
  ok('fiyat: virgül → 2,4', parsePrice('2,40') === 2.4);
  ok('fiyat: nokta → 2.4', parsePrice('2.40') === 2.4);
  ok('fiyat: "2," (kısmi) geçerli 2', parsePrice('2,') === 2);
  ok('fiyat: 3 ondalık reddedilir', parsePrice('2,555') === null);
  ok('fiyat: 0 ve negatif reddedilir', parsePrice('0') === null && parsePrice('-1') === null);
  ok('fiyat: boş/harf reddedilir', parsePrice('') === null && parsePrice('abc') === null && parsePrice('2,4,5') === null);
  ok('strike: 602,5 → 602.5', parseStrike('602,5') === 602.5);
  ok('strike: 0 reddedilir', parseStrike('0') === null);
  ok('adet: 3 → 3; 0, 2.5, boş reddedilir', parseQty('3') === 3 && parseQty('0') === null && parseQty('2.5') === null && parseQty('') === null);
  ok('saat: 16:40', parseHm('16:40') === '16:40');
  ok('saat: 9.05 → 09:05', parseHm('9.05') === '09:05');
  ok('saat: 24:00 ve 1640 reddedilir', parseHm('24:00') === null && parseHm('1640') === null);
  ok('vade: YYYY-MM-DD', parseExpiry('2026-11-18', REF) === '2026-11-18');
  ok('vade: GG.AA (yıl = seçili gün yılı)', parseExpiry('18.11', REF) === '2026-11-18');
  ok('vade: GG.AA bugün → bugün', parseExpiry('14.11', REF) === '2026-11-14');
  ok('vade: GG.AA geçmişse sonraki yıl (01.02 → 2027-02-01)', parseExpiry('01.02', REF) === '2027-02-01');
  ok('vade: GG.AA.YYYY', parseExpiry('18.11.2027', REF) === '2027-11-18');
  ok('vade: geçersiz tarih (31.02, 2026-02-30) reddedilir', parseExpiry('31.02', REF) === null && parseExpiry('2026-02-30', REF) === null);
  ok('vade: çöp metin reddedilir', parseExpiry('yarın', REF) === null);
  // 2026-11-14 09:05 UTC = 12:05 İstanbul (UTC+3, yaz saati yok)
  ok('İstanbul şimdi HH:MM', istNowHm(Date.UTC(2026, 10, 14, 9, 5)) === '12:05', istNowHm(Date.UTC(2026, 10, 14, 9, 5)));
  ok('İstanbul şimdi: gece yarısı sınırı (21:30 UTC → 00:30)', istNowHm(Date.UTC(2026, 10, 13, 21, 30)) === '00:30');
}

// ───── 2) Kapat (satış) ─────
const CLOSE = { day: '2026-11-14', tk: 'qqq', exp: '2026-11-18', k: 600, cp: 'C' as const, openQty: 5, entryT: '2026-11-14T16:40', qty: 2, px: 3.2, hm: '17:05' };
{
  const r = buildCloseAction(CLOSE);
  ok('kapat: geçerli → add sell', r.ok && r.action.op === 'add' && r.action.fill.side === 'sell', JSON.stringify(r));
  if (r.ok && r.action.op === 'add') {
    ok('kapat: t = seçili gün + saat, tk büyük harf, q/px doğru',
      r.action.fill.t === '2026-11-14T17:05' && r.action.fill.tk === 'QQQ' && r.action.fill.q === 2 && r.action.fill.px === 3.2 && r.action.fill.k === 600 && r.action.fill.cp === 'C' && r.action.fill.exp === '2026-11-18',
      JSON.stringify(r.action));
  }
  ok('kapat: adet açık miktarı aşamaz', err(buildCloseAction({ ...CLOSE, qty: 6 })) !== null);
  ok('kapat: adet 0 reddedilir', err(buildCloseAction({ ...CLOSE, qty: 0 })) !== null);
  ok('kapat: tümü (5) kabul', err(buildCloseAction({ ...CLOSE, qty: 5 })) === null);
  ok('kapat: fiyat 0 reddedilir', err(buildCloseAction({ ...CLOSE, px: 0 })) !== null);
  ok('kapat: saat açılıştan önce reddedilir', /önce/.test(err(buildCloseAction({ ...CLOSE, hm: '16:00' })) ?? ''));
  ok('kapat: geçersiz saat reddedilir', err(buildCloseAction({ ...CLOSE, hm: '25:00' })) !== null);
}

// ───── 3) Açık pozisyon düzenleme ─────
const ENTRY = { id: 7, t: '2026-11-14T16:40', px: 2.1, q: 4, k: 600, cp: 'C' as const, exp: '2026-11-18' };
const FORM = { hm: '16:40', px: 2.1, q: 4, k: 600, cp: 'C' as const, exp: '2026-11-18' };
{
  const none = buildEntryEdit(ENTRY, [], FORM, 0, REF);
  ok('düzenle: değişiklik yoksa hata', err(none) === 'Değişiklik yok', JSON.stringify(none));
  const px = buildEntryEdit(ENTRY, [], { ...FORM, px: 2.4 }, 0, REF);
  ok('düzenle: yalnız fiyat değişince yalnız o alan (update)', px.ok && JSON.stringify(px.actions) === JSON.stringify([{ op: 'update', id: 7, set: { px: 2.4 } }]), JSON.stringify(px));
  const t = buildEntryEdit(ENTRY, [], { ...FORM, hm: '17:10' }, 0, REF);
  ok('düzenle: saat → t (gün korunur)', t.ok && t.actions[0].op === 'update' && (t.actions[0] as any).set.t === '2026-11-14T17:10', JSON.stringify(t));
  const k = buildEntryEdit(ENTRY, [8, 9], { ...FORM, k: 605, cp: 'P' }, 0, REF);
  ok('düzenle: strike/tür değişince kapanış dolumları da güncellenir (id 8, 9)',
    k.ok && k.actions.length === 3 && k.actions.slice(1).every(a => a.op === 'update' && (a.id === 8 || a.id === 9)), JSON.stringify(k));
  ok('düzenle: adet kapatılmış miktarın altına inemez', err(buildEntryEdit(ENTRY, [], { ...FORM, q: 1 }, 2, REF)) !== null);
  ok('düzenle: adet kapatılmış miktara eşit olabilir', err(buildEntryEdit(ENTRY, [], { ...FORM, q: 2 }, 2, REF)) === null);
  ok('düzenle: vade giriş gününden önce reddedilir', err(buildEntryEdit(ENTRY, [], { ...FORM, exp: '2026-11-13' }, 0, REF)) !== null);
}

// ───── 4) Çıkış düzenlenebilirliği ─────
{
  const fills = new Map([[13, { q: 2 }], [14, { q: 5 }]]);
  ok('çıkış: tek dolum, paylaşılmamış → düzenlenebilir', exitEditability([{ id: 13, q: 2 }], fills, 2).editable);
  ok('çıkış: kademeli (2 bacak) → kilitli', !exitEditability([{ id: 13, q: 1 }, { id: 14, q: 1 }], fills, 2).editable);
  ok('çıkış: dolum bu günde değil → kilitli', !exitEditability([{ id: 99, q: 2 }], fills, 2).editable);
  ok('çıkış: paylaşılan dolum (q > işlem adedi) → kilitli', !exitEditability([{ id: 14, q: 2 }], fills, 2).editable);
}

// ───── 5) İşlem düzenleme ─────
const TENTRY = { id: 12, t: '2026-11-14T16:40', px: 2.1, q: 2, k: 600, cp: 'C' as const, exp: '2026-11-18' };
const TLEG = { id: 13, t: '2026-11-14T17:05', px: 3.2, q: 2 };
const base = { entry: TENTRY, legIds: [13], exitEditable: true, exitReason: null, exit: TLEG, exitHm: '17:05', exitPx: 3.2 };
const locked = { ...base, exitEditable: false, exitReason: 'birden çok satış dolumu (kademeli çıkış)', exit: null };
const TFORM = { hm: '16:40', px: 2.1, q: 2, k: 600, cp: 'C' as const, exp: '2026-11-18', exitHm: '17:05', exitPx: 3.2 };
{
  const same = buildTradeEdit(base, TFORM, REF);
  ok('işlem: değişiklik yok → hata', err(same) === 'Değişiklik yok', JSON.stringify(same));
  const ex = buildTradeEdit(base, { ...TFORM, exitPx: 3.5 }, REF);
  ok('işlem: çıkış fiyatı → satış dolumu update (px)', ex.ok && JSON.stringify(ex.actions) === JSON.stringify([{ op: 'update', id: 13, set: { px: 3.5 } }]), JSON.stringify(ex));
  const q = buildTradeEdit(base, { ...TFORM, q: 3 }, REF);
  ok('işlem: adet (tek bacak) → alış ve satış q birlikte',
    q.ok && q.actions.length === 2 && JSON.stringify(q.actions[0]) === JSON.stringify({ op: 'update', id: 12, set: { q: 3 } })
      && JSON.stringify(q.actions[1]) === JSON.stringify({ op: 'update', id: 13, set: { q: 3 } }), JSON.stringify(q));
  const lock = buildTradeEdit(locked, { ...TFORM, exitPx: 3.5 }, REF);
  ok('işlem: kilitli çıkışta çıkış fiyatı değişimi reddedilir', err(lock) !== null && /kademeli/.test(err(lock) ?? ''), JSON.stringify(lock));
  const lockQ = buildTradeEdit(locked, { ...TFORM, q: 3 }, REF);
  ok('işlem: kilitli çıkışta adet değişimi reddedilir', err(lockQ) !== null);
  const entryOnly = buildTradeEdit(locked, { ...TFORM, px: 2.3 }, REF);
  ok('işlem: kilitli çıkışta giriş fiyatı serbest', entryOnly.ok && entryOnly.actions.length === 1, JSON.stringify(entryOnly));
  const multi = buildTradeEdit({ ...locked, legIds: [13, 14] }, { ...TFORM, k: 605 }, REF);
  ok('işlem: strike değişince her satış bacağı da güncellenir (13, 14)', multi.ok && multi.actions.length === 3 && multi.actions.slice(1).every(a => a.op === 'update'), JSON.stringify(multi));
  const offDay = buildTradeEdit({ ...locked, legIds: [13], exit: null }, { ...TFORM, hm: '16:45' }, REF);
  ok('işlem: çıkış başka günde (görünmüyor) iken giriş düzenlemesi çalışır', offDay.ok && offDay.actions.length === 1, JSON.stringify(offDay));
  const offDayK = buildTradeEdit({ ...locked, legIds: [13], exit: null }, { ...TFORM, k: 605 }, REF);
  ok('işlem: çıkış başka günde iken strike değişince satış dolumu da güncellenir (13)', offDayK.ok && offDayK.actions.length === 2 && (offDayK.actions[1] as any).id === 13, JSON.stringify(offDayK));
  const before = buildTradeEdit(base, { ...TFORM, exitHm: '16:00' }, REF);
  ok('işlem: çıkış saati giriş saatinden önce reddedilir', err(before) !== null, JSON.stringify(before));
}

// ───── 6) Dolum kimliği çözümü + silme ─────
{
  const p = tradeFillIds('QQQ|2026-11-18|600|C#12#13x2+14x1');
  ok('sig: giriş 12, bacaklar [13×2, 14×1]', !!p && p.entryId === 12 && JSON.stringify(p.legs) === JSON.stringify([{ id: 13, q: 2 }, { id: 14, q: 1 }]), JSON.stringify(p));
  ok('sig: ondalıklı strike (602.5) de çözülür', !!tradeFillIds('QQQ|2026-11-18|602.5|P#3#4x1'));
  ok('sig: bozuk biçim → null', tradeFillIds('QQQ|x') === null && tradeFillIds('QQQ|2026|600|C#a#1x1') === null);
  const d: KomutAction[] = deleteActions([12, 13]);
  ok('sil: her kimlik için delete', JSON.stringify(d) === JSON.stringify([{ op: 'delete', id: 12 }, { op: 'delete', id: 13 }]));
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm koç elle düzenleme (saf) testleri geçti');
process.exit(fail ? 1 : 0);
