/*
 * Komut önizlemesi (saf): doğrulanmış işlemlerden Türkçe satırlar. Metin MODELDEN gelmez; kodda kurulur.
 * Sunucu (POST /coach/komut) ve test kullanır. Fiyatlar nokta ile (2,40 değil 2.40), vade GG.AA (ör. 18.11).
 */
import type { Fill, KomutAction, KomutFill } from './types.ts';

const hm = (t: string) => t.slice(11, 16);
const dm = (exp: string) => `${exp.slice(8, 10)}.${exp.slice(5, 7)}`;
const px = (x: number) => x.toFixed(2);
const sideUp = (s: 'buy' | 'sell') => (s === 'buy' ? 'ALIŞ' : 'SATIŞ');
const sideLow = (s: 'buy' | 'sell') => (s === 'buy' ? 'alış' : 'satış');
const tfmt = (t: string, ref: string) => (t.slice(0, 10) === ref.slice(0, 10) ? hm(t) : t.replace('T', ' '));

const FIELD_NAME: Record<keyof KomutFill, string> = { t: 'zaman', tk: 'hisse', exp: 'vade', k: 'strike', cp: 'tür', q: 'adet', side: 'yön', px: 'fiyat' };

/** Bir alan değişikliğinin metni (eski → yeni). Değer aynıysa null. */
function changeText(key: keyof KomutFill, from: KomutFill[keyof KomutFill], to: KomutFill[keyof KomutFill], ref: string): string | null {
  if (from === to) return null;
  const show = (k: keyof KomutFill, v: KomutFill[keyof KomutFill]): string => {
    if (k === 't') return tfmt(String(v), ref);
    if (k === 'exp') return dm(String(v));
    if (k === 'side') return sideLow(v as 'buy' | 'sell');
    if (k === 'px') return px(Number(v));
    return String(v);
  };
  return `${FIELD_NAME[key]} ${show(key, from)} → ${show(key, to)}`;
}

/** Her işlem için bir satır, sırayla. fills: kimlik → mevcut dolum (update/delete satırları için eski değerler). */
export function buildKomutLines(actions: KomutAction[], fills: ReadonlyMap<number, Fill>): string[] {
  return actions.map(a => {
    if (a.op === 'add') {
      const f = a.fill;
      return `Ekle: ${f.tk} ${f.k}${f.cp} ${dm(f.exp)} · ${f.q} kontrat ${sideUp(f.side)} @ ${px(f.px)} · ${hm(f.t)}`;
    }
    const old = fills.get(a.id);
    if (!old) return a.op === 'delete' ? `Sil: #${a.id} (dolum bulunamadı)` : `Düzelt: #${a.id} (dolum bulunamadı)`;
    if (a.op === 'delete') return `Sil: #${a.id} ${old.tk} ${old.k}${old.cp} ${sideLow(old.side)} ${old.q} @ ${px(old.px)}`;
    const parts: string[] = [];
    for (const key of Object.keys(a.set) as (keyof KomutFill)[]) {
      const c = changeText(key, old[key], a.set[key] as KomutFill[keyof KomutFill], old.t);
      if (c) parts.push(c);
    }
    return parts.length ? `Düzelt: #${a.id} ${parts.join(' · ')}` : `Düzelt: #${a.id} değişiklik yok`;
  });
}
