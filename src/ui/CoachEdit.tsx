/* Koç elle düzenleme pencereleri (RN Modal, koyu tema, büyük dokunma alanları). Mantık: src/lib/coach/manual.ts.
 * Her pencere açıldığında yeniden mount edilir (üst bileşen `key` ile); form durumu ayrı tutulur.
 * Onay → onApply(actions) (üst bileşen applyKomut çağırır). Hata pencere içinde Türkçe gösterilir. */
import { useState, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Btn, tap } from './controls';
import { C } from './theme';
import {
  buildCloseAction, buildEntryEdit, buildTradeEdit, exitEditability, istNowHm, parseExpiry, parseHm, parsePrice, parseQty, parseStrike,
  tradeFillIds, type EditBuilt,
} from '@/lib/coach/manual';
import type { CoachOpenView, CoachTradeView, Fill, KomutAction } from '@/lib/coach/types';

const px = (x: number) => x.toFixed(2).replace('.', ',');
const dm = (exp: string) => `${exp.slice(8, 10)}.${exp.slice(5, 7)}`;

type OnApply = (actions: KomutAction[]) => Promise<void>;

/* ───── ortak parçalar ───── */

function Sheet({ title, sub, children, footer, onClose }: { title: string; sub?: string; children: ReactNode; footer: ReactNode; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: C.bg, paddingTop: insets.top + 8 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 10, gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 22, fontWeight: '800' }}>{title}</Text>
            {sub ? <Text style={{ color: C.muted, fontSize: 14, marginTop: 2 }}>{sub}</Text> : null}
          </View>
          <Btn label="Vazgeç" onPress={onClose} style={{ minHeight: 44 }} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 16, paddingBottom: 24 }}>
          {children}
        </ScrollView>
        <View style={{ padding: 16, paddingBottom: insets.bottom + 12, borderTopWidth: 1, borderColor: C.border, gap: 8 }}>{footer}</View>
      </View>
    </Modal>
  );
}

function BigField({ label, value, onChangeText, keyboard = 'decimal-pad', placeholder, editable = true, hint }: {
  label: string; value: string; onChangeText: (s: string) => void; keyboard?: 'decimal-pad' | 'number-pad' | 'numbers-and-punctuation' | 'default';
  placeholder?: string; editable?: boolean; hint?: string;
}) {
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: C.muted, fontSize: 15, fontWeight: '600' }}>{label}</Text>
      <TextInput value={value} onChangeText={onChangeText} keyboardType={keyboard} placeholder={placeholder} placeholderTextColor="#55617a"
        editable={editable} keyboardAppearance="dark" returnKeyType="done" selectTextOnFocus
        style={{ color: editable ? C.text : C.muted, backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 12,
          paddingHorizontal: 14, minHeight: 56, fontSize: 24, fontWeight: '700', fontVariant: ['tabular-nums'] }} />
      {hint ? <Text style={{ color: C.muted, fontSize: 13 }}>{hint}</Text> : null}
    </View>
  );
}

function BigSeg({ value, onChange }: { value: 'C' | 'P'; onChange: (v: 'C' | 'P') => void }) {
  const opt = (v: 'C' | 'P', label: string) => {
    const on = value === v;
    return (
      <Pressable key={v} onPress={() => { tap(); onChange(v); }} style={{ flex: 1, minHeight: 52, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? C.accent : 'transparent' }}>
        <Text style={{ color: on ? '#fff' : C.muted, fontSize: 18, fontWeight: '700' }}>{label}</Text>
      </Pressable>
    );
  };
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: C.muted, fontSize: 15, fontWeight: '600' }}>Tür</Text>
      <View style={{ flexDirection: 'row', backgroundColor: C.input, borderRadius: 12, padding: 3, borderWidth: 1, borderColor: C.border }}>
        {opt('C', 'Call (C)')}{opt('P', 'Put (P)')}
      </View>
    </View>
  );
}

const ErrLine = ({ text }: { text: string | null }) => (text ? <Text style={{ color: C.neg, fontSize: 15 }}>{text}</Text> : null);

