# Tester Kurulu — Bulgular

Tur: 2026-11-14, 7 tester üyesi (salt okuma; kod okuma, çalışma zamanı doğrulaması yok). Biçim: `| Seviye | Üye | Konum | Bulgu | Durum |`.
Durum: **açık** = düzeltilmedi; **Kaan kararı** = para kuralı ya da ürün kararı gerektirir; **doğrulanmadı** = kod okumasına dayanır.

## Kritik

| Seviye | Üye | Konum | Bulgu | Durum |
|---|---|---|---|---|
| Kritik | Hesap, Kod | `signalScan.ts:333,338`; `paper/engine.ts:46` | Kontrat taramada yoksa ya da bid null ise `tickPosition` erken döner. 0DTE 15:45 zorunlu çıkış ve gece kararı çalışmayabilir. | açık, doğrulanmadı |
| Kritik | Kod | `signalScan.ts:333` | Pozisyonun ticker'ı taranamazsa stop/hedef kontrolü atlanır. Beklenen: −%40 stop her turda değerlendirilir. | açık, doğrulanmadı |
| Kritik | Kod | `paper/account.ts:125` | Sermaye NaN ise `sizePosition` NaN adet döner; `NaN <= 0` false olduğu için pozisyon NaN adetle açılabilir. | açık, doğrulanmadı |

## Yüksek

| Seviye | Üye | Konum | Bulgu | Durum |
|---|---|---|---|---|
| Yüksek | Hesap | `signals/verdict.ts:156–161`; `trade.ts:71`; `opp.ts:82` | Kart girişi mid (3,00), açılış dolumu ask+0,01 (3,01). Sermaye 3020, kademe %50: kart 5 adet, pozisyon 4 adet. Hedef: kart 9,00, pozisyon 9,03. Kart ile pozisyon uyuşmuyor. | açık |
| Yüksek | Hesap | `signals/rr.ts:7,45–47`; `strikes.ts:23` | RR kapısı komisyonlu. Brüt 1:5 (hedef 9,00) → RR 4,854 → AGRESIF_4 (hedef 7,80). 1:5 için hedef ≥ 9,18 gerekir. `rules.ts:4` "RR brüt" diyor: çelişki. | **Kaan kararı** |
| Yüksek | Hesap | `riskwatch.ts:26`; `opp.ts:85` | Dayanak stop daha sıkıysa R = 1,10 (stop = dayanak), `rules.ts` "1R = giriş×0,40" diyor. Tanım belirsiz. | **Kaan kararı** |
| Yüksek | Kod | `signals/session.ts:14–17` (+ `usmarket.ts:69`, `signalScan.ts:246,417`, `odte/signal.ts:131`) | 27 Kas ve 24 Ara 2026 gibi erken kapanış günlerinde 13:00 ET'den sonra "seans açık" sayılıyor. | açık, kod okumasıyla doğrulandı |
| Yüksek | Kod | `ui/watchStore.ts:63–67`; `screens/Calc.tsx:200` | Takip Listesi yüklenmeden Hesapla'dan ekleme eski listenin üstüne yazar; mevcut kalemler kaybolabilir. | açık, doğrulanmadı |
| Yüksek | Veri | `market/marketdata.ts:28,56–58`; `ui/radarScan.ts:37` | MarketData "veri yok" (204) boş zincir döndürür, hata fırlatmaz. CBOE/Yahoo yedeği tetiklenmez; radar boş zincirle çalışır ve kaynak "Yahoo + MarketData" görünür. | açık |
| Yüksek | Veri | `market/marketdata.ts:69,90`; `market/index.ts:35` | Zincirin kendi zamanı (`updated`) denetlenmiyor; yalnız quote zamanı kontrol ediliyor. | açık |
| Yüksek | Veri | `market/types.ts:35`; `ui/monitor.ts:34`; `alerts.ts:42–43` | `mid()` bid=0 ve last=0 iken ask/2 döndürür. Canlı pozisyonda sahte stop uyarısı üretebilir (giriş 0,50, stop 0,30, bid 0, ask 0,40 → mid 0,20). | açık |
| Yüksek | Tester-uçtan uca | `ui/radarScan.ts:107–113`; `radar/track.ts:8–11`; `ui/radarStore.ts:39` | Fiyat null dönerse outcome kalıcı null yazılıyor (`'eod' in o` yeniden denemeyi engeller). Oto tarama piyasa kapandıktan sonra çalışmadığı için öğleden sonraki uyarıların h2/eod değerleri kalıcı boş kalabilir. **Bariyer ölçümümü etkiliyor.** | açık, doğrulanmadı |
| Yüksek | Tester-uçtan uca | `ui/signalScan.ts:433` | Fırsat onayı pozisyonu yalnız `firsatStore.paper`'a yazıyor; Geçmiş bu depoyu okumuyor. Kasıtlı olabilir (`SINYAL-FIRSAT.md:56` "isteğe bağlı"). | **Kaan kararı** |
| Yüksek | Kod | `ui/signalScan.ts:386–388` | Kapanış bildirildikten sonra `setPaper` atlanırsa aynı çıkış sonraki turda yeniden bildirilir. | açık, doğrulanmadı |
| Yüksek | Kod | `market/yahoo.ts:71–72` | Dönen zincirin vadesi istenenle karşılaştırılmıyor; yanlış vade `c:SYM:EXP` önbelleğine girebilir. | açık, doğrulanmadı |
| Yüksek | Güvenlik | `lib/flow/client.ts:9` | `EXPO_PUBLIC_FLOW_API_KEY` derleme zamanında pakete gömülür; tanımlıysa sunucu uygulama anahtarı tüm kullanıcılara gider. EAS'ta tanımlı mı, doğrulanmadı. | **Kaan kontrol etmeli** |
| Yüksek | Sunucu | `master: client.ts:79` ↔ `server/app/coach.ts:151` | Koç yükleme gövdesi uyuşmazlığı (`base64` ↔ `image`) **master'da hâlâ var**. Düzeltme yalnız `claude/new-session-73a54r` dalında. | **PR gerekli** |
| Yüksek | Sunucu | `client.ts:79,84` (150 sn) ↔ `coach.ts:192,93` | Koç işleme süresi istemci zaman aşımını aşabilir; istemci hata gösterir, sunucu işlemeye devam eder. | açık, doğrulanmadı |
| Yüksek | Arayüz | `screens/Haberler.tsx:44` | Üst boşluk `insets.top` değil; "‹ Menü" düğmesi çentik ve durum çubuğunun altında kalıyor. (Yeni eklediğim ekran.) | açık, düzeltilecek |

