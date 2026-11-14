/* Rapor görünüm parçaları (Raporlar ekranı): karar rozeti, özet kartı, metrik kartları, kompakt duvar merdiveni,
 * takvim zaman çizelgesi, haber listesi, akış yığını ve gün sonu incelemesi. Veri ve geometri: src/lib/reports/*.
 * Renkler src/ui/theme.ts; metinler Türkçe; "veri alınamadı" durumları her parçada açıkça yazılır. */
import { Text, View } from 'react-native';
import Svg, { G, Line, Text as SvgText } from 'react-native-svg';
import { fmt } from '@/lib/format';
import { fmtUsdShort } from '@/lib/flow/model';
import { ladderLayout, MARK_LABEL, type MarkKey } from '@/lib/reports/ladder';
import { levelText, shiftArrow } from '@/lib/reports/sections';
import type { Bias, CalItem, Chip, EodReview, FlowSection, Impact, KeyLevel, NewsCard, ReportSections, Tone, WallRow } from '@/lib/reports/types';
import { C } from './theme';

const NA = 'veri alınamadı';
export const BIAS_COLOR: Record<Bias, string> = { CALL: C.pos, PUT: C.neg, BEKLE: C.warn };
const TONE_COLOR: Record<Tone, string> = { pos: C.pos, neg: C.neg, warn: C.warn, text: C.text, muted: C.muted };
const IMPACT_COLOR: Record<Impact, string> = { high: C.neg, med: C.warn, low: C.muted };
const IMPACT_LABEL: Record<Impact, string> = { high: 'Yüksek', med: 'Orta', low: 'Düşük' };
const MARK_COLOR: Record<MarkKey, string> = { spot: C.text, callWall: C.pos, putWall: C.neg, gammaFlip: C.warn, maxPain: C.blue };

/** Renkli etiket (rozet): kenarlıklı, hafif dolgulu */
export function Pill({ text, color, size = 11 }: { text: string; color: string; size?: number }) {
  return (
    <Text style={{ color, fontSize: size, fontWeight: '800', borderWidth: 1, borderColor: color, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1, overflow: 'hidden' }}>
      {text}
    </Text>
  );
}

/** CALL / PUT / BEKLE rozeti. Veri yoksa soluk (muted) renkle. */
export function BiasBadge({ bias, dataOk = true, size = 'md' }: { bias: Bias; dataOk?: boolean; size?: 'sm' | 'md' | 'lg' }) {
  const color = dataOk ? BIAS_COLOR[bias] : C.muted;
  const fs = size === 'lg' ? 20 : size === 'md' ? 13 : 11;
  return (
    <View style={{ backgroundColor: color + '26', borderWidth: 1, borderColor: color, borderRadius: 999, paddingHorizontal: size === 'lg' ? 14 : 9, paddingVertical: size === 'lg' ? 5 : 2, alignSelf: 'flex-start' }}>
      <Text style={{ color, fontSize: fs, fontWeight: '900', letterSpacing: 0.6 }}>{bias}</Text>
    </View>
  );
}

