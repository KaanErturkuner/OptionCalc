/* Akış Dağılım: seçili hissenin strike bazlı call/put primi, ayrıştırıcı (diverging) çubuklar, kural yorumu ve AI yorum alanı. */
import { ScrollView, Text, View } from 'react-native';
import { Card, Chip } from '@/ui/controls';
import { C, mono } from '@/ui/theme';
import { YorumBox } from '@/ui/YorumBox';
import { AkisYorum } from '@/ui/AkisYorum';
import { fmt } from '@/lib/format';
import { fmtUsdShort } from '@/lib/flow/model';
import { atmStrike, type DistRow } from '@/lib/flow/distribution';
import type { Interpretation } from '@/lib/flow/yorum';
import { RECONSTRUCTED_LABEL } from '@/lib/flow/reconstruct';

const COLS = [58, 78, 78, 80, 80, 84];           // Strike | Call prim | Put prim | Call kontrat | Put kontrat | Net
const TW = COLS.reduce((a, b) => a + b, 0);
const HEAD = ['Strike', 'Call prim', 'Put prim', 'Call kontrat', 'Put kontrat', 'Net'];

export interface DagilimProps {
  ticker: string;
  rows: DistRow[];
  spot: number | null;
  interp: Interpretation;
  reconstructed: boolean;
  /** Hisse seçici (filtrede hisse yoksa); null → seçici gösterilmez */
  tickerChoices: string[] | null;
  activeTicker: string;
  onPickTicker: (t: string) => void;
  flowKey: string;
  /** AI yorum günü (Bugün/Dün/son gün); null → AI alanı gösterilmez */
  aiDay: string | null;
}

export function AkisDagilim(p: DagilimProps) {
  const { ticker, rows, spot, interp, reconstructed } = p;
  const callP = rows.reduce((a, r) => a + r.callPrem, 0), putP = rows.reduce((a, r) => a + r.putPrem, 0);
  const net = callP - putP;
  const maxSide = rows.reduce((a, r) => Math.max(a, r.callPrem, r.putPrem), 0);
  const atm = atmStrike(rows, spot);

  return (
    <View style={{ gap: 10 }}>
      {p.tickerChoices && p.tickerChoices.length > 0 ? (
        <Card title="Hisse">
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {p.tickerChoices.map(t => (
              <Chip key={t} label={t} active={t === p.activeTicker} onPress={() => p.onPickTicker(t)} />
            ))}
          </View>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><Text style={{ color: C.muted, fontSize: 13 }}>Bu filtrelere uyan olay yok.</Text></Card>
      ) : (
        <>
          <Card title="Yorum">
            <YorumBox y={interp} />
            <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
              Kural tabanlı; ücretsiz, LLM yok. Eşikler kabadır; yalnız akış verisine dayanır.
            </Text>
          </Card>

          {p.aiDay ? <AkisYorum key={`${ticker}|${p.aiDay}`} flowKey={p.flowKey} ticker={ticker} day={p.aiDay} /> : null}

          <Card title="Strike dağılımı">
            <Text style={{ color: C.text, fontSize: 13, fontWeight: '700' }}>
              {ticker}{spot != null ? ` · spot ${fmt(spot, 2)} $` : ' · spot bilinmiyor'}
            </Text>
            <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>
              Call {fmtUsdShort(callP)} · Put {fmtUsdShort(putP)} · Net{' '}
              <Text style={{ color: net > 0 ? C.pos : net < 0 ? C.neg : C.text, fontWeight: '700' }}>{net > 0 ? '+' : ''}{fmtUsdShort(net)}</Text>
              {' '}· {rows.length} strike
            </Text>
            {reconstructed ? (
              <Text style={{ color: C.warn, fontSize: 11, lineHeight: 16, marginTop: 6 }}>
                {RECONSTRUCTED_LABEL}: bu dağılımda gün içi an yok (kapanış verisi).
              </Text>
            ) : null}

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }}>
              <View style={{ width: TW }}>
                <View style={{ flexDirection: 'row', paddingBottom: 4, borderBottomWidth: 1, borderColor: C.border }}>
                  {HEAD.map((h, i) => (
                    <Text key={h} style={{ width: COLS[i], color: C.muted, fontSize: 10, fontWeight: '700', textAlign: i === 0 ? 'left' : 'right' }}>{h}</Text>
                  ))}
                </View>
                {rows.map(r => {
                  const isAtm = r.strike === atm;
                  const netC = r.net > 0 ? C.pos : r.net < 0 ? C.neg : C.text;
                  return (
                    <View key={r.strike} style={{ backgroundColor: isAtm ? C.accentSoft : 'transparent', paddingVertical: 4, borderBottomWidth: 0.5, borderColor: C.border }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <View style={{ width: COLS[0] }}>
                          <Text style={[mono, { color: C.text, fontSize: 12, fontWeight: '800' }]}>{fmt(r.strike, Number.isInteger(r.strike) ? 0 : 2)}</Text>
                          {isAtm ? <Text style={{ color: C.blue, fontSize: 9, fontWeight: '800' }}>SPOT {fmt(spot ?? 0, 2)}</Text> : null}
                        </View>
                        <Num w={COLS[1]} v={fmtUsdShort(r.callPrem)} color={r.callPrem > 0 ? C.pos : C.muted} />
                        <Num w={COLS[2]} v={fmtUsdShort(r.putPrem)} color={r.putPrem > 0 ? C.neg : C.muted} />
                        <Num w={COLS[3]} v={fmt(r.callDv, 0)} />
                        <Num w={COLS[4]} v={fmt(r.putDv, 0)} />
                        <Num w={COLS[5]} v={`${r.net > 0 ? '+' : ''}${fmtUsdShort(r.net)}`} color={netC} />
                      </View>
                      <DivBar put={r.putPrem} call={r.callPrem} max={maxSide} />
                    </View>
                  );
                })}
              </View>
            </ScrollView>
            <Text style={{ color: C.muted, fontSize: 11, lineHeight: 16, marginTop: 8 }}>
              Çubuklar: sola put primi (kırmızı), sağa call primi (yeşil); ölçek tüm satırlarda ortak. Spot satırı vurgulu.
            </Text>
          </Card>
        </>
      )}
    </View>
  );
}

function Num({ w, v, color }: { w: number; v: string; color?: string }) {
  return <Text style={[mono, { width: w, textAlign: 'right', color: color ?? C.text, fontSize: 11 }]}>{v}</Text>;
}

/** Ayrıştırıcı çubuk: orta çizgi 0; put sola, call sağa. Ölçek: tüm satırların en büyük tarafı. */
function DivBar({ put, call, max }: { put: number; call: number; max: number }) {
  const mid = 2, half = (TW - mid) / 2;
  const pw = max > 0 ? (put / max) * half : 0, cw = max > 0 ? (call / max) * half : 0;
  return (
    <View style={{ flexDirection: 'row', height: 7, marginTop: 4, width: TW }}>
      <View style={{ width: half, flexDirection: 'row', justifyContent: 'flex-end' }}>
        {pw > 0 ? <View style={{ width: pw, height: 7, backgroundColor: C.neg, borderRadius: 2 }} /> : null}
      </View>
      <View style={{ width: mid, backgroundColor: C.muted }} />
      <View style={{ width: half, flexDirection: 'row' }}>
        {cw > 0 ? <View style={{ width: cw, height: 7, backgroundColor: C.pos, borderRadius: 2 }} /> : null}
      </View>
    </View>
  );
}
