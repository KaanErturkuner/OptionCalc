/* Türkçe uyarı metni: "Başkan," ile başlar; ne oldu (sayılarla) → neden önemli → senaryo → dikkat; veri yaşı; kaynak. */
import { fmt } from '../format.ts';
import type { Direction, Signal, SignalKind } from './types.ts';

const AY = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara'];
export const trDay = (expiry: string) => { const [, m, d] = expiry.split('-'); return `${+d} ${AY[+m - 1]}`; };
/** "13 Kas 857,5C" */
export const kontratEtiket = (strike: number, type: string, expiry: string) => `${trDay(expiry)} ${fmt(strike, strike % 1 ? 1 : 0)}${type}`;
const ist = (ms: number) => { const d = new Date(ms + 3 * 3600000); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
/** Kaan'ın giriş penceresi: İstanbul 16:30–20:00 */
export function inEntryWindowIst(now: number): boolean {
  const d = new Date(now + 3 * 3600000), m = d.getUTCHours() * 60 + d.getUTCMinutes();
  return m >= 16 * 60 + 30 && m < 20 * 60;
}
export const DIR_LABEL: Record<Direction, string> = { bull: 'yükseliş', bear: 'düşüş', neutral: 'bilgi', vol: 'oynaklık' };
const f = (x: unknown, d = 2) => typeof x === 'number' ? fmt(x, d) : String(x);

interface Parts { ne: string; neden: string; senaryo: string; dikkat: string }
/** Her dedektör türü için şablon. facts dedektörlerden gelir. */
const T: Record<SignalKind, (s: Signal) => Parts> = {
  pcSurge: s => s.direction === 'bear'
    ? { ne: `put/call hacmi ${f(s.facts.pc)} (20 gün ort. ${f(s.facts.tabanPc)}), toplam hacim normalin ${f(s.facts.hacimOran)} katı`, neden: 'put yığılması koruma talebi ya da düşüşe oynama anlamına gelebilir', senaryo: 'destek kırılırsa aşağı yönlü hareket hızlanabilir', dikkat: 'call tarafında olma' }
    : { ne: `put/call hacmi ${f(s.facts.pc)} (20 gün ort. ${f(s.facts.tabanPc)}), çağrı yığılması`, neden: 'call yoğunluğu yükselişe oynama ya da kısa pozisyon kapatma olabilir', senaryo: 'direnç kırılırsa yukarı hareket hızlanabilir', dikkat: 'put tarafında olma' },
  unusual: s => ({
    ne: `${s.facts.kontrat} (${s.facts.vade}) kontratında ${f(s.facts.hacim, 0)} işlem, OI ${f(s.facts.oi, 0)}, hacim/OI ${f(s.facts.hacimOi, 1)}${s.facts.agresif === 'evet' ? '; alımlar ask tarafında (agresif)' : ''}`,
    neden: `${s.facts.otm === 'evet' ? 'OTM, ' : ''}${s.facts.dte}DTE kontrat; sıra dışı akış bilgi sızıntısı ya da yakın haber beklentisi olabilir`,
    senaryo: 'hacim sürerse yön teyidi aranır', dikkat: 'spread ve likiditeye bak' }),
  oiBuild: s => ({ ne: `${s.facts.kontrat} OI ${f(s.facts.onceki, 0)} → ${f(s.facts.oi, 0)} (+%${f(s.facts.artisPct, 0)})`,
    neden: 'yeni pozisyon birikimi; kurumsal ya da korunma amaçlı olabilir', senaryo: 'bu strike seviye olarak izlenir', dikkat: 'OI verisi ertesi sabah netleşir' }),
  ivJump: s => s.facts.not
    ? { ne: `ATM IV seans başına göre %${f(s.facts.degisimPct, 1)} düştü (${f(s.facts.ivPct, 1)}%)`, neden: 'bilanço sonrası IV çöküşü beklenen bir durum', senaryo: 'bilgi amaçlı', dikkat: 'opsiyonlar ucuzladı' }
    : { ne: `ATM IV seans başına göre %${f(s.facts.degisimPct, 1)} sıçradı (${f(s.facts.ivPct, 1)}%)`, neden: 'piyasa bir olay fiyatlıyor olabilir', senaryo: 'büyük hareket beklentisi artıyor', dikkat: 'opsiyon pahalandı; alım maliyeti yüksek' },
  skew: s => ({ ne: `25Δ risk reversal ${f(s.facts.rr25)} puan (taban ${f(s.facts.tabanRr25)}, z=${f(s.facts.z)})`,
    neden: 'put koruması pahalanıyor; düşüşe karşı talep var', senaryo: 'destek kırılırsa sert düşüş riski', dikkat: 'put tarafı pahalı' }),
  complacency: s => ({ ne: `IV rank ${f(s.facts.ivRank, 0)}, P/C taban×${f(s.facts.pcOran)}, realize oynaklık IV'nin üstünde`,
    neden: 'rehavet var: koruma ucuz', senaryo: 'böyle dönemlerde ani düşüşler sert olur', dikkat: 'koruma ucuz' }),
  panic: s => ({ ne: `IV rank ${f(s.facts.ivRank, 0)}, P/C taban×${f(s.facts.pcOran)}`, neden: 'korku zirvesi; aşırı koruma talebi', senaryo: 'dönüş fırsatı olabilir, düşüş de sürebilir', dikkat: 'teyit bekle' }),
  pin: s => ({ ne: `fiyat ${s.facts.seviyeAd} (${f(s.facts.seviye)}) seviyesine ${f(s.facts.uzaklik)} $ uzaklıkta (beklenen hareket ${f(s.facts.beklenenHareket)} $)`,
    neden: 'pin riski: gamma yoğun seviyeye çekim', senaryo: 'kapanışa doğru seviyede sıkışma', dikkat: 'son saatte kısa gamma riski' }),
  gamma: s => ({ ne: `fiyat gamma flip (${f(s.facts.flip)}) altında`, neden: 'dealer gamma negatif; hareketler büyüyebilir', senaryo: 'oynaklık artabilir', dikkat: 'stop disiplinini sıkı tut' }),
  sector: s => ({ ne: `hisse %${f(s.facts.hisseDegisimPct)}, ${s.facts.sektor} %${f(s.facts.sektorDegisimPct)}, ters yönde (fark ${f(s.facts.fark)} puan, beklenen ${f(s.facts.beklenenPct)})`,
    neden: 'hisseye özgü haber ya da akış olabilir', senaryo: 'sektör yönü dönerse ayrışma kapanabilir', dikkat: 'haber kontrolü yap' }),
  earnings: s => ({ ne: `bilanço ${s.facts.gunSonra} gün sonra; zımni hareket ±%${f(s.facts.zimniPct, 1)}, son 8 bilanço ort. ±%${f(s.facts.histPct, 1)}`,
    neden: `opsiyonlar ${s.facts.durum} fiyatlıyor`, senaryo: 'bilanço öncesi IV genelde artar, sonrası çöker', dikkat: 'bilanço günü yüksek risk' }),
  trend: s => {
    const yon = String(s.facts.yon), type = String(s.facts.kontrat).slice(-1);
    return { ne: `1 dk açılış aralığı kırılımı ${yon}; VWAP ${yon === 'yukarı' ? 'üstünde' : 'altında'}, EMA9 ${yon === 'yukarı' ? '>' : '<'} EMA21`,
      neden: 'fiyat, hacim ve momentum aynı yönde', senaryo: `trend teyit ederse: ${kontratEtiket(Number(s.facts.strike), type, String(s.facts.vade))} (${f(s.facts.katsayi, 2)}× beklenen hareket kuralı)`,
      dikkat: 'sinyal teyit edilmezse geç; kâğıt üstünde izle' };
  },
};

export interface TextInput {
  ticker: string; direction: Direction; score: number; signals: Signal[];
  news?: { title: string; url: string; source: string; publishedAt: number } | null;
  noNews: boolean; dataAgeSec: number; source: string; delayedMin: number;
  probUp: number | null; now: number; expiry?: string | null; dte?: number | null;
}
/** Uyarı başlığı + gövdesi (Türkçe). Yatırım tavsiyesi değildir notu her zaman eklenir. */
export function renderAlert(t: TextInput): { title: string; body: string } {
  const top = [...t.signals].sort((a, b) => b.severity - a.severity).slice(0, 3);
  const parts = top.map(s => T[s.kind](s));
  const title = `⚡ ${t.ticker} · ${DIR_LABEL[t.direction]} · %${Math.round(t.score * 100)}`;
  const lines: string[] = [];
  lines.push(`Başkan, ${t.ticker}: ${parts.map(p => p.ne).join(' · ')}.`);
  lines.push(`Neden önemli: ${parts[0].neden}.`);
  lines.push(`Olası senaryo: ${parts[0].senaryo}.`);
  lines.push(`Dikkat: ${parts[0].dikkat}.`);
  if (t.news) lines.push(`Haber: ${t.news.title} (${t.news.source}, ${ist(t.news.publishedAt)} İstanbul).`);
  else if (t.noNews && top.some(s => ['unusual', 'ivJump', 'oiBuild'].includes(s.kind))) lines.push('Son 24 saatte haber yok → söylenti ya da bilgi sızıntısı olabilir.');
  if (t.probUp != null) lines.push(`Piyasa zımni olarak %${Math.round(t.probUp * 100)} ihtimalle spot üstünde kapanış fiyatlıyor.`);
  lines.push(`Veri: ${t.source}, ${t.delayedMin > 0 ? `${t.delayedMin} dk gecikmeli` : 'gerçek zamanlıya yakın'}, ${t.dataAgeSec} sn önce.`);
  if (!inEntryWindowIst(t.now)) lines.push('Giriş penceresi dışında: yarın için not.');
  lines.push('Yatırım tavsiyesi değildir; kâğıt üstünde doğrula.');
  return { title, body: lines.join('\n') };
}
