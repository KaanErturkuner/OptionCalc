import { useMemo, useRef, useState } from 'react';
import { Platform, Pressable, View, Text, type GestureResponderEvent } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G as SG, Line, Path, Rect, Text as SvgText } from 'react-native-svg';
import * as St from '@/lib/strategy';
import type { Analysis } from '@/lib/strategy';
import { G, scnWhen, type AppState } from '@/lib/state';
import { closeMs } from '@/lib/usmarket';
import { compact, niceTicks, num, pct, shortDate, usd } from '@/lib/format';
import { C } from './theme';

interface Props {
  state: AppState; an: Analysis; width: number; range: [number, number]; scnD: string;
  onPickTarget: (S: number) => void; onScrubbing?: (on: boolean) => void;
}
const FF = Platform.OS === 'web' ? 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif' : undefined;
const H = 300, L = 50, R = 10, Tp = 14, B = 28;

export default function Chart({ state, an, width, range, scnD, onPickTarget, onScrubbing }: Props) {
  const [hx, setHx] = useState<number | null>(null);
  // Yakınlaştırma: görünür fiyat aralığı (null = tam aralık)
  const [zoom, setZoom] = useState<[number, number] | null>(null);
  const W = Math.max(width, 200), pw = W - L - R, ph = H - Tp - B;
  const full = range[1] - range[0];
  const [lo, hi] = zoom ?? range;
  const zoomed = zoom != null;
  const clampZ = (a: number, span: number): [number, number] | null => {
    span = Math.min(Math.max(span, full / 40, state.S * 0.002), full * 3);
    if (span >= full * 0.999 && Math.abs(a - range[0]) < full * 1e-3) return null;
    a = Math.max(a, state.S * 0.01);
    return [a, a + span];
  };
  const zoomBy = (f: number, center?: number) => {
    const c = center ?? (state.scn.target >= lo && state.scn.target <= hi ? state.scn.target : (lo + hi) / 2), span = (hi - lo) / f;
    setZoom(clampZ(c - (c - lo) / (hi - lo) * span, span));
  };
  const panBy = (fr: number) => { const span = hi - lo; setZoom(clampZ(lo + fr * span, span)); };
  // iki parmak: sıkıştır-yakınlaştır + kaydır; tek parmak: gez/hedef seç
  const pinch = useRef<{ d0: number; p0: number; span0: number } | null>(null);
  const pinched = useRef(false);
  const g = G(state), exp = an.expiry, iv = state.scn.ivShift;
  const showS = !(scnD === exp && !iv);

  const tE = closeMs(exp), tS = scnWhen(state, scnD, exp);
  const geo = useMemo(() => {
    const N = 90, xs: number[] = [], ye: number[] = [], ys: number[] = [];
    for (let i = 0; i <= N; i++) {
      const S = lo + (hi - lo) * i / N; xs.push(S);
      ye.push(St.pnl(state.legs, g, S, tE, 0, 'fast'));
      ys.push(showS ? St.pnl(state.legs, g, S, tS, iv, 'fast') : 0);
    }
    let ymin = Math.min(...ye, ...(showS ? ys : []), 0), ymax = Math.max(...ye, ...(showS ? ys : []), 0);
    if (ymax - ymin < 1) { ymax += 1; ymin -= 1; }
    const pad = (ymax - ymin) * 0.1; ymin -= pad; ymax += pad;
    const X = (S: number) => L + (S - lo) / (hi - lo) * pw, Y = (v: number) => Tp + (ymax - v) / (ymax - ymin) * ph;
    const line = (arr: number[]) => xs.map((S, i) => `${i ? 'L' : 'M'}${X(S).toFixed(1)},${Y(arr[i]).toFixed(1)}`).join('');
    const area = `M${X(xs[0])},${Y(0)}` + xs.map((S, i) => `L${X(S).toFixed(1)},${Y(ye[i]).toFixed(1)}`).join('') + `L${X(xs[N])},${Y(0)}Z`;
    return { xs, ye, ys, X, Y, ymin, ymax, lineE: line(ye), lineS: showS ? line(ys) : '', area };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.legs, state.S, state.r, state.q, state.now, state.divAmt, state.divDate, state.divRepeat, lo, hi, scnD, iv, pw, ph, exp, showS]);

  const { X, Y, ymin, ymax } = geo;
  const y0 = Math.min(Math.max(Y(0), Tp), Tp + ph);
  const ny = niceTicks(ymin, ymax, 6), nx = niceTicks(lo, hi, Math.max(3, Math.round(pw / 80)));
  const priceAt = (x: number) => lo + (Math.min(Math.max(x, L), L + pw) - L) / pw * (hi - lo);

  const twoFinger = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    if (!t || t.length < 2) return false;
    const d = Math.max(Math.abs(t[1].pageX - t[0].pageX), 20);
    const mx = e.nativeEvent.locationX + ((t[0].pageX + t[1].pageX) / 2 - e.nativeEvent.pageX);
    const fx = (Math.min(Math.max(mx, L), L + pw) - L) / pw;
    if (!pinch.current) { pinch.current = { d0: d, p0: lo + fx * (hi - lo), span0: hi - lo }; pinched.current = true; setHx(null); return true; }
    const P = pinch.current, span = P.span0 * P.d0 / d;
    setZoom(clampZ(P.p0 - fx * span, span));
    return true;
  };
  const onMove = (e: GestureResponderEvent) => { if (twoFinger(e)) return; if (!pinched.current) setHx(e.nativeEvent.locationX); };
  const vline = (S: number, color: string, label: string, dash: string, dy = 0) => {
    if (S < lo || S > hi) return null;
    const x = X(S), lx = Math.min(Math.max(x, L + 36), W - R - 36);
    return (
      <SG key={label}>
        <Line x1={x} y1={Tp} x2={x} y2={Tp + ph} stroke={color} strokeWidth={1} strokeDasharray={dash} />
        <SvgText fontFamily={FF} x={lx} y={Tp + 10 + dy} fill={color} fontSize={11} fontWeight="600" textAnchor="middle">{label}</SvgText>
      </SG>
    );
  };

  let tip: React.ReactNode = null;
  if (hx != null) {
    const S = priceAt(hx), x = X(S), pe = St.pnl(state.legs, g, S, tE, 0, 'fast'), ps = St.pnl(state.legs, g, S, tS, iv, 'fast');
    tip = (
      <>
        <Line x1={x} y1={Tp} x2={x} y2={Tp + ph} stroke="rgba(230,235,245,.45)" strokeWidth={1} />
        <Circle cx={x} cy={Y(pe)} r={5} fill={C.text} />
        {showS ? <Circle cx={x} cy={Y(ps)} r={5} fill={C.blue} /> : null}
      </>
    );
  }
  const hoverInfo = hx != null ? (() => {
    const S = priceAt(hx), pe = St.pnl(state.legs, g, S, tE, 0, 'fast'), ps = St.pnl(state.legs, g, S, tS, iv, 'fast');
    return { S, pe, ps };
  })() : null;

  return (
    <View>
      <View style={{ height: 40, justifyContent: 'center' }}>
        {hoverInfo ? (
          <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
            {num(hoverInfo.S, 2)} $ <Text style={{ color: C.muted, fontWeight: '500' }}>({pct(hoverInfo.S / state.S - 1)})</Text>
            {'  '}<Text style={{ color: hoverInfo.pe >= 0 ? C.pos : C.neg }}>Vade {usd(hoverInfo.pe, 0, true)}</Text>
            {showS ? <Text style={{ color: C.blue }}>{'  '}{shortDate(scnD)} {usd(hoverInfo.ps, 0, true)}</Text> : null}
          </Text>
        ) : (
          <Text style={{ color: C.muted, fontSize: 13 }}>Parmağını gezdir · bırakınca hedef olur · iki parmakla yakınlaştır</Text>
        )}
      </View>
      <View
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={e => { pinch.current = null; pinched.current = false; onScrubbing?.(true); onMove(e); }}
        onResponderMove={onMove}
        onResponderRelease={e => {
          const wasPinch = pinched.current; pinch.current = null; pinched.current = false;
          const S = priceAt(e.nativeEvent.locationX); setHx(null); onScrubbing?.(false);
          if (!wasPinch && S > 0) onPickTarget(+S.toFixed(2));
        }}
        onResponderTerminate={() => { pinch.current = null; pinched.current = false; setHx(null); onScrubbing?.(false); }}
      >
        <Svg width={W} height={H} pointerEvents="none">
          <Defs>
            <ClipPath id="up"><Rect x={L} y={Tp} width={pw} height={Math.max(y0 - Tp, 0)} /></ClipPath>
            <ClipPath id="dn"><Rect x={L} y={y0} width={pw} height={Math.max(Tp + ph - y0, 0)} /></ClipPath>
          </Defs>
          {an.expectedMove > 0 ? (() => {
            const a = X(Math.max(state.S - an.expectedMove, lo)), b = X(Math.min(state.S + an.expectedMove, hi));
            return b > a ? <Rect x={a} y={Tp} width={b - a} height={ph} fill="rgba(139,151,173,.09)" /> : null;
          })() : null}
          {ny.map(v => (
            <SG key={'y' + v}>
              <Line x1={L} y1={Y(v)} x2={W - R} y2={Y(v)} stroke="#1e2840" strokeWidth={1} />
              <SvgText fontFamily={FF} x={L - 6} y={Y(v) + 4} fill={C.muted} fontSize={10.5} textAnchor="end">{compact(v)}</SvgText>
            </SG>
          ))}
          {nx.map(v => (
            <SG key={'x' + v}>
              <Line x1={X(v)} y1={Tp} x2={X(v)} y2={Tp + ph} stroke="#1e2840" strokeWidth={1} />
              <SvgText fontFamily={FF} x={X(v)} y={H - 9} fill={C.muted} fontSize={10.5} textAnchor="middle">{num(v, v < 10 ? 1 : 0)}</SvgText>
            </SG>
          ))}
          <Line x1={L} y1={Y(0)} x2={W - R} y2={Y(0)} stroke="#5b6680" strokeWidth={1} />
          <Path d={geo.area} fill="rgba(34,197,94,.24)" clipPath="url(#up)" />
          <Path d={geo.area} fill="rgba(239,68,68,.24)" clipPath="url(#dn)" />
          <Path d={geo.lineE} stroke={C.text} strokeWidth={2} fill="none" />
          {showS ? <Path d={geo.lineS} stroke={C.blue} strokeWidth={2.2} fill="none" /> : null}
          {vline(state.S, '#cbd5e1', 'Şimdi ' + num(state.S, 2), '4,4')}
          {vline(state.scn.target, C.warn, 'Hedef ' + num(state.scn.target, 2), '2,3', Math.abs(X(state.scn.target) - X(state.S)) < 80 ? 14 : 0)}
          {an.breakevens.filter(b => b >= lo && b <= hi).map(b => <Circle key={'be' + b} cx={X(b)} cy={Y(0)} r={4} fill={C.warn} />)}
          {tip}
        </Svg>
      </View>
      <View style={{ flexDirection: 'row', gap: 6, marginTop: 8, alignItems: 'center' }}>
        <ZBtn label="−" onPress={() => zoomBy(1 / 1.6)} a11y="Uzaklaştır" />
        <ZBtn label="+" onPress={() => zoomBy(1.6)} a11y="Yakınlaştır" />
        <ZBtn label="◀" onPress={() => panBy(-0.25)} a11y="Sola kaydır" disabled={!zoomed} />
        <ZBtn label="▶" onPress={() => panBy(0.25)} a11y="Sağa kaydır" disabled={!zoomed} />
        <ZBtn label="Sıfırla" onPress={() => setZoom(null)} a11y="Yakınlaştırmayı sıfırla" disabled={!zoomed} wide />
        <Text style={{ color: C.muted, fontSize: 12, marginLeft: 'auto', fontVariant: ['tabular-nums'] }}>{zoomed ? `${(full / (hi - lo)).toFixed(1)}×` : ''}</Text>
      </View>
    </View>
  );
}
function ZBtn({ label, onPress, a11y, disabled, wide }: { label: string; onPress: () => void; a11y: string; disabled?: boolean; wide?: boolean }) {
  return (
    <Pressable onPress={onPress} disabled={disabled} accessibilityLabel={a11y} hitSlop={4}
      style={({ pressed }) => ({ minWidth: wide ? 70 : 44, height: 40, paddingHorizontal: 10, borderRadius: 10, alignItems: 'center', justifyContent: 'center',
        backgroundColor: C.card2, borderWidth: 1, borderColor: C.border, opacity: disabled ? 0.35 : pressed ? 0.6 : 1 })}>
      <Text style={{ color: C.text, fontSize: wide ? 14 : 20, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
