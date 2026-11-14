// Koç komut (saf): doğrulama (validateKomut) ve önizleme (buildKomutLines). Sunucu tarafı (öneri, uygulama, SQLite):
// server/app/komut-test.ts. Ağ YOK.
import { validateKomut } from '../src/lib/coach/validate.ts';
import { buildKomutLines } from '../src/lib/coach/komut.ts';
import type { Fill, KomutAction } from '../src/lib/coach/types.ts';

type AddAction = Extract<KomutAction, { op: 'add' }>;
const addOf = (a: KomutAction | undefined): AddAction | null => (a && a.op === 'add' ? a : null);

let fail = 0;
const ok = (name: string, cond: boolean, info = '') => { if (!cond) fail++; console.log((cond ? 'OK  ' : 'FAIL') + ' ' + name + (info && !cond ? ' — ' + info : '')); };

const DAY = '2026-11-13';
const KNOWN = new Map([[1, DAY], [2, DAY], [3, DAY]]);
const good = { t: '2026-11-13T16:40', tk: 'QQQ', exp: DAY, k: 600, cp: 'C', q: 2, side: 'buy', px: 2.1 };

// ───── 1) validateKomut ─────
{
  const v = validateKomut({ actions: [{ op: 'add', fill: { ...good, tk: 'qqq', cp: 'c' } }], note: 'x' }, KNOWN);
  ok('geçerli add kabul; tk/cp büyük harfe çevrilir', v.ok && v.value.actions.length === 1 && v.value.dropped === 0 &&
    addOf(v.value.actions[0])?.fill.tk === 'QQQ' && addOf(v.value.actions[0])?.fill.cp === 'C');
  ok('note korunur', v.ok && v.value.note === 'x');
}
{
  const v = validateKomut({ actions: [{ op: 'update', id: 2, set: { px: 2.4 } }, { op: 'delete', id: 1 }] }, KNOWN);
  ok('geçerli update + delete', v.ok && v.value.actions.length === 2 && v.value.dropped === 0);
}
{
  const v = validateKomut({ actions: [{ op: 'delete', id: 99 }, { op: 'delete', id: 1 }] }, KNOWN);
  ok('bilinmeyen kimlik düşürülür, diğeri kalır', v.ok && v.value.actions.length === 1 && v.value.dropped === 1 && v.value.warnings.some(w => w.includes('#99')));
}
{
  const bad: [string, unknown][] = [
    ['bilinmeyen op', { op: 'merge', id: 1 }],
    ['cp X', { op: 'add', fill: { ...good, cp: 'X' } }],
    ['side al (Türkçe)', { op: 'add', fill: { ...good, side: 'al' } }],
    ['negatif px', { op: 'add', fill: { ...good, px: -1 } }],
    ['sıfır px', { op: 'add', fill: { ...good, px: 0 } }],
    ['px NaN', { op: 'add', fill: { ...good, px: NaN } }],
    ['q ondalık', { op: 'add', fill: { ...good, q: 1.5 } }],
    ['q 0', { op: 'add', fill: { ...good, q: 0 } }],
    ['tk rakam', { op: 'add', fill: { ...good, tk: 'Q1' } }],
    ['tk 7 harf', { op: 'add', fill: { ...good, tk: 'ABCDEFG' } }],
    ['vade geçersiz tarih', { op: 'add', fill: { ...good, exp: '2026-02-30' } }],
    ['t biçimi', { op: 'add', fill: { ...good, t: '13.11.2026 16:40' } }],
    ['add alan eksik', { op: 'add', fill: { t: good.t, tk: 'QQQ' } }],
    ['update boş set', { op: 'update', id: 2, set: {} }],
    ['update bilinmeyen alan', { op: 'update', id: 2, set: { notes: 'x' } }],
    ['update negatif px', { op: 'update', id: 2, set: { px: -2 } }],
    ['id ondalık', { op: 'delete', id: 1.5 }],
    ['id negatif', { op: 'delete', id: -1 }],
  ];
  for (const [name, a] of bad) {
    const v = validateKomut({ actions: [a] }, KNOWN);
    ok(`reddedilir: ${name}`, v.ok && v.value.actions.length === 0 && v.value.dropped === 1);
  }
}
{
  const many = Array.from({ length: 11 }, (_, i) => ({ op: 'delete', id: (i % 3) + 1 }));
  const v = validateKomut({ actions: many }, KNOWN);
  ok('en çok 10 işlem: 11. atılır', v.ok && v.value.actions.length === 10 && v.value.dropped === 1);
}
{
  const v = validateKomut({ note: null }, KNOWN);
  ok('actions yok → boş liste, hata değil', v.ok && v.value.actions.length === 0 && v.value.dropped === 0);
  const bad = validateKomut('metin', KNOWN);
  ok('nesne değil → hata', !bad.ok);
}
{
  // Gece saatine kaymış 0DTE dolumu (ekran 18:05; model +7 sa ekledi) → sessiz düzeltme + uyarı
  const v = validateKomut({ actions: [{ op: 'add', fill: { ...good, t: '2026-11-14T01:05' } }] }, KNOWN);
  const a = v.ok ? addOf(v.value.actions[0]) : null;
  ok('saat dilimi kayması düzeltilir (01:05 → 18:05)', !!a && a.fill.t === '2026-11-13T18:05', a ? a.fill.t : '');
  ok('düzeltme uyarısı üretilir', v.ok && v.value.warnings.some(w => w.includes('düzeltildi')));
}

