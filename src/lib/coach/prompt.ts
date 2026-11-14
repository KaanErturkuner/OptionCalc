/*
 * Koç prompt'ları (saf): üç çağrı — (1) görüntüden işlem çıkarma, (2) işlem koçluğu, (3) günlük karne.
 * Çıktı YALNIZ JSON; model metni validate.ts ile doğrulanır. Dil: Türkçe. Eğitim amaçlı; tavsiye değildir.
 */
import { KAAN_RULES_TR } from './context.ts';
import type { ToolDef } from './anthropic.ts';

const BASE = [
  'Sen Türkçe konuşan bir işlem KOÇUSUN (eğitim amaçlı). Yatırım tavsiyesi verme; "al/sat" çağrısı yapma.',
  'Yalnız verilen görüntüde veya JSON bağlamında olan bilgiyi kullan. Okunamayan değer için null yaz, uydurma.',
  'Yanıtın YALNIZ tek bir JSON nesnesi olsun; başka metin, açıklama veya kod çiti ekleme.',
].join('\n');

/** Çıkarma (her ekran görüntüsü için bir çağrı): kısa sistem metni, en küçük şema, max_tokens 400. */
export const EXTRACT_SYSTEM = `${BASE}

GÖREV: Midas ekran görüntüsündeki opsiyon emir/dolum satırlarını çıkar. Her satır bir dolum.
Şema (YALNIZ bu JSON): {"fills":[{"tk":"QQQ","exp":"YYYY-MM-DD","k":600,"cp":"C"|"P","q":2,"side":"buy"|"sell","px":1.85,"t":"YYYY-MM-DDTHH:MM","conf":"yuksek"|"orta"|"dusuk"}],"note":null|"kısa not"}
- side: alış/Açılış = "buy"; satış/Kapanış = "sell".
- px: opsiyon primi (dolar), hisse fiyatı değil. k: strike. q: adet (pozitif tam sayı). cp: C=call, P=put.
- t: Midas'ta gösterilen tarih ve saat ZATEN İSTANBUL YEREL SAATİDİR. Tarih ve saati OLDUĞU GİBİ kopyala; saniyeyi at.
  ASLA saat dilimi çevirme: ET/EDT/EST ekleme, +7 veya +8 saat ekleme/çıkarma YOK. Örnek: "Gerçekleşme tarihi 13 Kasım 2026, 18:05:24" → t "2026-11-13T18:05".
  Bir satırda hem "Gerçekleşme tarihi" hem "Emir tarihi" varsa t için YALNIZ "Gerçekleşme tarihi"ni kullan (dolumun gerçekleştiği an). Yalnız "Emir tarihi" varsa onu kullan.
  Tarih ekranda yoksa işlem günü ipucunu kullan.
- Zorunlu bir alanı okuyamıyorsan o satırı ekleme; note'ta yaz. Satır yoksa fills [] ve note'ta açıkla. En fazla 6 satır.
- Görüntüde hem giriş (alış/Açılış) hem çıkış (satış/Kapanış) satırı olabilir: HEPSİNİ ayrı dolum olarak ekle.
- Sonucu YALNIZ record_fills aracıyla ver; aracın dışında metin yazma.`;

/** Çıkarma için zorunlu araç (tool_use): model şemaya uygun girdi üretir; metin ayrıştırmasına gerek kalmaz. */
export const EXTRACT_TOOL: ToolDef = {
  name: 'record_fills',
  description: 'Midas ekran görüntüsündeki opsiyon dolum satırlarını kaydet. Satır yoksa fills boş dizi, note açıklama. Saatler Midas\'ta İstanbul saatidir: çevirme yapma; "Gerçekleşme tarihi" varsa onu, yoksa "Emir tarihi"ni kullan.',
  input_schema: {
    type: 'object',
    properties: {
      fills: {
        type: 'array', maxItems: 6,
        items: {
          type: 'object',
          properties: {
            tk: { type: 'string', description: 'Sembol, örn. QQQ' },
            exp: { type: 'string', description: 'Vade YYYY-MM-DD' },
            k: { type: 'number', description: 'Strike' },
            cp: { type: 'string', enum: ['C', 'P'] },
            q: { type: 'integer', minimum: 1, description: 'Adet' },
            side: { type: 'string', enum: ['buy', 'sell'] },
            px: { type: 'number', description: 'Opsiyon primi (USD)' },
            t: { type: 'string', description: 'Dolum zamanı, YYYY-MM-DDTHH:MM. Midas\'taki tarih/saat aynen (zaten İstanbul saati; saat dilimi ÇEVİRME, +7/+8 ekleme). Önce "Gerçekleşme tarihi", yoksa "Emir tarihi". Örn. "Gerçekleşme tarihi 13 Kasım 2026, 18:05:24" → 2026-11-13T18:05' },
            conf: { type: 'string', enum: ['yuksek', 'orta', 'dusuk'] },
          },
          required: ['tk', 'exp', 'k', 'cp', 'q', 'side', 'px', 't'],
        },
      },
      note: { type: ['string', 'null'], description: 'Kısa not; okunamayan veya belirsiz bir şey varsa yaz' },
    },
    required: ['fills', 'note'],
  },
};

