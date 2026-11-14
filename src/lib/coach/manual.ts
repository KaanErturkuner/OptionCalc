/*
 * Koç elle düzenleme (saf): form girdisini (metin) doğrulanmış KomutAction listesine çevirir.
 * Sunucu POST /coach/komut/uygula bu listeyi yeniden doğrular; burada yalnız uygulama tarafı ön denetimi yapılır.
 * Fiyat: virgül ya da nokta. Vade: YYYY-MM-DD ya da GG.AA (yıl yoksa: seçili gün yılı; geçmişse sonraki yıl).
 * Saat: HH:MM (İstanbul). Ağ YOK; test/coach-manual.test.ts.
 */
import { istHm, istToMs } from './time.ts';
import type { KomutAction, KomutFill } from './types.ts';

type Cp = 'C' | 'P';
const pad2 = (n: number) => String(n).padStart(2, '0');
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Gerçek bir takvim günü mü (YYYY-MM-DD)? */
export function isRealYmd(s: string): boolean {
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Ondalık sayı: virgül ya da nokta; en çok maxDec ondalık; > 0 */
function decimal(s: string, maxInt: number, maxDec: number): number | null {
  const t = s.trim().replace(',', '.');
  if (!new RegExp(`^\\d{1,${maxInt}}(\\.\\d{0,${maxDec}})?$`).test(t)) return null;
  const x = Number(t);
  return Number.isFinite(x) && x > 0 ? x : null;
}

/** Prim fiyatı ($): "2,40" / "2.40" → 2.4; en çok 2 ondalık */
export const parsePrice = (s: string): number | null => decimal(s, 5, 2);

/** Strike: "602,5" → 602.5; en çok 2 ondalık */
export const parseStrike = (s: string): number | null => decimal(s, 6, 2);

/** Adet: pozitif tam sayı */
export function parseQty(s: string): number | null {
  const t = s.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 ? n : null;
}

/** Saat: "16:40" ya da "16.40" → "16:40" (İstanbul); geçersizse null */
export function parseHm(s: string): string | null {
  const m = /^(\d{1,2})[:.](\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2]);
  return h > 23 || mi > 59 ? null : `${pad2(h)}:${pad2(mi)}`;
}

/** Vade: "2026-11-18" ya da "18.11" / "18.11.2026" (ayırıcı . / -). Yıl yoksa refDay'in yılı; o tarih refDay'den önceyse sonraki yıl. */
export function parseExpiry(s: string, refDay: string): string | null {
  const t = s.trim();
  const full = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (full) return isRealYmd(t) ? t : null;
  const m = /^(\d{1,2})[./-](\d{1,2})(?:[./-](\d{4}))?$/.exec(t);
  if (!m) return null;
  const d = Number(m[1]), mo = Number(m[2]);
  let y = m[3] ? Number(m[3]) : Number(refDay.slice(0, 4));
  const build = (yy: number) => `${yy}-${pad2(mo)}-${pad2(d)}`;
  let iso = build(y);
  if (!isRealYmd(iso)) return null;
  if (!m[3] && iso < refDay) { y += 1; iso = build(y); if (!isRealYmd(iso)) return null; }
  return iso;
}

/** Şu anın İstanbul saati HH:MM (varsayılan: şimdi) */
export const istNowHm = (ms: number = Date.now()): string => istHm(ms);

/** Dolum zamanı = gün + HH:MM */
export const withHm = (t: string, hm: string): string => `${t.slice(0, 10)}T${hm}`;

/** Kapat (satış) formu → add (sell) işlemi. openQty: açık adet; entryT: açılış zamanı (satış ondan önce olamaz). */
export interface CloseForm { day: string; tk: string; exp: string; k: number; cp: Cp; openQty: number; entryT: string; qty: number; px: number; hm: string }
export type Built = { ok: true; action: KomutAction; t: string } | { ok: false; error: string };

