import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import * as BS from '@/lib/bs';
import * as St from '@/lib/strategy';
import type { Leg, Globals } from '@/lib/strategy';
import { num, parseTrDate, trDate, usd } from '@/lib/format';
import { Btn, NumField, Seg, s, tap } from './controls';
import { C, plColor } from './theme';

export function DateField({ label, value, onValue, flex = 1 }: { label: string; value: string; onValue: (d: string) => void; flex?: number }) {
  const [t, setT] = useState(trDate(value));
  const [bad, setBad] = useState(false);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); setT(trDate(value)); setBad(false); }
  return (
    <View style={{ flex, minWidth: 0 }}>
      <Text style={s.label}>{label}</Text>
      <View style={[s.inputWrap, bad && { borderColor: C.neg }]}>
        <TextInput value={t} onChangeText={x => { setT(x); const d = parseTrDate(x); setBad(!d && x.length >= 8); if (d) onValue(d); }}
          onBlur={() => { setT(trDate(value)); setBad(false); }}
          placeholder="gg.aa.yyyy" placeholderTextColor="#55617a" keyboardType="numbers-and-punctuation" keyboardAppearance="dark"
          selectTextOnFocus returnKeyType="done" style={[s.input, { fontVariant: ['tabular-nums'] }]} />
      </View>
    </View>
  );
}