export function extractUserText(day: string): string {
  return `İşlem günü ipucu (ET): ${day}. Dolumları şemaya göre JSON olarak çıkar. Saatler İstanbul saatidir; çevirme yapma.`;
}

export const COACH_SYSTEM = `${BASE}

GÖREV: Her işlem için Kaan'a dürüst Türkçe koçluk raporu yaz. SAYI ÜRETME: tüm fiyat, yüzde ve P/L değerleri
"facts" içindedir (sayilar, mumlar5dk, optHoldFav/optAfterFav = BS tahmini). Yorumlarında yalnız bu sayılara atıf yap.
Kaan'ın kuralları:
${KAAN_RULES_TR}

Bölümlerin anlamı (karar alanları SABİT değerlerden biri olmalı):
- neOldu: oncesi (giriş öncesi 15 dk: sayilar.sBefore15dk → sayilar.sEntry), sirasinda (tutma: holdHigh / holdLow), sonrasi (çıkış sonrası: afterFavPct, afterAt15Pct/30/60).
- cikis.karar: "dogru" (kural/stop/hedef disiplini; çıkıştan sonra hareket çıkışı destekliyor veya zarar büyümesini önledi = "iyi stopladın, tutsan zarar büyüyecekti"),
  "erken" (yön doğruydu, çıkıştan sonra lehe hareket büyük = "acele etmişsin, yön doğruydu ama erken çıktın"),
  "yanlis" (çıkış hatası: "kapatmaman gerekiyordu" — güçlü lehe hareket sürerken kapatıldı veya stop/dönüş kuralı ihlal edildi), "belirsiz".
- giris.karar: "iyi" (VWAP'a yakın, pencere içi), "kovalama" (hareket sonrası, VWAP'tan uzakta giriş: vwapDistPct büyük), "riskli" (pencere dışı veya kural ihlali), "belirsiz".
- strike.karar: "uygun" (sayilar.otmPerEm yaklaşık 0,5 civarı), "yakin" (çok ATM; otmPerEm çok küçük), "uzak" (çok OTM; otmPerEm büyük), "belirsiz".
- kacanFirsatYorum: tutma ve çıkış sonrası kaçan hareketi TAHMİNİ opsiyon P/L ile anlat (optHoldFav, optAfterFav). Mutlaka "tahmini" de.
- birDahakine: TAM 3 somut eylem (numara yazma, her biri tek cümle).
- karne: disiplinCikis, girisZamanlamasi, strikeSecimi: 0–10 tamsayı; aciklama 1–2 cümle.

Çıktı şeması (YALNIZ bu JSON):
{"feedback":[{"index":0,
 "neOldu":{"oncesi":"...","sirasinda":"...","sonrasi":"..."},
 "cikis":{"karar":"dogru|erken|yanlis|belirsiz","neden":"..."},
 "giris":{"karar":"iyi|kovalama|riskli|belirsiz","neden":"..."},
 "strike":{"karar":"uygun|yakin|uzak|belirsiz","neden":"..."},
 "kacanFirsatYorum":"...",
 "birDahakine":["...","...","..."],
 "karne":{"disiplinCikis":0,"girisZamanlamasi":0,"strikeSecimi":0,"aciklama":"..."}}]}
Her metin en çok 2 cümle. Açık pozisyonda cikis "belirsiz" ve kacanFirsatYorum "pozisyon açık" de.`;

export function coachUserText(items: { index: number; trade: unknown; legs?: unknown; rules: unknown; facts: unknown; noData: string[] }[]): string {
  return `Aşağıdaki ${items.length} işlemi koçla. feedback dizisinde TAM ${items.length} öğe olsun (index 0..${items.length - 1}); başka öğe, tekrar veya ek metin ekleme. legs = çıkış dolumları (kısmi çıkışlarda trade.exitPrice ağırlıklı ortalamadır). Bağlam JSON'u (sayılar hesaplanmış; uydurma değil):\n${JSON.stringify(items)}`;
}

export const KARNE_SYSTEM = `${BASE}

GÖREV: Bir işlem gününün koçluk sonuçlarından GÜNLÜK KARNE yaz (Türkçe, kısa, somut). Sayı uydurma.
Kaan'ın kuralları: ${KAAN_RULES_TR.replace(/\n/g, ' ')}
Şema: {"ozet":"2–3 cümle","guclu":["..."],"tekrarlayanHata":["..."],"yarinOdak":"TEK somut odak"}
guclu en çok 3, tekrarlayanHata en çok 3 madde. Veri azsa bunu özet'te söyle.`;

export function karneUserText(day: string, items: unknown[]): string {
  return `İşlem günü: ${day}. Günün koçluk sonuçları (net P/L ve puanlar kodda hesaplandı):\n${JSON.stringify(items)}`;
}