/** Gönder düğmesi + busy: onApply reddederse hata gösterilir, pencere açık kalır. */
function useSubmit(onApply: OnApply, onDone: () => void) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const run = async (build: () => EditBuilt | { ok: true; actions: KomutAction[] } | { ok: false; error: string }) => {
    if (busy) return;
    const r = build();
    if (!r.ok) { setErr(r.error); return; }
    setBusy(true); setErr(null);
    try {
      await onApply(r.actions);
      onDone();
    } catch (e) {
      setErr((e as Error).message || 'Uygulanamadı');
    } finally {
      setBusy(false);
    }
  };
  return { busy, err, run };
}

/* ───── Kapat ───── */

export function CloseModal({ day, pos, onApply, onClose }: { day: string; pos: CoachOpenView; onApply: OnApply; onClose: () => void }) {
  const [priceT, setPriceT] = useState('');
  const [qtyT, setQtyT] = useState(String(pos.qty));
  const [hmT, setHmT] = useState(istNowHm());
  const { busy, err, run } = useSubmit(onApply, onClose);
  const qty = parseQty(qtyT);
  const setQty = (n: number) => { tap(); setQtyT(String(Math.min(pos.qty, Math.max(1, n)))); };
  const submit = () => run(() => {
    const b = buildCloseAction({
      day, tk: pos.tk, exp: pos.exp, k: pos.k, cp: pos.cp, openQty: pos.qty, entryT: pos.entryT,
      qty: qty ?? 0, px: parsePrice(priceT) ?? 0, hm: hmT,
    });
    return b.ok ? { ok: true, actions: [b.action] } : b;
  });
  return (
    <Sheet title="Kapat" sub={`${pos.tk} ${pos.k}${pos.cp} · ${dm(pos.exp)} · açık ${pos.qty} adet · giriş ${px(pos.entryPx)}`} onClose={onClose}
      footer={<>
        <ErrLine text={err} />
        <Btn kind="primary" label={busy ? 'Kaydediliyor…' : 'Onayla'} onPress={() => { void submit(); }} style={{ minHeight: 56 }} textStyle={{ fontSize: 18 }} />
      </>}>
      <BigField label="Çıkış fiyatı ($)" value={priceT} onChangeText={setPriceT} placeholder="ör. 3,20" hint="Virgül ya da nokta kabul edilir." />
      <View style={{ gap: 6 }}>
        <Text style={{ color: C.muted, fontSize: 15, fontWeight: '600' }}>Kontrat adedi (en çok {pos.qty})</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <Btn label="−" onPress={() => setQty((qty ?? pos.qty) - 1)} style={{ width: 60, minHeight: 56 }} textStyle={{ fontSize: 26 }} />
          <TextInput value={qtyT} onChangeText={setQtyT} keyboardType="number-pad" keyboardAppearance="dark" selectTextOnFocus
            style={{ flex: 1, textAlign: 'center', color: C.text, backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 12, minHeight: 56, fontSize: 24, fontWeight: '700' }} />
          <Btn label="+" onPress={() => setQty((qty ?? 0) + 1)} style={{ width: 60, minHeight: 56 }} textStyle={{ fontSize: 26 }} />
        </View>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Btn label="Tümü" onPress={() => setQty(pos.qty)} style={{ flex: 1, minHeight: 44 }} />
        </View>
      </View>
      <BigField label="Çıkış saati (İstanbul, HH:MM)" value={hmT} onChangeText={setHmT} keyboard="numbers-and-punctuation" placeholder="HH:MM"
        hint={`Gün: ${dm(day)}. Varsayılan şimdiki saat.`} />
    </Sheet>
  );
}

/* ───── Açık pozisyon: Düzenle ───── */