export default function LegCard({ leg, g, onChange, onDelete, toast }: {
  leg: Leg; g: Globals; onChange: (l: Leg) => void; onDelete: () => void; toast: (m: string) => void;
}) {
  const set = (p: Partial<Leg>) => onChange({ ...leg, ...p });
  const short = leg.side < 0;
  const border = { borderLeftWidth: 4, borderLeftColor: leg.kind === 'stock' ? C.muted : short ? C.neg : C.pos };

  if (leg.kind === 'stock') {
    return (
      <View style={[st.leg, border]}>
        <View style={s.row}>
          <Seg options={[[1, 'Long'], [-1, 'Short']]} value={leg.side} onChange={v => set({ side: v })} style={{ flex: 1 }} />
          <Text style={st.tag}>HİSSE</Text>
          <DelBtn onPress={onDelete} />
        </View>
        <View style={[s.row, { marginTop: 10, alignItems: 'flex-end' }]}>
          <NumField label="Hisse adedi" value={leg.qty} onValue={v => set({ qty: Math.max(v ?? 0, 0) })} keyboard="number-pad" />
          <NumField label="Alış fiyatı ($)" value={leg.premium} allowEmpty placeholder={'güncel ' + num(g.S, 2)}
            onValue={v => set({ premium: v })} />
        </View>
        <Text style={st.info}>Pozisyon <Text style={st.b}>{usd(leg.qty * St.legEntry(leg, g))}</Text>   Delta <Text style={st.b}>{num(leg.side * leg.qty, 0)}</Text></Text>
      </View>
    );
  }

  const dte = St.daysBetween(g.today, leg.expiry);
  const th = St.legTheo(leg, g), x = St.legGreeks(leg, g, g.S, g.today, 0), k = leg.side * leg.qty * 100;
  const solve = () => {
    if (leg.premium == null) return toast('Önce gerçek primi yaz');
    const iv = BS.impliedVol(leg.kind as BS.OptType, leg.premium, g.S, leg.strike, Math.max(dte, 0) / 365, g.r / 100, g.q / 100);
    if (!isFinite(iv)) return toast('Bu primle IV çözülemedi');
    const v = +(iv * 100).toFixed(2); set({ iv: v }); toast('IV = %' + num(v, 2));
  };
  return (
    <View style={[st.leg, border]}>
      <View style={s.row}>
        <Seg options={[[1, 'Long'], [-1, 'Short']]} value={leg.side} onChange={v => set({ side: v })} style={{ flex: 1 }} small />
        <Seg options={[['call', 'Call'], ['put', 'Put']]} value={leg.kind} onChange={v => set({ kind: v })} style={{ flex: 1 }} small />
        <DelBtn onPress={onDelete} />
      </View>
      <View style={[s.row, { marginTop: 10 }]}>
        <NumField label="Strike ($)" value={leg.strike} onValue={v => { if (v != null && v > 0) set({ strike: v }); }} />
        <NumField label="IV %" value={leg.iv} onValue={v => { if (v != null && v > 0) set({ iv: v }); }} />
        <NumField label="Kontrat" value={leg.qty} keyboard="number-pad" onValue={v => { if (v != null && v >= 0) set({ qty: v }); }} />
      </View>
      <View style={[s.row, { marginTop: 10, alignItems: 'flex-end' }]}>
        <DateField label="Vade tarihi" value={leg.expiry} onValue={d => set({ expiry: d })} flex={1.4} />
        <Pressable onPress={() => { tap(); if (dte > 0) set({ expiry: St.addDays(g.today, dte - 1) }); }} style={st.step} hitSlop={4}><Text style={st.stepT}>−</Text></Pressable>
        <NumField label="Gün" value={dte} keyboard="number-pad" style={{ flex: 0.7 }}
          onValue={v => { if (v != null && v >= 0) set({ expiry: St.addDays(g.today, Math.round(v)) }); }} />
        <Pressable onPress={() => { tap(); set({ expiry: St.addDays(g.today, dte + 1) }); }} style={st.step} hitSlop={4}><Text style={st.stepT}>+</Text></Pressable>
      </View>
      <View style={[s.row, { marginTop: 10, alignItems: 'flex-end' }]}>
        <NumField label="Prim (1 hisse, $) — boşsa teorik" value={leg.premium} allowEmpty placeholder={'teorik ' + num(th, 2)}
          onValue={v => set({ premium: v })} />
        <Btn label="IV ← prim" onPress={solve} />
      </View>
      <View style={st.infoRow}>
        <Text style={st.info}>Teorik <Text style={st.b}>{num(th, 2)} $</Text></Text>
        <Text style={st.info}>Pozisyon <Text style={st.b}>{usd(leg.qty * 100 * St.legEntry(leg, g))}</Text></Text>
        <Text style={st.info}>Δ <Text style={st.b}>{num(x.delta / (k || 1), 3)}</Text></Text>
        <Text style={st.info}>Θ <Text style={st.b}>{usd(x.theta, 2, true)}</Text>/gün</Text>
        <Text style={st.info}>Vega <Text style={st.b}>{usd(x.vega, 2, true)}</Text></Text>
        {leg.premium != null ? <Text style={st.info}>Teorik − prim <Text style={[st.b, { color: plColor(th - leg.premium) }]}>{num(th - leg.premium, 2)}</Text></Text> : null}
      </View>
    </View>
  );
}

function DelBtn({ onPress }: { onPress: () => void }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={8} style={st.del} accessibilityLabel="Bacağı sil">
      <Text style={{ color: C.muted, fontSize: 18, fontWeight: '700' }}>✕</Text>
    </Pressable>
  );
}

const st = {
  leg: { backgroundColor: C.card2, borderRadius: 14, padding: 12, marginBottom: 10 },
  tag: { color: C.muted, fontWeight: '800' as const, fontSize: 13, letterSpacing: 1 },
  del: { width: 40, height: 40, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.input },
  step: { width: 40, height: 46, borderRadius: 11, alignItems: 'center' as const, justifyContent: 'center' as const, backgroundColor: C.input, borderWidth: 1, borderColor: C.border },
  stepT: { color: C.text, fontSize: 22, fontWeight: '600' as const },
  infoRow: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, columnGap: 14, rowGap: 4, marginTop: 10 },
  info: { color: C.muted, fontSize: 12.5 },
  b: { color: C.text, fontWeight: '700' as const, fontVariant: ['tabular-nums' as const] },
};