export function SectionTitle({ children }: { children: string }) {
  return <Text style={{ color: C.muted, fontSize: 11, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase', marginTop: 6 }}>{children}</Text>;
}

/** Üst kart: karar rozeti, ana seviyeler, tek cümle plan */
export function SummaryCard({ s, title }: { s: ReportSections['summary']; title: string }) {
  return (
    <View style={{ backgroundColor: C.card2, borderRadius: 14, borderWidth: 1, borderColor: BIAS_COLOR[s.bias] + '66', padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{title}</Text>
        <BiasBadge bias={s.bias} dataOk={s.dataOk} size="lg" />
      </View>
      {s.keyLevels.length ? <LevelRow levels={s.keyLevels} /> : null}
      <Text style={{ color: C.text, fontSize: 13.5, lineHeight: 19 }}>{s.plan}</Text>
    </View>
  );
}

function LevelRow({ levels }: { levels: KeyLevel[] }) {
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {levels.map(l => (
        <View key={l.label} style={{ backgroundColor: C.card, borderRadius: 8, borderWidth: 1, borderColor: C.border, paddingHorizontal: 8, paddingVertical: 4 }}>
          <Text style={{ color: C.muted, fontSize: 10.5 }}>{l.label}</Text>
          <Text style={{ color: C.text, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{l.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** Metrik kartları (ızgara): etiket, değer (yeşil/kırmızı), alt metin (fiyat) */
export function MetricGrid({ chips }: { chips: Chip[] }) {
  if (!chips.length) return <Text style={{ color: C.muted, fontSize: 13 }}>{NA}</Text>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {chips.map((c, i) => (
        <View key={c.label + i} style={{ minWidth: 92, flexGrow: 1, backgroundColor: C.card2, borderRadius: 10, borderWidth: 1, borderColor: C.border, paddingHorizontal: 9, paddingVertical: 6 }}>
          <Text style={{ color: C.muted, fontSize: 11, fontWeight: '700' }}>{c.label}</Text>
          <Text style={{ color: TONE_COLOR[c.tone], fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{c.value}</Text>
          {c.sub ? <Text style={{ color: C.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>{c.sub}</Text> : null}
        </View>
      ))}
    </View>
  );
}

const shiftText = (from: number | null | undefined, to: number | null | undefined) => {
  const a = shiftArrow(from, to);
  if (!a) return '';
  return a === '=' ? ' (=)' : ` ${a}${levelText(Math.abs((to ?? 0) - (from ?? 0))) ?? ''}`;
};

/** Kompakt dikey duvar merdiveni: spot, call/put duvarı, gamma flip, max pain işaret çizgileri (yüksek fiyat üstte) */
export function WallLadder({ w, width = 132, height = 168 }: { w: WallRow; width?: number; height?: number }) {
  const L = ladderLayout(w, height);
  if (!L.marks.length) return <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: C.muted, fontSize: 11 }}>{NA}</Text></View>;
  const axisX = 10, labelX = width - 4;
  return (
    <Svg width={width} height={height}>
      <Line x1={axisX} x2={axisX} y1={6} y2={height - 6} stroke={C.border} strokeWidth={1.5} />
      {L.marks.map(m => {
        const dash = m.key === 'spot' ? undefined : '4 3';
        const color = MARK_COLOR[m.key];
        return (
          <G key={m.key}>
            <Line x1={axisX} x2={width - 2} y1={m.y} y2={m.y} stroke={color} strokeWidth={m.key === 'spot' ? 1.8 : 1.2} strokeDasharray={dash} />
            <SvgText x={labelX} y={m.y - 3} fontSize={10} fill={color} textAnchor="end" fontWeight={m.key === 'spot' ? '700' : '400'}>
              {`${MARK_LABEL[m.key]} ${levelText(m.price)}`}
            </SvgText>
          </G>
        );
      })}
    </Svg>
  );
}

/** Duvar kartı: ticker, kaynak etiketi, merdiven ve değer listesi (önceki → şimdi, oklarla) */
export function WallCard({ w }: { w: WallRow }) {
  const prev = w.prev, label = w.prevLabel;
  const line = (name: string, now: number | null, before: number | null | undefined, color: string) => (
    <View key={name} style={{ gap: 1 }}>
      <Text style={{ color: C.muted, fontSize: 11 }}>{name}</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
        {levelText(now) ?? '—'}
        {before != null ? <Text style={{ color: C.muted, fontSize: 11.5, fontWeight: '600' }}>{`  ${label ?? 'önce'} ${levelText(before)}${shiftText(before, now)}`}</Text> : null}
      </Text>
    </View>
  );
  return (
    <View style={{ backgroundColor: C.card2, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
        <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>{w.ticker}</Text>
        <Text style={{ color: C.muted, fontSize: 11, fontVariant: ['tabular-nums'] }}>spot {levelText(w.spot) ?? '—'}</Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <WallLadder w={w} />
        <View style={{ flex: 1, gap: 7 }}>
          {line('Call duvarı', w.callWall, prev?.callWall, C.pos)}
          {line('Put duvarı', w.putWall, prev?.putWall, C.neg)}
          {line('Gamma flip', w.gammaFlip, prev?.gammaFlip, C.warn)}
          {line('Max pain', w.maxPain, null, C.blue)}
        </View>
      </View>
      <Text style={{ color: C.muted, fontSize: 11 }}>{w.source}</Text>
    </View>
  );
}

/** Takvim: bugün ve (gün sonunda) yarın; etki rengi, ET + İstanbul saat, açıklandı/bekleniyor */
export function CalendarTimeline({ items }: { items: CalItem[] }) {
  if (!items.length) return <Text style={{ color: C.muted, fontSize: 13 }}>Önemli veri yok</Text>;
  return (
    <View style={{ gap: 2 }}>
      {items.map((e, i) => {
        const color = IMPACT_COLOR[e.impact];
        return (
          <View key={e.name + e.time + i} style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ alignItems: 'center', width: 12 }}>
              <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color, marginTop: 5 }} />
              {i < items.length - 1 ? <View style={{ flex: 1, width: 2, backgroundColor: C.border, marginTop: 2 }} /> : null}
            </View>
            <View style={{ flex: 1, paddingBottom: 9, gap: 2 }}>
              <Text style={{ color: C.text, fontSize: 13.5, fontWeight: '700' }}>{e.name}</Text>
              <Text style={{ color: C.muted, fontSize: 11.5, fontVariant: ['tabular-nums'] }}>
                {e.tomorrow ? 'Yarın · ' : ''}{e.time} · {e.istTime} İst · <Text style={{ color }}>{IMPACT_LABEL[e.impact]}</Text>
                {e.released ? ' · açıklandı' : ' · bekleniyor'}{e.verified ? '' : ' · tarih doğrulanmadı'}
              </Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

/** Haberler: kısa madde, etki etiketi (Makro / İzleme / Genel) */
export function NewsList({ items, ok }: { items: NewsCard[]; ok: boolean }) {
  if (!ok) return <Text style={{ color: C.muted, fontSize: 13 }}>{NA}</Text>;
  if (!items.length) return <Text style={{ color: C.muted, fontSize: 13 }}>Önemli yeni haber yok</Text>;
  return (
    <View style={{ gap: 9 }}>
      {items.map((n, i) => (
        <View key={n.headline + i} style={{ gap: 3 }}>
          <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
            <Pill text={n.tag} color={IMPACT_COLOR[n.impact]} size={10} />
            <Text style={{ color: C.text, fontSize: 13.5, lineHeight: 18, flex: 1 }}>{n.headline}</Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 11, marginLeft: 2 }}>{n.source} · {n.time} İst</Text>
        </View>
      ))}
    </View>
  );
}

/** Akış yığını: call/put prim payı (yatay çubuk) ve en büyük kontratlar */
export function FlowStack({ flow }: { flow: FlowSection }) {
  if (!flow.known) return <Text style={{ color: C.muted, fontSize: 13 }}>{NA}</Text>;
  const total = flow.callPremium + flow.putPremium;
  if (total <= 0) return <Text style={{ color: C.muted, fontSize: 13 }}>Eşik üstü birikim yok</Text>;
  const callPct = Math.round((flow.callShare ?? 0) * 100);
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ color: C.muted, fontSize: 11.5 }}>{flow.source}</Text>
      <View style={{ height: 14, borderRadius: 7, overflow: 'hidden', flexDirection: 'row', backgroundColor: C.card2 }}>
        <View style={{ width: `${callPct}%`, backgroundColor: C.pos }} />
        <View style={{ flex: 1, backgroundColor: C.neg }} />
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ color: C.pos, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>Call {callPct}% · {fmtUsdShort(flow.callPremium)}</Text>
        <Text style={{ color: C.neg, fontSize: 12, fontWeight: '700', fontVariant: ['tabular-nums'] }}>Put {100 - callPct}% · {fmtUsdShort(flow.putPremium)}</Text>
      </View>
      <View style={{ gap: 5, marginTop: 2 }}>
        {flow.top.map((t, i) => (
          <View key={t.label + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Pill text={t.side === 'call' ? 'C' : 'P'} color={t.side === 'call' ? C.pos : C.neg} size={10} />
            <Text style={{ color: C.text, fontSize: 12.5, flex: 1 }}>{t.label}</Text>
            <Text style={{ color: C.muted, fontSize: 11.5, fontVariant: ['tabular-nums'] }}>{fmt(t.contracts, 0)} kont. · {fmtUsdShort(t.premium)}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

const RESULT: Record<EodReview['result'], { text: string; color: string }> = {
  hit: { text: 'İSABET', color: C.pos },
  miss: { text: 'IŞKA', color: C.neg },
  'veri yok': { text: 'VERİ YOK', color: C.muted },
};

/** Gün sonu incelemesi: sabah beklentisi – gerçek, duvar kayması okları, yarın planı */
export function EodCard({ eod }: { eod: EodReview }) {
  const r = RESULT[eod.result];
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <Text style={{ color: C.muted, fontSize: 12 }}>Sabah beklentisi</Text>
        {eod.expected ? <BiasBadge bias={eod.expected} size="sm" /> : <Text style={{ color: C.muted, fontSize: 12 }}>yok</Text>}
        <Text style={{ color: C.muted, fontSize: 12 }}>→ gün sonu</Text>
        <BiasBadge bias={eod.actual} size="sm" />
        <Pill text={r.text} color={r.color} />
      </View>
      <Text style={{ color: C.muted, fontSize: 12, fontVariant: ['tabular-nums'] }}>{eod.outcome}</Text>
      {eod.shifts.length ? (
        <View style={{ gap: 4 }}>
          <SectionTitle>Duvar kayması (açılış/önceki → kapanış)</SectionTitle>
          {eod.shifts.map((s, i) => (
            <View key={s.ticker + s.what + i} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text style={{ color: C.text, fontSize: 13, flex: 1 }}>{s.ticker} {s.what}</Text>
              <Text style={{ color: s.arrow === '=' ? C.muted : C.text, fontSize: 13, fontWeight: '800', fontVariant: ['tabular-nums'] }}>
                {levelText(s.from)} {s.arrow} {levelText(s.to)}
              </Text>
            </View>
          ))}
        </View>
      ) : <Text style={{ color: C.muted, fontSize: 12.5 }}>Duvar kayması ölçülemedi ({NA})</Text>}
      <View style={{ backgroundColor: C.card2, borderRadius: 10, borderWidth: 1, borderColor: C.border, padding: 10, gap: 4 }}>
        <SectionTitle>Yarın planı</SectionTitle>
        <Text style={{ color: C.text, fontSize: 13.5, lineHeight: 19 }}>{eod.plan}</Text>
      </View>
    </View>
  );
}

/** Veri sorunları (kısa liste) */
export function Failures({ items }: { items: string[] }) {
  if (!items.length) return null;
  return (
    <View style={{ gap: 3 }}>
      <SectionTitle>Veri sorunları</SectionTitle>
      {items.map((f, i) => <Text key={i} style={{ color: C.warn, fontSize: 12 }}>• {f}</Text>)}
    </View>
  );
}