export function buildCloseAction(f: CloseForm): Built {
  if (!Number.isInteger(f.qty) || f.qty < 1) return { ok: false, error: 'Adet en az 1 olmalı' };
  if (f.qty > f.openQty) return { ok: false, error: `Adet açık miktarı (${f.openQty}) aşamaz` };
  if (!(f.px > 0)) return { ok: false, error: 'Çıkış fiyatı girilmedi' };
  const hm = parseHm(f.hm);
  if (!hm) return { ok: false, error: 'Saat HH:MM olmalı (İstanbul)' };
  const t = withHm(f.day, hm);
  if (istToMs(t) == null) return { ok: false, error: 'Saat geçersiz' };
  if ((istToMs(t) ?? 0) < (istToMs(f.entryT) ?? 0)) return { ok: false, error: `Kapanış saati açılıştan (${f.entryT.slice(11, 16)}) önce olamaz` };
  const fill: KomutFill = { t, tk: f.tk.toUpperCase(), exp: f.exp, k: f.k, cp: f.cp, q: f.qty, side: 'sell', px: f.px };
  return { ok: true, action: { op: 'add', fill }, t };
}

/** Açık pozisyon düzenleme: giriş dolumu (alış) ve bağlı kapanış (satış) dolumları. */
export interface EntryOrig { id: number; t: string; px: number; q: number; k: number; cp: Cp; exp: string }
export interface EntryForm { hm: string; px: number; q: number; k: number; cp: Cp; exp: string }
export type EditBuilt = { ok: true; actions: KomutAction[]; touched: number } | { ok: false; error: string };

const same = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** Yalnız değişen alanlar (update.set). */
export function entrySet(o: EntryOrig, f: EntryForm): Partial<KomutFill> {
  const set: Partial<KomutFill> = {};
  const t = withHm(o.t, f.hm);
  if (t !== o.t) set.t = t;
  if (!same(f.px, o.px)) set.px = f.px;
  if (f.q !== o.q) set.q = f.q;
  if (!same(f.k, o.k)) set.k = f.k;
  if (f.cp !== o.cp) set.cp = f.cp;
  if (f.exp !== o.exp) set.exp = f.exp;
  return set;
}

/** Sözleşme alanları (strike/tür/vade) değiştiyse; kapanış dolumları da aynı sözleşmede olmalı. */
const contractSet = (o: EntryOrig, f: EntryForm): Partial<KomutFill> => {
  const set: Partial<KomutFill> = {};
  if (!same(f.k, o.k)) set.k = f.k;
  if (f.cp !== o.cp) set.cp = f.cp;
  if (f.exp !== o.exp) set.exp = f.exp;
  return set;
};

const hasKeys = (o: object) => Object.keys(o).length > 0;

/** Açık pozisyon: giriş dolumu düzenleme. closedQty: kapatılmış adet (toplam adet ≥ closedQty). legIds: kapanış dolumları. */
export function buildEntryEdit(o: EntryOrig, legIds: number[], f: EntryForm, closedQty: number, refDay: string): EditBuilt {
  if (!parseHm(f.hm)) return { ok: false, error: 'Saat HH:MM olmalı (İstanbul)' };
  if (!(f.px > 0)) return { ok: false, error: 'Giriş fiyatı girilmedi' };
  if (!Number.isInteger(f.q) || f.q < Math.max(1, closedQty)) return { ok: false, error: `Adet en az ${Math.max(1, closedQty)} olmalı${closedQty ? ` (${closedQty} adet kapatılmış)` : ''}` };
  if (!(f.k > 0)) return { ok: false, error: 'Strike girilmedi' };
  if (!isRealYmd(f.exp) || f.exp < refDay) return { ok: false, error: 'Vade geçerli ve giriş gününden sonra olmalı' };
  const set = entrySet(o, f);
  const cset = contractSet(o, f);
  if (!hasKeys(set) && !hasKeys(cset)) return { ok: false, error: 'Değişiklik yok' };
  const actions: KomutAction[] = [];
  if (hasKeys(set)) actions.push({ op: 'update', id: o.id, set });
  if (hasKeys(cset)) for (const id of legIds) actions.push({ op: 'update', id, set: { ...cset } });
  return { ok: true, actions, touched: actions.length };
}

/** Çıkış düzenlenebilir mi? Yalnız tek satış dolumu ve o dolum yalnız bu işleme ait (q = işlem adedi). */
export function exitEditability(legs: { id: number; q: number }[], fillsById: ReadonlyMap<number, { q: number }>, qty: number): { editable: boolean; reason: string | null } {
  if (legs.length !== 1) return { editable: false, reason: legs.length > 1 ? 'birden çok satış dolumu (kademeli çıkış)' : 'satış dolumu yok' };
  const leg = fillsById.get(legs[0].id);
  if (!leg) return { editable: false, reason: 'satış dolumu bu günde değil' };
  if (leg.q !== qty || legs[0].q !== qty) return { editable: false, reason: 'satış dolumu başka işlemle paylaşılıyor' };
  return { editable: true, reason: null };
}