{
  // update yalnız t içerir: vade mevcut dolumdan alınır (correct saat → uyarı yok; kaymış saat → düzeltilir)
  const okT = validateKomut({ actions: [{ op: 'update', id: 2, set: { t: '2026-11-13T16:45' } }] }, KNOWN);
  ok('update yalnız t (doğru saat): uyarı yok', okT.ok && okT.value.warnings.length === 0 && okT.value.actions.length === 1);
  const badT = validateKomut({ actions: [{ op: 'update', id: 2, set: { t: '2026-11-14T01:05' } }] }, KNOWN);
  const u = badT.ok ? badT.value.actions[0] : null;
  ok('update yalnız t (kaymış saat): mevcut vadeyle düzeltilir', !!u && u.op === 'update' && u.set.t === '2026-11-13T18:05', JSON.stringify(u));
}

// ───── 2) buildKomutLines (önizleme) ─────
const fills = new Map<number, Fill>([
  [12, { id: 12, t: '2026-11-13T16:40', tk: 'QQQ', exp: '2026-11-13', k: 600, cp: 'C', q: 2, side: 'buy', px: 2.1, conf: 'yuksek' }],
]);
{
  const lines = buildKomutLines([
    { op: 'add', fill: { t: '2026-11-13T15:42', tk: 'QQQ', exp: '2026-11-18', k: 600, cp: 'C', q: 1, side: 'sell', px: 3.2 } },
  ], fills);
  ok('Ekle satırı (örnek biçim)', lines[0] === 'Ekle: QQQ 600C 18.11 · 1 kontrat SATIŞ @ 3.20 · 15:42', lines[0]);
}
{
  const lines = buildKomutLines([{ op: 'update', id: 12, set: { px: 2.4 } }], fills);
  ok('Düzelt satırı: fiyat 2.10 → 2.40', lines[0] === 'Düzelt: #12 fiyat 2.10 → 2.40', lines[0]);
}
{
  const lines = buildKomutLines([{ op: 'delete', id: 12 }], fills);
  ok('Sil satırı (örnek biçim)', lines[0] === 'Sil: #12 QQQ 600C alış 2 @ 2.10', lines[0]);
}
{
  const lines = buildKomutLines([{ op: 'update', id: 12, set: { px: 2.1 } }, { op: 'delete', id: 77 }], fills);
  ok('değişmeyen alan → "değişiklik yok"; bilinmeyen kimlik → "bulunamadı"', lines[0] === 'Düzelt: #12 değişiklik yok' && lines[1] === 'Sil: #77 (dolum bulunamadı)', lines.join(' | '));
}

console.log(fail ? `\n${fail} BAŞARISIZ` : '\nTüm koç komut (saf) testleri geçti');
process.exit(fail ? 1 : 0);
