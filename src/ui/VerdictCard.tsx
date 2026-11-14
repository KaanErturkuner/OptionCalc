/* "Sonuç" kartı: yön, güç (0–5), vade/strike, prim, stop/hedef (1:5, yedek 1:4), kademe ve kriter dökümü. Kağıt üstü; tavsiye değildir. */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { C } from '@/ui/theme';
import { fmt } from '@/lib/format';
import { CARD_NOTE } from '@/lib/signals/verdict';
import { normalizeVerdict } from '@/lib/signals/trade';
import { cardCalendarLines } from '@/lib/calendar/releases';

const DIR_LABEL = { call: 'CALL al', put: 'PUT al', bekle: 'Bekle' } as const;

/** raw: eski/eksik alanlı kart da gelebilir (AsyncStorage); normalize edilemezse "veri yok" kutusu. */
export default function VerdictBlock({ ticker, v: raw }: { ticker: string; v: unknown }) {
  const [nowMs] = useState(() => Date.now());   // kart açıldığı andaki saat (render saf kalsın)
  const v = normalizeVerdict(raw);
  if (!v) {
    return <Text style={{ color: C.muted, fontSize: 12 }}>{`Sonuç · ${ticker}: veri yok`}</Text>;
  }
  const col = v.dir === 'call' ? C.pos : v.dir === 'put' ? C.neg : C.muted;
  return (
    <View style={{ borderRadius: 14, borderWidth: 1, borderColor: col, backgroundColor: 'rgba(255,255,255,.03)', padding: 10, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Sonuç · {ticker}</Text>
        <Text style={{ color: col, fontSize: 20, fontWeight: '900' }}>{DIR_LABEL[v.dir]}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <View key={i} style={{ width: 22, height: 8, borderRadius: 4, backgroundColor: i <= v.strength ? col : C.input }} />
        ))}
        <Text style={{ color: C.text, fontSize: 12, fontWeight: '700', marginLeft: 4 }}>{v.strength}/5 · {v.strengthText}</Text>
        <Text style={{ color: C.muted, fontSize: 11 }}>(net puan {v.sum > 0 ? '+' : ''}{v.sum})</Text>
      </View>
      {v.strike != null ? (
        <>
          <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
            {`${v.dte === 0 ? '0DTE' : `${v.dte} DTE`} · ${v.expiry?.slice(5).replace('-', '/')} · ${fmt(v.strike, v.strike % 1 ? 1 : 0)}${v.dir === 'put' ? 'P' : 'C'}`}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Kv k="Giriş (orta)" v={fmt(v.entry ?? NaN)} />
            <Kv k="Stop (−%67)" v={fmt(v.stop ?? NaN)} c={C.neg} />
            <Kv k="Hedef 1:5" v={fmt(v.t5 ?? NaN)} c={C.pos} />
            <Kv k="Yedek 1:4" v={fmt(v.t4 ?? NaN)} />
            <Kv k="Kontrat riski" v={`${fmt(v.riskPerContract ?? NaN)} $`} />
          </View>
          <Text style={{ color: C.muted, fontSize: 11 }}>
            {v.contracts != null
              ? `Kademe ${v.tierPct}% · ${v.contracts} kontrat (hesap bütçesi)`
              : 'Kademe: %50 / %40 / %30 (hesap yok; yalnız oran)'}
          </Text>
        </>
      ) : null}
      <Text style={{ color: C.text, fontSize: 13, lineHeight: 18 }}>{v.rationale}</Text>
      {cardCalendarLines(nowMs).map(l => (
        <Text key={l} style={{ color: C.warn, fontSize: 12, fontWeight: '700' }}>{l}</Text>
      ))}
      {v.crits.map(c => (
        <Text key={c.id} style={{ color: c.pts > 0 ? C.pos : c.pts < 0 ? C.neg : C.muted, fontSize: 11.5, lineHeight: 16 }}>
          {c.pts > 0 ? '▲ +1' : c.pts < 0 ? '▼ −1' : '•  0'}  {c.text}
        </Text>
      ))}
      <Text style={{ color: C.muted, fontSize: 10.5, lineHeight: 14 }}>{CARD_NOTE}</Text>
    </View>
  );
}

function Kv({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={{ minWidth: 84 }}>
      <Text style={{ color: C.muted, fontSize: 10.5, fontWeight: '600' }}>{k}</Text>
      <Text style={{ color: c ?? C.text, fontSize: 15, fontWeight: '800' }}>{v}</Text>
    </View>
  );
}