export function OpenEditModal({ pos, onApply, onClose }: { pos: CoachOpenView; onApply: OnApply; onClose: () => void }) {
  const total = pos.qty + pos.closedQty;
  const entryDay = pos.entryT.slice(0, 10);
  const [pxT, setPxT] = useState(px(pos.entryPx));
  const [qtyT, setQtyT] = useState(String(total));
  const [kT, setKT] = useState(String(pos.k));
  const [cp, setCp] = useState<'C' | 'P'>(pos.cp);
  const [expT, setExpT] = useState(pos.exp);
  const [hmT, setHmT] = useState(pos.entryT.slice(11, 16));
  const { busy, err, run } = useSubmit(onApply, onClose);
  const submit = () => run(() => {
    const pxv = parsePrice(pxT), q = parseQty(qtyT), k = parseStrike(kT), exp = parseExpiry(expT, entryDay), hm = parseHm(hmT);
    if (pxv == null) return { ok: false as const, error: 'Giriş fiyatı geçersiz' };
    if (q == null) return { ok: false as const, error: 'Adet geçersiz' };
    if (k == null) return { ok: false as const, error: 'Strike geçersiz' };
    if (exp == null) return { ok: false as const, error: 'Vade geçersiz (YYYY-MM-DD ya da GG.AA)' };
    if (hm == null) return { ok: false as const, error: 'Saat HH:MM olmalı' };
    if (pos.entryFillId == null) return { ok: false as const, error: 'Bu pozisyon düzenlenemiyor (sunucu güncellemesi gerekli)' };
    return buildEntryEdit(
      { id: pos.entryFillId, t: pos.entryT, px: pos.entryPx, q: total, k: pos.k, cp: pos.cp, exp: pos.exp },
      pos.legFillIds ?? [], { hm, px: pxv, q, k, cp, exp }, pos.closedQty, entryDay,
    );
  });
  return (
    <Sheet title="Pozisyonu düzenle" sub={`${pos.tk} · giriş dolumu (alış) · ${dayLabel(entryDay)}`} onClose={onClose}
      footer={<>
        <ErrLine text={err} />
        <Btn kind="primary" label={busy ? 'Kaydediliyor…' : 'Kaydet'} onPress={() => { void submit(); }} style={{ minHeight: 56 }} textStyle={{ fontSize: 18 }} />
      </>}>
      <BigField label="Giriş fiyatı ($)" value={pxT} onChangeText={setPxT} />
      <BigField label={`Toplam adet${pos.closedQty ? ` (en az ${pos.closedQty}: kapatılmış)` : ''}`} value={qtyT} onChangeText={setQtyT} keyboard="number-pad" />
      <BigField label="Strike" value={kT} onChangeText={setKT} />
      <BigSeg value={cp} onChange={setCp} />
      <BigField label="Vade (YYYY-MM-DD ya da GG.AA)" value={expT} onChangeText={setExpT} keyboard="numbers-and-punctuation" />
      <BigField label="Giriş saati (İstanbul, HH:MM)" value={hmT} onChangeText={setHmT} keyboard="numbers-and-punctuation" />
      {pos.legFillIds?.length ? <Text style={{ color: C.muted, fontSize: 13 }}>Strike, tür ve vade değişirse bağlı {pos.legFillIds.length} kapanış dolumu da güncellenir.</Text> : null}
    </Sheet>
  );
}

/* ───── İşlem (kapanmış): Düzenle ───── */

