/* Kural tabanlı yorum kutusu (ücretsiz): kalın özet + kısa maddeler. Akış Dağılım ve Radar detayında ortak. */
import { Text, View } from 'react-native';
import { C } from '@/ui/theme';

export interface YorumView { summary: string; bullets: string[]; bias: 'yukarı' | 'aşağı' | 'kararsız'; confidence: 'düşük' | 'orta' | 'yüksek' }

const BIAS_COLOR = { 'yukarı': C.pos, 'aşağı': C.neg, 'kararsız': C.warn } as const;

export function YorumBox({ y }: { y: YorumView }) {
  const last = y.bullets.length - 1;
  return (
    <View style={{ gap: 6 }}>
      <Text style={{ color: BIAS_COLOR[y.bias], fontSize: 14, fontWeight: '800', lineHeight: 20 }}>{y.summary}</Text>
      {y.bullets.map((b, i) => (
        <Text key={i} style={{ color: i === last ? C.muted : C.text, fontSize: i === last ? 11 : 13, lineHeight: 18, marginTop: i === last ? 4 : 0 }}>
          {i === last ? b : `• ${b}`}
        </Text>
      ))}
    </View>
  );
}