## Orta (özet)

- **Radar/Veri:** `isStale` yalnız quote'a bakıyor; `delayedMin` piyasa kapalıyken her zaman 0 (`marketdata.ts:111`), Calc "gerçek zamanlı" gösteriyor. Yahoo barlarında yaş denetimi yok (`bars.ts:40`). SEC geçici hata `null` olarak önbelleğe giriyor (`news/index.ts:28`).
- **Hesap:** `MIN_ASK` üretimde uygulanmıyor (`costs.ts:9`). Gece kötü senaryosu kapanış komisyonunu içermiyor (`overnight.ts:72`). `rDollars` komisyonlu, etiket "1:5 = +5R" brüt; belgelenmeli (`account.ts:131`).
- **Sunucu:** Poller erken kapanışta kredi harcıyor (`poller.ts:68,80`). 20 sn önbellek "canlı" modda da geçerli (`http.ts:211`). Kredi sayımı başlığa bağlı, doğrulanmadı (`md.ts:57–61`). Deploy doğrulaması Caddy'den önce (`deploy.sh:19–35`). `sinceId` sorgusu olayları atlayabilir (`store.ts:116–118`).
- **Güvenlik:** Finnhub anahtarı URL sorgu parametresinde (`news/finnhub.ts:22,27`). Takip, Radar ve Finnhub anahtarları AsyncStorage'da düz metin. Haber bağlantıları şema denetimi olmadan açılıyor (`Haberler.tsx:54`, `Radar.tsx:120`). MarketData parametre denetimi yinelenen parametrede yanlış değere bakıyor (`proxy.ts`, `http.ts:209–213`).
- **Arayüz:** Türkçe `textTransform: uppercase` "i" hatası (`ReportParts.tsx:86`, `Calc.tsx:682`). Dokunma alanları 44 pt altında (`controls.tsx:190,198`, `Koc.tsx:164`). Tarih ve ondalık biçimi ekranlar arasında tutarsız. İngilizce ve ham kod etiketleri (`Firsat.tsx:243`, `Watchlist.tsx:130`, `Odte.tsx:298`). Koç ekranında olmayan bir düğmeye atıf (`Koc.tsx:220`). Koç yüklemesi sürerken ikinci yükleme başlatılabiliyor (`Koc.tsx:42,64`).
- **Test kapsamı:** `signalScan.ts`, `radarScan.ts`, `NewsHub`, `coach/client.ts`, `flow/client.ts` hiç test edilmiyor. `session.ts` yarım gün yolunu test etmiyor.

## Düşük

Sessiz hata yutma (`Radar.tsx:37`, `Firsat.tsx:152`). Onaysız hesap sıfırlama (`Firsat.tsx:283`). Bozuk JSON'da sessiz sıfırlama (`journalStore.ts:16–19`). `/health` kimlik doğrulamasız (`http.ts:89`). Koç ayrıştırma hatasında model çıktısının 300 karakteri journald'e yazılıyor (`coach.ts:319–323`). Finnhub anahtarı `secureTextEntry` yok (`Radar.tsx:101`). `StrictHostKeyChecking=accept-new` (`deploy.sh`). Eski %67 kalıntısı test adında (`paper-path.test.ts:59`).

## Olumlu (doğrulananlar)

Stop/hedef fiyatları (3,00 → 1,80 / 9,00 / 7,80), giriş ve çıkış dolumu, net K/Z hesabı, kademe 30/40/50, %50 tavan, Amerikan put fiyatı (6,0908), vega/theta/rho, kontrat çarpanı 100, ET kapanışı ve DST, `x-app-key` sabit zamanlı karşılaştırma, girdi doğrulama, SQL parametreleri, Caddy log başlık silme, rapor saatleri.

## Açık sorular (Kaan)

1. **RR kapısı:** Komisyon RR'ye girsin mi (mevcut kod) yoksa brüt mü (`rules.ts:4`)? Brüt 1:5 şu an AGRESIF_4'e düşüyor.
2. **1R tanımı:** Dayanak stop daha sıkıysa R ne olsun?
3. **Fırsat → Geçmiş köprüsü:** Kâğıt pozisyonlar Geçmiş'e düşsün mü?
4. **EAS:** `EXPO_PUBLIC_FLOW_API_KEY` tanımlı mı? Tanımlıysa kaldırılmalı.
5. **Koç düzeltmesi:** `claude/new-session-73a54r` dalından `master`'a PR açılsın mı?