export function TradeEditModal({ trade, fills, onApply, onClose }: { trade: CoachTradeView; fills: Fill[]; onApply: OnApply; onClose: () => void }) {
  const ids = tradeFillIds(trade.sig);
  const entryDay = trade.entryT.slice(0, 10);
  const byId = new Map(fills.map(f => [f.id, f] as const));
  const ex = ids ? exitEditability(ids.legs, byId, trade.qty) : { editable: false, reason: 'dolum kimliği okunamadı' };
  const leg = ids?.legs.length === 1 ? byId.get(ids.legs[0].id) : undefined;
  const [pxT, setPxT] = useState(px(trade.entryPx));
  const [hmT, setHmT] = useState(trade.entryT.slice(11, 16));
  const [qtyT, setQtyT] = useState(String(trade.qty));
  const [kT, setKT] = useState(String(trade.k));
  const [cp, setCp] = useState<'C' | 'P'>(trade.cp);
  const [expT, setExpT] = useState(trade.exp);
  const [exPxT, setExPxT] = useState(px(trade.exitPx));
  const [exHmT, setExHmT] = useState(trade.exitT.slice(11, 16));
  const { busy, err, run } = useSubmit(onApply, onClose);
  const submit = () => run(() => {
    if (!ids) return { ok: false as const, error: 'Dolum kimlikleri okunamadı' };
    const pxv = parsePrice(pxT), q = parseQty(qtyT), k = parseStrike(kT), exp = parseExpiry(expT, entryDay), hm = parseHm(hmT);
    const exPx = parsePrice(exPxT), exHm = parseHm(exHmT);
    if (pxv == null) return { ok: false as const, error: 'Giriş fiyatı geçersiz' };
    if (q == null) return { ok: false as const, error: 'Adet geçersiz' };
    if (k == null) return { ok: false as const, error: 'Strike geçersiz' };
    if (exp == null) return { ok: false as const, error: 'Vade geçersiz (YYYY-MM-DD ya da GG.AA)' };
    if (hm == null) return { ok: false as const, error: 'Giriş saati HH:MM olmalı' };
    if (exPx == null || exHm == null) return { ok: false as const, error: 'Çıkış fiyatı ya da saati geçersiz' };
    return buildTradeEdit({
      entry: { id: ids.entryId, t: trade.entryT, px: trade.entryPx, q: trade.qty, k: trade.k, cp: trade.cp, exp: trade.exp },
      legIds: ids.legs.map(l => l.id),
      exitEditable: ex.editable, exitReason: ex.reason,
      exit: ex.editable && leg ? { id: leg.id, t: leg.t, px: leg.px, q: leg.q } : null,
      exitHm: trade.exitT.slice(11, 16), exitPx: trade.exitPx,
    }, { hm, px: pxv, q, k, cp, exp, exitHm: exHm, exitPx: exPx }, entryDay);
  });
  return (
    <Sheet title="İşlemi düzenle" sub={`${trade.tk} ${trade.k}${trade.cp} · ${dayLabel(entryDay)} · ${trade.legs} bacak`} onClose={onClose}
      footer={<>
        <ErrLine text={err} />
        <Btn kind="primary" label={busy ? 'Kaydediliyor…' : 'Kaydet'} onPress={() => { void submit(); }} style={{ minHeight: 56 }} textStyle={{ fontSize: 18 }} />
      </>}>
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>Alış (giriş)</Text>
      <BigField label="Giriş fiyatı ($)" value={pxT} onChangeText={setPxT} />
      <BigField label="Giriş saati (İstanbul, HH:MM)" value={hmT} onChangeText={setHmT} keyboard="numbers-and-punctuation" />
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginTop: 4 }}>Satış (çıkış)</Text>
      {ex.editable ? null : <Text style={{ color: C.warn, fontSize: 14 }}>Çıkış düzenlenemiyor: {ex.reason}. Çıkış fiyatı/saati ve adet kilitli.</Text>}
      <BigField label="Çıkış fiyatı ($)" value={exPxT} onChangeText={setExPxT} editable={ex.editable} />
      <BigField label="Çıkış saati (İstanbul, HH:MM)" value={exHmT} onChangeText={setExHmT} keyboard="numbers-and-punctuation" editable={ex.editable} />
      <Text style={{ color: C.text, fontSize: 17, fontWeight: '700', marginTop: 4 }}>Sözleşme</Text>
      <BigField label="Adet" value={qtyT} onChangeText={setQtyT} keyboard="number-pad" editable={ex.editable} hint={ex.editable ? undefined : 'Adet, çıkış ile birlikte kilitli.'} />
      <BigField label="Strike" value={kT} onChangeText={setKT} />
      <BigSeg value={cp} onChange={setCp} />
      <BigField label="Vade (YYYY-MM-DD ya da GG.AA)" value={expT} onChangeText={setExpT} keyboard="numbers-and-punctuation" />
      {ids ? <Text style={{ color: C.muted, fontSize: 12 }}>Satış dolumları: {ids.legs.map(l => `#${l.id} (${l.q} adet)`).join(', ')}</Text> : null}
      <Text style={{ color: C.muted, fontSize: 13 }}>Strike, tür ve vade değişirse bağlı satış dolumları da güncellenir.</Text>
    </Sheet>
  );
}

const dayLabel = (d: string) => d.split('-').reverse().join('.');
