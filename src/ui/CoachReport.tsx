/* Koç işlem raporu kartı: Başlık · Ne oldu · Çıkış · Giriş · Strike · Kaçan fırsat · Bir dahakine · Karne.
 * Sayılar sunucuda hesaplanır (brüt/net P/L komisyon dâhil, $1,50/kontrat/yön); bu bileşen yalnız gösterir. */
import { Text } from 'react-native';
import { Card } from '@/ui/controls';
import { C } from '@/ui/theme';
import type { TradeReport } from '@/lib/coach/types';

const money = (x: number | null) => (x == null ? '—' : `${x >= 0 ? '+' : '−'}$${Math.abs(x).toFixed(2)}`);
const pctS = (x: number | null | undefined) => (x == null ? '—' : `${x >= 0 ? '+' : ''}${x.toFixed(2)}%`);
const num = (x: number | null | undefined, d = 2) => (x == null ? '—' : x.toFixed(d));
const tone = (x: number | null) => (x == null ? C.muted : x >= 0 ? C.pos : C.neg);
const CIKIS_TR: Record<string, string> = { dogru: 'Doğru', erken: 'Erken', yanlis: 'Yanlış', belirsiz: 'Belirsiz' };
const GIRIS_TR: Record<string, string> = { iyi: 'İyi', kovalama: 'Kovalama', riskli: 'Riskli', belirsiz: 'Belirsiz' };
const STRIKE_TR: Record<string, string> = { uygun: 'Uygun', yakin: 'Fazla yakın (ATM)', uzak: 'Fazla uzak (OTM)', belirsiz: 'Belirsiz' };
const PENCERE_TR: Record<string, string> = { icinde: 'pencere içinde', disinda: 'pencere DIŞINDA', bilinmiyor: 'pencere bilinmiyor' };

function Row({ k, v, color }: { k: string; v: string; color?: string }) {
  return (
    <Text style={{ fontSize: 13, color: C.text, marginBottom: 2 }}>
      <Text style={{ fontWeight: '700' }}>{k}: </Text><Text style={{ color: color ?? C.text }}>{v}</Text>
    </Text>
  );
}
function Head({ t }: { t: string }) {
  return <Text style={{ color: C.blue, fontWeight: '800', fontSize: 13, marginTop: 10, marginBottom: 3 }}>{t}</Text>;
}

export default function CoachReport({ r, index, ts }: { r: TradeReport; index: number; ts: number }) {
  const h = r.header;
  const side = h.side === 'C' ? 'CALL' : 'PUT';
  const title = `${index}. ${h.ticker} ${h.strike}${h.side} · ${h.expiry.slice(5)}${h.dte != null ? ` · ${h.dte} DTE` : ''}`;
  const sn = r.neOldu.sayilar;
  return (
    <Card title={title}>
      <Head t="Başlık" />
      <Row k="Yön" v={side} />
      <Row k="Giriş" v={`${h.entryIst ? h.entryIst.slice(11) : '—'} İst · ${num(h.entryPrice)}`} />
      <Row k="Çıkış" v={h.status === 'acik' ? 'açık pozisyon' : `${h.exitIst ? h.exitIst.slice(11) : '—'} İst · ${num(h.exitPrice)}`} />
      <Row k="Adet" v={h.qty != null ? String(h.qty) : '—'} />
      <Row k="Brüt P/L" v={money(h.grossPnl)} color={tone(h.grossPnl)} />
      <Row k="Net P/L (komisyon $1,50/kontrat/yön)" v={`${money(h.netPnl)}${h.fees != null ? ` (komisyon −$${h.fees.toFixed(2)})` : ''}`} color={tone(h.netPnl)} />

      <Head t="Ne oldu" />
      <Row k="Öncesi" v={r.neOldu.oncesi} />
      <Row k="Sırasında" v={`${r.neOldu.sirasinda} (en yüksek ${num(sn.holdHigh)} / en düşük ${num(sn.holdLow)})`} />
      <Row k="Sonrası" v={`${r.neOldu.sonrasi} (15/30/60 dk: ${pctS(sn.afterAt15Pct)} / ${pctS(sn.afterAt30Pct)} / ${pctS(sn.afterAt60Pct)})`} />

      <Head t={`Çıkış: ${r.cikis.emoji} ${CIKIS_TR[r.cikis.karar]}`} />
      <Text style={{ color: C.text, fontSize: 13 }}>{r.cikis.neden}</Text>

      <Head t={`Giriş: ${r.giris.emoji} ${GIRIS_TR[r.giris.karar]}`} />
      <Text style={{ color: C.text, fontSize: 13 }}>{r.giris.neden}</Text>
      <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>VWAP uzaklığı {pctS(r.giris.vwapUzaklikPct)} · {PENCERE_TR[r.giris.pencere]}</Text>

      <Head t={`Strike: ${r.strike.emoji} ${STRIKE_TR[r.strike.karar]}`} />
      <Text style={{ color: C.text, fontSize: 13 }}>{r.strike.neden}</Text>
      <Text style={{ color: C.muted, fontSize: 12, marginTop: 2 }}>OTM {num(r.strike.otmPct)}% · beklenen harekete oranı {num(r.strike.otmPerEm)} (kural ≈ 0,5)</Text>

      <Head t="Kaçan fırsat" />
      <Row k="Tutarken lehe hareket (dayanak)" v={pctS(r.kacanFirsat.lehePctTutarken)} />
      <Row k="Çıkıştan sonra lehe hareket (60 dk)" v={pctS(r.kacanFirsat.lehePctSonra)} />
      <Row k="Opsiyon, tutarken (tahmini)" v={money(r.kacanFirsat.optTutarkenTahmini)} color={tone(r.kacanFirsat.optTutarkenTahmini)} />
      <Row k="Opsiyon, çıkıştan sonra (tahmini)" v={money(r.kacanFirsat.optSonraTahmini)} color={tone(r.kacanFirsat.optSonraTahmini)} />
      <Text style={{ color: C.text, fontSize: 13, marginTop: 2 }}>{r.kacanFirsat.yorum}</Text>
      <Text style={{ color: C.muted, fontSize: 11, marginTop: 2 }}>Opsiyon değerleri tahmindir: Black-Scholes, IV %45 varsayımı; gerçek prim değildir.</Text>

      <Head t="Bir dahakine" />
      {r.birDahakine.map((x, i) => <Text key={i} style={{ color: C.text, fontSize: 13, marginBottom: 2 }}>{i + 1}. {x}</Text>)}

      <Head t="Karne (/10)" />
      <Row k="Disiplin / çıkış" v={`${r.karne.disiplinCikis}/10`} />
      <Row k="Giriş zamanlaması" v={`${r.karne.girisZamanlamasi}/10`} />
      <Row k="Strike seçimi" v={`${r.karne.strikeSecimi}/10`} />
      <Text style={{ color: C.text, fontSize: 13, marginTop: 2 }}>{r.karne.aciklama}</Text>

      {r.noData.length ? <Text style={{ color: C.muted, fontSize: 11, marginTop: 8 }}>Veri eksik: {r.noData.join('; ')}</Text> : null}
      <Text style={{ color: C.muted, fontSize: 11, marginTop: 6 }}>Eğitim amaçlı; tavsiye değildir · kayıt {new Date(ts).toISOString().slice(11, 16)} UTC · {r.model}</Text>
    </Card>
  );
}
