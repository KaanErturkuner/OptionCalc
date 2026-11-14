/*
 * Akış "AI yorum" (Haiku): sunucu tarafında kullanılan saf yardımcılar. Ağ ve anahtar YOK (anahtar server/app).
 * Uygulama hiçbir zaman Anthropic'i çağırmaz; yalnız sunucunun POST /flow/yorum uç noktasını çağırır.
 * Payload sunucuda akış deposundan kurulur; istemciden gövde gönderilmez.
 */
import { aggregateByStrike, distSummary, spotOf, type DistRow } from './distribution.ts';
import { fmtUsdShort, type FlowEvent } from './model.ts';

export interface YorumWalls { spot: number; callWall: number | null; putWall: number | null; flip: number | null; maxPain: number | null; expiry: string }

export interface FlowYorumPayload {
  ticker: string;
  day: string;
  eventCount: number;
  reconstructedCount: number;      // sonradan kurulmuş olay sayısı (0 = hepsi canlı)
  zeroDteSharePct: number | null;  // primin % kaçı 0DTE (vade = olay günü)
  spot: number | null;
  callPrem: number; putPrem: number;
  callDv: number; putDv: number;
  strikes: DistRow[];              // toplam prime göre en çok 25 strike (yüksek→düşük strike sırası)
  walls: YorumWalls | null;        // sunucuda kayıtlı duvar anlık görüntüsü; yoksa null
}

export const FLOW_YORUM_MAX_STRIKES = 25;

/** Bir ticker ve günün olaylarından Haiku payload'u. Olay yoksa null. */
export function buildFlowYorumPayload(ticker: string, day: string, events: FlowEvent[], walls: YorumWalls | null): FlowYorumPayload | null {
  const evs = events.filter(e => e.ticker === ticker && e.day === day);
  if (!evs.length) return null;
  const sum = distSummary(evs);
  const rows = aggregateByStrike(evs);
  const top = [...rows].sort((a, b) => b.total - a.total).slice(0, FLOW_YORUM_MAX_STRIKES).sort((a, b) => b.strike - a.strike);
  const spot = spotOf(evs) ?? (walls && walls.spot > 0 ? walls.spot : null);
  return {
    ticker, day,
    eventCount: sum.eventCount,
    reconstructedCount: sum.reconstructedCount,
    zeroDteSharePct: sum.totalPrem > 0 ? Math.round((sum.zeroDtePrem / sum.totalPrem) * 100) : null,
    spot,
    callPrem: Math.round(sum.callPrem), putPrem: Math.round(sum.putPrem),
    callDv: evs.filter(e => e.side === 'call').reduce((a, e) => a + e.dv, 0),
    putDv: evs.filter(e => e.side === 'put').reduce((a, e) => a + e.dv, 0),
    strikes: top,
    walls,
  };
}

export const FLOW_YORUM_SYSTEM = [
  'Sen bir opsiyon akışı (unusual options flow) analistisin. Sana verilen tabloyu Türkçe, kısa ve somut yorumla.',
  'Kurallar:',
  '- 4 ila 6 kısa cümle. Madde işareti, başlık ya da markdown kullanma; düz metin yaz.',
  '- Sırasıyla: yön (yukarı / aşağı / kararsız) ve gerekçe, önemli seviyeler (strike ve duvarlar), senaryo (fiyat ağır strike’lara giderse ne olabilir), güven düzeyi, sınırlar.',
  '- YALNIZ verilen sayıları kullan. Verilmeyen hiçbir rakamı, seviyeyi ya da tarihi uydurma.',
  '- Yatırım tavsiyesi verme: “al”, “sat”, “giriş”, “hedef fiyat” gibi eylem önerisi yazma.',
  '- Veri sonradan kurulmuşsa (kapanış verisi, gün içi an yok) bunu açıkça belirt.',
  '- Duvar verisi “yok” ise bunu söyle ve duvar hakkında yorum yapma.',
  '- Son cümle tam olarak şu olsun: Yatırım tavsiyesi değildir.',
].join('\n');

const usd = fmtUsdShort;
const n0 = (x: number) => String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Haiku kullanıcı metni: düz, kısa tablo. */
export function flowYorumUserText(p: FlowYorumPayload): string {
  const lines: string[] = [];
  lines.push(`Hisse: ${p.ticker}`);
  lines.push(`Gün (ET): ${p.day}`);
  lines.push(`Spot: ${p.spot != null ? p.spot.toFixed(2).replace('.', ',') + ' $' : 'bilinmiyor'}`);
  lines.push(`Olay sayısı: ${p.eventCount}`);
  lines.push(p.reconstructedCount === 0
    ? 'Veri: canlı tarama (zaman damgaları gerçek).'
    : p.reconstructedCount === p.eventCount
      ? 'Veri: tümü sonradan kuruldu (kapanış verisi; gün içi an yok).'
      : `Veri: ${p.reconstructedCount} olay sonradan kuruldu (kapanış verisi; gün içi an yok).`);
  lines.push(`Toplam call prim: ${usd(p.callPrem)} (${n0(p.callDv)} kontrat)`);
  lines.push(`Toplam put prim: ${usd(p.putPrem)} (${n0(p.putDv)} kontrat)`);
  lines.push(`0DTE payı: ${p.zeroDteSharePct != null ? `%${p.zeroDteSharePct}` : 'bilinmiyor'}`);
  lines.push('');
  lines.push('Strike tablosu (toplam prime göre en çok ' + p.strikes.length + ', yüksekten düşüğe): strike | call prim | put prim | call kontrat | put kontrat');
  for (const r of p.strikes) {
    lines.push(`${r.strike} | ${usd(r.callPrem)} | ${usd(r.putPrem)} | ${n0(r.callDv)} | ${n0(r.putDv)}`);
  }
  lines.push('');
  if (p.walls) {
    const w = p.walls;
    lines.push(`OI duvarları (vade ${w.expiry}, anlık görüntü): call duvarı ${w.callWall ?? 'yok'}, put duvarı ${w.putWall ?? 'yok'}, max pain ${w.maxPain ?? 'yok'}, gamma flip ${w.flip ?? 'yok'} (yaklaşık).`);
  } else {
    lines.push('OI duvarları: yok (bu gün için anlık görüntü kaydı bulunmuyor). Duvar hakkında yorum yapma.');
  }
  return lines.join('\n');
}
