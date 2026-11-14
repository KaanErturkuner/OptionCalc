/* Fırsat ekranı işlem kartı ve BEKLE kartı. Sonuç kartıyla aynı koyu stil. Kağıt üstü; tavsiye değildir. Hesap ve türetim: src/lib/signals/trade.ts. */
import { Text, View } from 'react-native';
import { C } from '@/ui/theme';
import { fmt } from '@/lib/format';
import type { TradeCard as T, WaitCard as W } from '@/lib/signals/trade';

const usd = (x: number, d = 0) => `${fmt(Math.abs(x), d)} $`;
const signedUsd = (x: number) => `${x >= 0 ? '+' : '−'}${usd(x)}`;
const px = (x: number) => fmt(x, x % 1 ? 2 : 0);

export function TradeCardView({ c }: { c: T }) {
  const col = c.dir === 'call' ? C.pos : C.neg;
  const s = c.sizing;
  return (
    <View style={{ borderRadius: 16, borderWidth: 1.5, borderColor: col, backgroundColor: 'rgba(255,255,255,.03)', padding: 14, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View>
          <Text style={{ color: C.text, fontSize: 24, fontWeight: '900' }}>{c.ticker}</Text>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>{c.expiryLabel}</Text>
        </View>
        <View style={{ backgroundColor: col, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 }}>
          <Text style={{ color: '#06100a', fontSize: 18, fontWeight: '900' }}>{c.typeLabel}</Text>
        </View>
      </View>

      <Text style={{ color: C.text, fontSize: 15, fontWeight: '800' }}>
        {`Strike ${px(c.strike)} ${c.typeLabel === 'CALL' ? 'C' : 'P'} · spot ${px(c.spot)} · ${px(c.otm)} $ OTM`}
      </Text>

      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Big k="Giriş (orta)" v={fmt(c.entry, 2)} />
        <Big k={`Stop (−%${c.stopPct})`} v={fmt(c.stop, 2)} c={C.neg} />
        <Big k="Hedef 1:5" v={fmt(c.t5, 2)} c={C.pos} />
      </View>
      <Text style={{ color: C.muted, fontSize: 12 }}>{`Yedek hedef 1:4: ${fmt(c.t4, 2)} · kontrat başına risk ${usd(c.riskPerContract * 100)}`}</Text>

      {s ? (
        <View style={{ borderRadius: 10, backgroundColor: C.input, padding: 10, gap: 4 }}>
          {s.contracts > 0 ? (
            <>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '900' }}>{`${s.contracts} kontrat`}</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>{`Sermaye ${usd(s.capital)} · %${s.tierPct} kademe · maliyet ${usd(s.premiumCost, 2)} + açılış ${usd(s.openComm, 2)}`}</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>{`Komisyon gidiş-dönüş ${usd(s.rtComm, 2)} (${fmt(s.commission, 2)} $ × ${s.contracts} × 2)`}</Text>
              <Text style={{ color: C.text, fontSize: 12 }}>{`Stopta ≈ ${signedUsd(s.stopNet)} · 1:5 hedefte ≈ ${signedUsd(s.targetNet)} · 1:4'te ≈ ${signedUsd(s.targetNet4)}`}</Text>
            </>
          ) : (
            <Text style={{ color: C.warn, fontSize: 13, fontWeight: '700' }}>{`Sermaye yetmiyor: 1 kontrat ≈ ${usd(s.minCost, 2)} (kademe ${s.tierPct}%)`}</Text>
          )}
        </View>
      ) : (
        <Text style={{ color: C.muted, fontSize: 12 }}>Hesap yok; adet hesaplanmadı.</Text>
      )}

      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        {[1, 2, 3, 4, 5].map(i => (
          <View key={i} style={{ width: 22, height: 8, borderRadius: 4, backgroundColor: i <= c.strength ? col : C.input }} />
        ))}
        <Text style={{ color: C.text, fontSize: 13, fontWeight: '800', marginLeft: 4 }}>{`${c.strength}/5 · ${c.strengthText}`}</Text>
      </View>

      <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{c.rationale}</Text>

      <Text style={{ color: c.overnight.carry ? C.blue : C.warn, fontSize: 13, fontWeight: '800' }}>
        {`${c.overnight.label}`}
        <Text style={{ color: C.muted, fontSize: 12, fontWeight: '500' }}>{` · ${c.overnight.sub}`}</Text>
      </Text>
      {c.warnings.map(w => (
        <Text key={w} style={{ color: C.warn, fontSize: 12, fontWeight: '700' }}>{w}</Text>
      ))}
    </View>
  );
}

export function WaitCardView({ w }: { w: W }) {
  return (
    <View style={{ borderRadius: 16, borderWidth: 1.5, borderColor: C.border, backgroundColor: 'rgba(255,255,255,.03)', padding: 14, gap: 8 }}>
      <Text style={{ color: C.muted, fontSize: 30, fontWeight: '900' }}>BEKLE</Text>
      <Text style={{ color: C.text, fontSize: 14, lineHeight: 20 }}>{w.reason}</Text>
      {w.lines.length ? (
        <View style={{ gap: 4, marginTop: 4 }}>
          <Text style={{ color: C.muted, fontSize: 12, fontWeight: '700' }}>Girdi için tetikleyici</Text>
          {w.lines.map(l => (
            <Text key={l.ticker + l.text} style={{ color: C.text, fontSize: 13 }}>{l.text}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function Big({ k, v, c }: { k: string; v: string; c?: string }) {
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: C.muted, fontSize: 11, fontWeight: '600' }}>{k}</Text>
      <Text style={{ color: c ?? C.text, fontSize: 22, fontWeight: '900' }}>{v}</Text>
    </View>
  );
}
