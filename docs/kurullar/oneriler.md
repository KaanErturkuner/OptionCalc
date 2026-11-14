# Yenilik Kurulu — Öneriler (Kaan onay kuyruğu)

Tur: 2026-11-14, 6 yenilik üyesi. Tüm öneriler **Kaan onayı bekliyor**; uygulama yok. Her öneri kırmızı takım itirazıyla birlikte.
Durum: `öneri` / `Kaan onayladı` / `uygulandı` / `reddedildi`.

## Kanıt ve ölçüt (strateji)

| # | Öneri | Ölçüt / test | Kırmızı takım itirazı | Maliyet | Durum |
|---|---|---|---|---|---|
| S1 | Kısa vade varyans primi: SPY/QQQ/IWM 1DTE ATM straddle satışı, ertesi kapanışta kapatma | EOD geçmiş; spread ×1,5, kayma $0,02; çeyreklik walk-forward; en az 60 işlem | Kısa gamma kuyruğu tek büyük günle tüm beklentiyi siler. Kısa prim için ayrı risk kuralı gerekir (Kaan onayı). 1DTE EOD geçmişi varlığı doğrulanmadı. | EOD veri | öneri |
| S2 | Bilanço olay primi: EM ile gerçekleşen mutlak hareketin karşılaştırması | Son 24 ay, zamana göre bölünmüş; en büyük 5 hareket çıkarılınca sürmeli | Yalnız ETF evreninde test edilemez; bilanço tarihleri için kaynak yok; medyan negatifse çöker. | Bilanço takvimi | öneri |
| S3 | Vade yapısı ters dönüşü: ön-kısa / arka-uzun takvim spreadi | 5 katlı walk-forward; eşik komşuluk testi | Ters yapı FOMC/bilanço kaynaklı olabilir; dört bacak maliyeti kârı yiyebilir. | EOD veri | öneri |
| S4 | Radar yön isabeti, **placebo kontrollü** | Rastgele yönlü bariyerle karşılaştırma; winPct, n, timeoutPct, placebo farkı | Timeout yüksekse win% küçük örnekten çıkar. 2 saatlik ufuk ve EM ölçeği yanlış olabilir. **Kayıtların kaç gün kapsadığı bakılmadı.** | yok | öneri |

**Ortak kural (kırmızı takım):** Her öneri için kabul metriği **maliyet sonrası opsiyon P/L beklentisi** olmalı (spread ×1,5, OOS, çoklu test düzeltmesi). "Risk gerekçesi" tek başına yeterli değil. Radar eşikleri (0,001 tampon, 5 bar, 0,5·EM) ayrı bir dönemde seçilmeli; test dönemi kilitli kalmalı.

## Ürün (Fırsat, Radar, Hesapla)

| # | Öneri | Karar | Veri | Boyut | Risk / itiraz | Durum |
|---|---|---|---|---|---|---|
| P1 | İşlem öncesi kontrol satırı (Fırsat kartı): skor, veto, kademe bütçesi, takvim kapısı | Onayla/Geç öncesi | Mevcut | S | Liste onay hissini artırır; "bilgi, engel değil" diye sunulmalı. | öneri |
| P2 | Olay şeridi: bugün/yarın olay, gece taşınabilir mi | Gece kararı | Takvim kapısı | S | **En kritik risk:** bilanço "bilinmiyor" iken "yok" gibi gösterilirse güvenli sanılır. "Bilinmiyor" açıkça gösterilmeli. | öneri |
| P3 | Hesapla'da kademe önizlemesi: en fazla kaç kontrat, stop'ta kaç $ kayıp | Elle girilen opsiyon | `sizePosition`, prim | S–M | %50 tavanı yalnız gösterilir, değişmez. | öneri |
| P4 | Radar ile Akış tekilleştirme: aynı ticker ve vadede tek kart, bağımsız kaynak sayısı | Olay başına | Mevcut uyarılar | M | Birleşim bağımsız teyidi gizleyebilir; n küçükse fark gürültü olabilir. | öneri |
| P5 | DURDU'ya kalan kayıp sayacı (Fırsat özeti) | İşlem öncesi | Mevcut seri | XS | Düşük. Yalnız gösterim. | öneri |

## Risk ve davranış (ölçüt önerileri)

| # | Öneri | Not | Durum |
|---|---|---|---|
| R1 | Kural etkisi tablosu (Kaan'a sunulacak, değişiklik önerilmez): minimum kazanma oranı %16,7 (beklenti), %24,4 (kasa büyümesi, kademe %50). 5 ardışık kayıp kasayı −%54 eritir. Gap kuyruğu stop'u garanti etmez (tek işlem −2,5R). | `rules.ts` değişikliği yok. | bilgi |
| R2 | Gece gap kuyruğu: `overnight.ts` gap'i engellemez; gap kaybı −1,5R kazanma eşiğini %23,1'e çıkarır. | Karar Kaan'da. | Kaan kararı |
| R3 | Kayıt alanları: giriş nedeni (etiket), sinyal skoru ve kimliği, çıkış nedeni, giriş anı özkaynağı, işlem öncesi durum (1–3), plan dışı bayrağı. | Davranış analizi için şart. | öneri |
| R4 | Hata kalıbı ölçütleri: geç stop, erken çıkış (tahmini), aşırı işlem / intikam, kademe ihlali, kovalama. | Mevcut veriyle kısmen hesaplanır. | öneri |
| R5 | Koçluk kalite ölçümü: sayı sadakati (karnedeki her sayı kayıtlı olmalı), tutarlılık, temel çizgi kıyası, belirsizlik oranı, körlemesine puanlama. | Kaan ya da ayrı değerlendirici. | öneri |

## Veri kaynakları (yalnız web araması; fiyatlar doğrulanmadı)

| # | Öneri | Maliyet (doğrulanmadı) | Lisans | Durum |
|---|---|---|---|---|
| D1 | Alpaca OPRA: gerçek zamanlı ham opsiyon kotasyonu | ~$90/ay + OPRA sözleşmesi | **OPRA gerçek zamanlı veriyi başkalarıyla paylaşmak yeniden dağıtım lisansı gerektirir (~$1.500/ay ve kullanıcı başı ~$1,25/ay iddiası).** Hukuki yorum değil; OPRA ve hukukçuyla doğrulanmalı. | öneri, **Kaan kararı** |
| D2 | Unusual Whales API: sweep/blok etiketli akış | $150/ay | Gecikme ve yeniden dağıtım koşulları belgelenmemiş. Sınıflandırma kara kutu. | öneri |
| D3 | ThetaData: tick düzeyi geçmiş ve akış | $80/ay | Ticari kullanım lisansı gerekebilir. En çok iş ve sunucu entegrasyonu. | öneri |
| D4 | Finnhub ve SEC: mevcut kaynakları iyileştirme | Ücretsiz | Finnhub "personal use". Haber poll aralığı 5 dk sınırlı (`POLL_GAP_MS`); gözden geçirilebilir. | öneri (ücretsiz) |

## Kurul gözlemi (kırmızı takım)

Altı rolün hepsi aynı model ailesi; itirazı öneriyi yazan ajan kapatıyor. Bağımsız hakem yok. Testler mantığı doğrular, kenarı doğrulamaz. **Öneri:** Kaan'ın onayından önce kırmızı takım ayrı bir oturumda yalnız öneri metniyle çalışsın; öneriler sonuç görülmeden kaydedilip zamanla ölçülsün.