/** İşlem (kapanmış) düzenleme. legIds: tüm satış dolumu kimlikleri (sözleşme alanları hepsine uygulanır; görünmeyen günde olabilir).
 *  exit: yalnız exitEditable iken (tek, paylaşılmamış satış dolumunun ayrıntısı). exitHm/exitPx: görünen (orijinal) çıkış. */
export interface TradeEditOrig {
  entry: EntryOrig;
  legIds: number[];
  exitEditable: boolean;
  exitReason: string | null;
  exit: { id: number; t: string; px: number; q: number } | null;
  exitHm: string;
  exitPx: number;
}
export interface TradeEditForm extends EntryForm { exitHm: string; exitPx: number }

export function buildTradeEdit(o: TradeEditOrig, f: TradeEditForm, refDay: string): EditBuilt {
  const eo = o.entry;
  if (!parseHm(f.hm)) return { ok: false, error: 'Giriş saati HH:MM olmalı' };
  if (!(f.px > 0)) return { ok: false, error: 'Giriş fiyatı girilmedi' };
  if (!Number.isInteger(f.q) || f.q < 1) return { ok: false, error: 'Adet en az 1 olmalı' };
  if (!(f.k > 0)) return { ok: false, error: 'Strike girilmedi' };
  if (!isRealYmd(f.exp) || f.exp < refDay) return { ok: false, error: 'Vade geçerli ve giriş gününden sonra olmalı' };
  const exitHm = parseHm(f.exitHm);
  if (!exitHm) return { ok: false, error: 'Çıkış saati HH:MM olmalı' };
  if (!(f.exitPx > 0)) return { ok: false, error: 'Çıkış fiyatı girilmedi' };

  const actions: KomutAction[] = [];
  const eset = entrySet(eo, f);
  const cset = contractSet(eo, f);
  if (f.q !== eo.q && !o.exitEditable) return { ok: false, error: `Adet değiştirilemez: çıkış ${o.exitReason ?? 'düzenlenemiyor'}` };
  if (hasKeys(eset)) actions.push({ op: 'update', id: eo.id, set: eset });

  const exitChanged = exitHm !== o.exitHm || !same(f.exitPx, o.exitPx);
  if (o.exitEditable && o.exit) {
    const set: Partial<KomutFill> = {};
    const t = withHm(o.exit.t, exitHm);
    if (t !== o.exit.t) set.t = t;
    if (!same(f.exitPx, o.exit.px)) set.px = f.exitPx;
    if (f.q !== o.exit.q) set.q = f.q;
    if (hasKeys(set)) {
      if ((istToMs(t) ?? 0) < (istToMs(withHm(eo.t, f.hm)) ?? 0)) return { ok: false, error: 'Çıkış saati giriş saatinden önce olamaz' };
      actions.push({ op: 'update', id: o.exit.id, set });
    }
  } else if (exitChanged) {
    return { ok: false, error: `Çıkış düzenlenemiyor: ${o.exitReason ?? 'bilinmiyor'}` };
  }
  if (hasKeys(cset)) for (const id of o.legIds) actions.push({ op: 'update', id, set: { ...cset } });
  if (!actions.length) return { ok: false, error: 'Değişiklik yok' };
  return { ok: true, actions, touched: actions.length };
}

/** Silme işlemleri (alış + bağlı satışlar). */
export function deleteActions(ids: number[]): KomutAction[] {
  return ids.map(id => ({ op: 'delete', id }));
}

/** Eşleşmiş işlemin dolum kimlikleri. Sig biçimi (src/lib/coach/fills.ts): `${tk|exp|k|cp}#${girişId}#${id x adet}+…`. */
export function tradeFillIds(sig: string): { entryId: number; legs: { id: number; q: number }[] } | null {
  const m = /^[^#]+#(\d+)#(.+)$/.exec(sig);
  if (!m) return null;
  const legs: { id: number; q: number }[] = [];
  for (const part of m[2].split('+')) {
    const x = /^(\d+)x(\d+)$/.exec(part);
    if (!x) return null;
    legs.push({ id: Number(x[1]), q: Number(x[2]) });
  }
  return { entryId: Number(m[1]), legs };
}
