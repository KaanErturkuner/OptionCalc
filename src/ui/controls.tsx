import { useState, type ReactNode } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import * as Haptics from 'expo-haptics';
import { C, mono } from './theme';
import { editStr, parseNum, parseTrDate, trDate } from '@/lib/format';

export const tap = () => { if (Platform.OS !== 'web') Haptics.selectionAsync().catch(() => {}); };

export function Card({ title, step, right, children, style }: { title?: string; step?: number; right?: ReactNode; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[s.card, style]}>
      {title ? (
        <View style={s.cardHead}>
          <View style={s.row}>
            {step ? <View style={s.step}><Text style={s.stepT}>{step}</Text></View> : null}
            <Text style={s.h2}>{title}</Text>
          </View>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

export function Seg<T extends string | number>({ options, value, onChange, small, style }: {
  options: [T, string][]; value: T | null; onChange: (v: T) => void; small?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[s.seg, style]}>
      {options.map(([v, label]) => {
        const on = v === value;
        return (
          <Pressable key={String(v)} onPress={() => { tap(); onChange(v); }} hitSlop={4}
            style={[s.segBtn, small && s.segBtnSmall, on && s.segOn]}>
            <Text style={[s.segT, small && { fontSize: 14 }, on && s.segTOn]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function Btn({ label, onPress, kind = 'ghost', style, textStyle }: {
  label: string; onPress: () => void; kind?: 'ghost' | 'primary' | 'danger'; style?: StyleProp<ViewStyle>; textStyle?: StyleProp<TextStyle>;
}) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={4}
      style={({ pressed }) => [s.btn, kind === 'primary' && s.btnPrimary, kind === 'danger' && s.btnDanger, pressed && { opacity: .6 }, style]}>
      <Text style={[s.btnT, kind === 'danger' && { color: C.neg }, textStyle]}>{label}</Text>
    </Pressable>
  );
}

export function Chip({ label, onPress, active }: { label: string; onPress: () => void; active?: boolean }) {
  return (
    <Pressable onPress={() => { tap(); onPress(); }} hitSlop={3}
      style={({ pressed }) => [s.chip, active && s.segOn, pressed && { opacity: .6 }]}>
      <Text style={[s.chipT, active && s.segTOn]}>{label}</Text>
    </Pressable>
  );
}

/** Sayı kutusu: Türkçe virgüllü giriş, odaktayken dışarıdan üzerine yazmaz */
export function NumField({ label, value, onValue, placeholder, digits = 6, big, style, suffix, keyboard = 'decimal-pad', allowEmpty, textColor, center }: {
  label?: string; value: number | null; onValue: (v: number | null) => void; placeholder?: string; digits?: number;
  big?: boolean; style?: StyleProp<ViewStyle>; suffix?: string; keyboard?: 'decimal-pad' | 'numbers-and-punctuation' | 'number-pad'; allowEmpty?: boolean;
  textColor?: string; center?: boolean;
}) {
  const [text, setText] = useState(editStr(value, digits));
  const [focused, setFocused] = useState(false);
  const [prev, setPrev] = useState(value);
  if (value !== prev) { setPrev(value); if (!focused) setText(editStr(value, digits)); }
  return (
    <View style={[{ flex: 1, minWidth: 0 }, style]}>
      {label ? <Text style={s.label} numberOfLines={1}>{label}</Text> : null}
      <View style={[s.inputWrap, big && s.inputWrapBig]}>
        <TextInput
          value={text} placeholder={placeholder} placeholderTextColor="#55617a" keyboardType={keyboard}
          keyboardAppearance="dark" selectTextOnFocus returnKeyType="done"
          onFocus={() => setFocused(true)}
          onBlur={() => { setFocused(false); setText(editStr(value, digits)); }}
          onChangeText={t => {
            setText(t);
            const x = parseNum(t);
            if (t.trim() === '' && allowEmpty) onValue(null);
            else if (isFinite(x)) onValue(x);
          }}
          style={[s.input, big && s.inputBig, mono, textColor ? { color: textColor } : null, center ? { textAlign: 'center' } : null]}
        />
        {suffix ? <Text style={[s.suffix, big && { fontSize: 18 }]}>{suffix}</Text> : null}
      </View>
    </View>
  );
}


/** − [sayı] + : büyük dokunma alanlı adım kutusu, ortadaki sayıya dokunup yazılabilir */
export function StepField({ label, value, onValue, step, min = 0, digits = 2, suffix, big, style, allowEmpty, placeholder, color }: {
  label?: string; value: number | null; onValue: (v: number | null) => void; step: number; min?: number; digits?: number;
  suffix?: string; big?: boolean; style?: StyleProp<ViewStyle>; allowEmpty?: boolean; placeholder?: string; color?: string;
}) {
  const bump = (dir: number) => {
    const base = value ?? 0;
    const nv = +(Math.round((base + dir * step) / step) * step).toFixed(6);
    if (nv >= min) onValue(nv);
  };
  return (
    <View style={[{ flex: 1, minWidth: 0 }, style]}>
      {label ? <Text style={s.label} numberOfLines={1}>{label}</Text> : null}
      <View style={s.row}>
        <Pressable onPress={() => { tap(); bump(-1); }} hitSlop={6} style={({ pressed }) => [s.stepBtn, big && s.stepBtnBig, pressed && { opacity: .5 }]}
          accessibilityLabel={(label || '') + ' azalt'}>
          <Text style={s.stepBtnT}>−</Text>
        </Pressable>
        <NumField value={value} onValue={onValue} digits={digits} big={big} suffix={suffix} allowEmpty={allowEmpty} placeholder={placeholder}
          textColor={color} center />
        <Pressable onPress={() => { tap(); bump(1); }} hitSlop={6} style={({ pressed }) => [s.stepBtn, big && s.stepBtnBig, pressed && { opacity: .5 }]}
          accessibilityLabel={(label || '') + ' artır'}>
          <Text style={s.stepBtnT}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

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

export function TextField({ label, value, onChange, placeholder, style, autoCapitalize = 'characters' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; style?: StyleProp<ViewStyle>; autoCapitalize?: 'characters' | 'none';
}) {
  return (
    <View style={[{ flex: 1, minWidth: 0 }, style]}>
      <Text style={s.label}>{label}</Text>
      <View style={s.inputWrap}>
        <TextInput value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor="#55617a"
          autoCapitalize={autoCapitalize} autoCorrect={false} keyboardAppearance="dark" returnKeyType="done" style={s.input} />
      </View>
    </View>
  );
}

export function Stat({ k, v, sub, color }: { k: string; v: string; sub?: string; color?: string }) {
  return (
    <View style={s.stat}>
      <Text style={s.statK} numberOfLines={1}>{k}</Text>
      <Text style={[s.statV, mono, color ? { color } : null]} numberOfLines={1} adjustsFontSizeToFit>{v}</Text>
      {sub ? <Text style={s.statS} numberOfLines={2}>{sub}</Text> : null}
    </View>
  );
}

export const s = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: { backgroundColor: C.card, borderRadius: 18, padding: 14, marginBottom: 12, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, gap: 8 },
  h2: { color: C.text, fontSize: 18, fontWeight: '700', flexShrink: 1 },
  step: { width: 24, height: 24, borderRadius: 12, backgroundColor: C.accentSoft, alignItems: 'center', justifyContent: 'center' },
  stepT: { color: C.blue, fontWeight: '800', fontSize: 13 },
  seg: { flexDirection: 'row', backgroundColor: C.input, borderRadius: 12, padding: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: C.border },
  segBtn: { flex: 1, minHeight: 40, paddingHorizontal: 10, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  segBtnSmall: { minHeight: 34, paddingHorizontal: 8 },
  segOn: { backgroundColor: C.accent },
  segT: { color: C.muted, fontWeight: '600', fontSize: 15 },
  segTOn: { color: '#fff' },
  btn: { minHeight: 44, paddingHorizontal: 14, borderRadius: 12, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.border, backgroundColor: C.card2 },
  btnPrimary: { backgroundColor: C.accent, borderColor: C.accent },
  btnDanger: { backgroundColor: 'transparent', borderColor: 'rgba(239,68,68,.4)' },
  btnT: { color: C.text, fontWeight: '600', fontSize: 15 },
  chip: { minHeight: 38, paddingHorizontal: 12, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border },
  chipT: { color: C.text, fontWeight: '600', fontSize: 14 },
  label: { color: C.muted, fontSize: 12, fontWeight: '600', marginBottom: 5 },
  inputWrap: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.input, borderRadius: 11, borderWidth: 1, borderColor: C.border, paddingHorizontal: 10, minHeight: 46 },
  inputWrapBig: { minHeight: 56, borderColor: C.accent },
  input: { flex: 1, minWidth: 0, color: C.text, fontSize: 17, paddingVertical: 10 },
  inputBig: { fontSize: 26, fontWeight: '700' },
  suffix: { color: C.muted, fontSize: 15, marginLeft: 4 },
  stat: { width: '48%', flexGrow: 1, backgroundColor: C.card2, borderRadius: 14, padding: 12 },
  statK: { color: C.muted, fontSize: 12, fontWeight: '600' },
  statV: { color: C.text, fontSize: 21, fontWeight: '800', marginTop: 4 },
  statS: { color: C.muted, fontSize: 12, marginTop: 3 },
  hint: { color: C.muted, fontSize: 12.5, lineHeight: 18, marginTop: 10 },
  muted: { color: C.muted },
  stepBtn: { width: 46, height: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.card2, borderWidth: 1, borderColor: C.border },
  stepBtnBig: { width: 56, height: 56, borderRadius: 14 },
  stepBtnT: { color: C.text, fontSize: 26, fontWeight: '600', lineHeight: 30 },
});
