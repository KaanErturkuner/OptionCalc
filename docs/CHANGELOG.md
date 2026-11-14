# CHANGELOG / devir notları

## 2026-11-14 — Claude — Koç: düğmelerle elle düzenleme (kapat / düzenle / sil), AI çağrısı yok

**Neden:** Koç komut kutusu tek yönlüydü (serbest metin → Haiku öneri). Kaan bir işlemi ya da açık pozisyonu dokunarak düzeltmek, kısmi kapatmak ve silmek istedi. Yeni yol Haiku'yu çağırmaz; mevcut `POST /coach/komut/uygula` uç noktasını yapılandırılmış işlemlerle (add/update/delete) kullanır. Komut kutusu olduğu gibi duruyor.

**Ne:**
- **Açık pozisyon:** "Kapat" (satış ekle: fiyat, adet ±/yazı, en çok açık adet, saat; varsayılan şimdi İstanbul HH:MM, gün = seçili gün; alıştan önce olamaz), "Düzenle" (giriş fiyatı, toplam adet, strike, C/P, vade, saat → `update` yalnız değişen alanlarla), "Sil" (onay → alış + bağlı kapanış dolumları).
- **Eşleşmiş işlem:** "Düzenle" (giriş fiyat/saat, adet, strike, tür, vade; çıkış fiyat/saat) ve "Sil" (onay → alış + satış dolumları). Çıkış alanları yalnız **tek, paylaşılmayan** satış dolumu varsa açık; kademeli çıkış ya da başka güne düşen/paylaşılan dolum kilitli (neden gösterilir).
- **Ortak uygulama:** `applyChanges()` (Koc.tsx) komut onayı, kapat, düzenle, sil için aynı yol: `applyKomut` → görünüm → `coachLoop()` (koçluk döngüsü, eski komut akışından taşındı) → yenile.
- **Saf yardımcılar** `src/lib/coach/manual.ts`: fiyat (virgül/nokta), strike, adet, saat HH:MM, vade (YYYY-MM-DD veya GG.AA; yıl yoksa seçili gün yılı, geçmişse sonraki yıl), İstanbul şimdi, kapat/düzenle/sil eylem kurucuları, sig'den dolum kimliği (`tradeFillIds`).
- **UI:** `src/ui/CoachEdit.tsx` (RN Modal, koyu tema, ≥44 pt, büyük yazı; numerik ondalık klavye). Yeni native bağımlılık yok.
- **Görünüm tipi (küçük sunucu değişikliği):** `CoachOpenView` ↑ `entryFillId?`, `legFillIds?` (`server/app/coach.ts` tek satır). Açık pozisyonun giriş dolumu başka günde olabildiği için yalnız görünüm günü `fills` yetmiyordu. Sunucu eski sürümdeyken açık pozisyonda Düzenle/Sil kapalı kalır (Kapat çalışır).

**Dosyalar:** `src/lib/coach/manual.ts` (yeni), `src/ui/CoachEdit.tsx` (yeni), `src/screens/Koc.tsx`, `src/lib/coach/types.ts`, `server/app/coach.ts` (1 satır), `test/coach-manual.test.ts` (yeni), `package.json` (test zinciri).

**Doğrulama:** `npm test` ✓ (yeni `coach-manual.test.ts` dahil; sunucu `komut-test` de geçti); `npx tsc --noEmit` ✓; `npm run lint` ✓ (uyarı yok). Cihazda (Expo Go) görsel kontrol **yapılmadı**; sunucuya canlı istek atılmadı.

**Açık / dikkat:**
- **Sunucu deploy gerekir** (yalnız açık pozisyon Düzenle/Sil için `entryFillId`). Deploy edilmeden uygulama çalışır, o iki düğme pasif kalır.
- Silme ve çıkış düzenleme dolum düzeyinde çalışır: paylaşılan bir satış dolumu silinirse başka pozisyonun eşleşmesi de değişir. Onay metni silinecek dolumları listeler; çıkış düzenlemesi paylaşılan dolumda kilitlidir.
- Koçluk: düzeltme sonrası değişen işlemlerin raporu silinir ve yeniden üretilir (sunucu kuralı). Bu da Haiku çağrısı doğurabilir (mevcut komut akışıyla aynı).
- Düzenleme önizlemesi yok (Kaydet doğrudan uygular, yalnız Kapat ve Sil'de onay var). İstenirse eklenir.
- Yükleme akışının kendi koçluk döngüsü bilerek dokunulmadı.

## 2026-11-14 — Claude — Bilanço takvimi: Nasdaq → Finnhub (sunucu önbelleği), görsel ekranlar, favoriler ve sonuç bildirimi

**Neden:** Bilanço takvimi resmî olmayan Nasdaq uç noktasına bağlıydı (kırılgan, sürpriz/gerçek EPS yok). Kaan görsel bir takvim, sürpriz yüzdesi, grafikler, favori yıldızı ve gerçek EPS açıklanınca bildirim istedi. Anahtar yalnız sunucuda kalır.

**Ne:**
- **Sunucu (`server/app`):** `GET /earnings?from&to&watch` (x-app-key, en çok 31 gün, varsayılan bugün..+6); `GET /earnings/history?symbol`; `POST /earnings/favs {token,symbols}`. Finnhub `calendar/earnings`, `stock/profile2` (piyasa değeri, haftalık), `stock/earnings` (24 sa). SQLite tabloları: earn_items/days/fetch_log (önceden), earn_caps, earn_hist, earn_favs, earn_notified. Tick 15 dk, bugün−3..+14; geçmiş günler 08:00 ve 16:30 ET kontrol noktalarından sonra bir kez yenilenir (gerçek EPS dolsun).
- **Küçük şirket filtresi:** ≥ 2 mlr $ veya izleme listesi / favori. Değeri bilinmeyen küçük şirket gizli. `watch` parametresi uygulama tarafından izleme + favori sembollerinden gönderilir.
- **Favori bildirimi (seçim: sunucu push):** Sunucu zaten Expo push gönderiyor (`push_tokens`, Akış ve raporlar). Uygulama favorileri ve Expo tokenını sunucuya bildirir; yeni çekimde favori sembolün `epsActual`'i boştan dolunca o cihaza push atılır (aynı cihaz+gün+sembol bir kez). Yerel bildirim yolu eklenmedi: uygulama kapalıyken de çalışır, OTA gerektirmez. Sınır: cihaz push kaydı (izin) yoksa token yoktur; favori yerel kalır, bildirim gelmez.
- **Uygulama:** `src/lib/earnings/{model,calendar,charts,client}.ts` (saf + istemci), `src/ui/{earnStore.ts,EarnCharts.tsx}` (favoriler, SVG grafikler), `src/screens/{Bilanco,BilancoDetay}.tsx` (yeniden tasarım: ay/hafta ızgarası, gün sayaçları, BMO/AMC gruplu sıkı satırlar, yıldız; detayda EPS/gelir kartları, EPS geçmişi, beklenen hareket ve strike OI/hacim çubukları, 5 gün akış primi, haber). `src/ui/flowPush.ts` → `currentPushToken()` eklendi.
- **Kaldırıldı:** `src/lib/earnings/fetch.ts` (Nasdaq), eski `parseEarningsCalendar` / `parseUsd` / `summarizeChain` yolu.
- **Beklenen hareket:** en yakın vade (≥ bilanço günü) ATM straddle (call orta + put orta) ÷ spot.
- **Sürpriz:** (gerçek − beklenti) / |beklenti| × 100, kodda hesaplanır; yeşil pozitif, kırmızı negatif.

**Dosyalar:** `server/app/{earnings.ts,http.ts,main.ts,push.ts,sources.ts,store.ts}`, `server/README.md`; `src/lib/earnings/*`, `src/ui/{earnStore.ts,EarnCharts.tsx,flowPush.ts}`, `src/screens/{Bilanco,BilancoDetay}.tsx`; testler `test/earnings.test.ts` (saf), `test/earnings-server.test.ts` (sahte kaynak + `:memory:` SQLite); `package.json` (test betiği).

**Doğrulama:** `npm test` ✓ (yeni iki bilanço testi dahil); `npx eslint` (değişen uygulama dosyaları) ✓; `npm run flow:selftest` ✓; `npx tsc --noEmit`: uygulama tarafında hata yok; sunucu dosyalarında yalnız önceden var olan `node:*` / `@types/node` eksikliği hataları (`config.ts`, `poller.ts`, `store.ts`; bu ortamda `@types/node` yok, AGENTS.md notu). Canlı Finnhub çağrısı YAPILMADI (anahtar bu oturumda kullanılmadı); görsel kontrol Expo Go'da yapılmadı.

**Açık / dikkat:**
- **Deploy yapılmadı.** Sunucuda `server/deploy.sh` ve yeni tablolar için yeniden başlatma gerekir. Uygulama OTA yayınlanmadı (Kaan isteyince).
- Finnhub `profile2` ve `stock/earnings` ücretsiz planda kısıtlı olabilir. 403 alınırsa piyasa değeri bilinmez → küçük şirketler (izleme dışı) hiç görünmez. İlk canlı çekimde doğrulanmalı.
- Piyasa değeri tüm takvim penceresi için birkaç tick'te dolar (tick başına 120 sorgu); ilk açılışta liste eksik görünebilir.
- Favori yıldızı bildirim izni ister (`syncEarnFavsToServer` → `currentPushToken`). Favori yoksa açılışta izin istenmez.
- Gelir sürpriz yüzdesi yok (yalnız EPS için); gelir gerçek/beklenti gösterilir.
- Sürpriz yüzdesi beklenti sıfır/negatifken yanıltıcı olabilir; kodda beklenti 0 ise null.

## 2026-11-14 — Claude — Akış: filtreler, Dağılım, kural yorumu, AI yorum (Haiku)

**Neden:** Kaan Akış olaylarını daraltmak, strike bazında call/put primini görmek ve okunabilir bir yorum istedi. Yorum ücretsiz ve kural tabanlı; Haiku yorumu yalnız butona basınca, sunucuda üretilir (anahtar uygulamada yok).

**Ne:**
- **Filtreler** (Liste ve Dağılım ortak): hisse (DEFAULT_TICKERS önce), taraf, gün (Bugün / Dün / 3 gün, ET takvimi, hafta sonunda Bugün boş kalır), min prim (50 bin / 100 bin / 500 bin / 1 M$), vade (0DTE / Haftalık; Cuma tatilse önceki işlem günü). Tercihler `akis-filters-v1` anahtarında (AsyncStorage), `AppState`'e girmez.
- **Dağılım:** strike bazında call/put prim ve kontrat, net; ayrıştırıcı çubuklar (put sola kırmızı, call sağa yeşil, ortak ölçek); spot'a en yakın strike vurgulu. Hisse seçilmemişse filtredeki en çok primli hisse.
- **Kural yorumu** (`src/lib/flow/yorum.ts`, `src/lib/radar/yorum.ts`): yön, güven, en çok 5 madde; yalnız sonradan kurulmuş veri varsa güven en çok orta; "Yatırım tavsiyesi değildir." her zaman son madde. Radar detayına da aynı kutu eklendi (OI, P/C, duvarlar, max pain, gamma flip; güven asla yüksek değil).
- **AI yorum** (`GET|POST /flow/yorum?ticker=&day=`): payload sunucuda kurulur (akış olayları + varsa kayıtlı duvar anlık görüntüsü); istemci tablo göndermez. Haiku tek çağrı, max 1200 token, 90 sn zaman aşımı.
- **Saklama (Kaan kuralı):** ticker+gün başına EN FAZLA bir satır (`flow_yorum`, SQLite). "Yenile" satırın üzerine yazar; geçmiş, sürüm ve liste yok. Satır yalnız o ET günü için tutulur; bugünden önceki satırlar her yorum isteğinde silinir. Eski gün için POST metni döner ama saklanmaz. Yenileme hata verirse eski metin kalır.
- **Hatalar (Türkçe):** 400 geçersiz hisse/gün; 401/403 anahtar; 404 akış yok / henüz yorum yok; 503 sunucuda Anthropic anahtarı yok; 504 / 502 Haiku zaman aşımı ya da hata. Anahtar yanıtta ve logda yok (selftest kontrol eder).

**Dosyalar:** `src/lib/flow/{filter,distribution,yorum,aiyorum}.ts` (yeni), `src/lib/flow/{client,proxy}.ts`, `src/lib/radar/yorum.ts` (yeni), `src/ui/{akisStore,AkisFiltre,AkisListe,AkisDagilim,AkisYorum,YorumBox}.tsx|ts` (yeni), `src/screens/{Akis,RadarDetail}.tsx`, `server/app/{flowyorum.ts (yeni),http.ts,store.ts,main.ts,selftest.ts}`, testler `test/flow.test.ts`, `test/radar-detail.test.ts`.

**Doğrulama:** `npx tsc --noEmit` ✓; `npm test` ✓ (flow ve radar-detay bölümleri dahil); `npx eslint` (değişen dosyalar) ✓; `npm run flow:selftest` ✓ (83 kontrol, yorum bölümü dahil; sahte Haiku, ağ yok).

**Sunucu dağıtımı:** `server/deploy.sh` 2026-11-14 çalıştı; `optioncalc-flow` active; `/health` 200; kimlikli GET `/flow/yorum` → 404 "Henüz AI yorumu yok", geçersiz hisse → 400. Canlı POST (Haiku) yapılmadı: maliyet nedeniyle.

**Açık / sonraki:**
- Uygulama OTA ile yayınlanmadı ve commit atılmadı (koordinatör).
- AI yorumu filtreleri uygulamaz: sunucu o hisse ve günün tüm akışını kullanır. Arayüzde yazılı.
- POST için ayrı günlük kota yok; genel 120 istek/dk sınırı geçerli. Maliyet izlenmeli.
- Haiku yorumunun gerçek veride kalitesi henüz denenmedi.
- Bu ortamda `@types/node` yok; sunucu dosyaları tam tip denetiminden geçmedi (selftest çalışma zamanını doğrular).

## 2026-11-14 — Cuma (2026-11-13) akış ekranı: gerçek EOD zincirden sonradan kurma

**Neden:** Akış tarayıcısı Cuma günü henüz çalışmıyordu; Akış ekranında 13/11 boştu. Kaan örnek veri değil gerçek veri istedi; kredi tavanı bu iş için 50.000’e kadar onaylandı.

**Ne:**
- Canlı tarayıcıyla aynı eşikler ve vade kümesi (0DTE + 3 ay Cuma). dV = günün toplam hacmi (açılış tabanı 0); OI = önceki seans mutabakatı (MarketData `date=D` kuralı).
- MarketData tarihsel zincir (`date=`, 1000 sembol / 1 kredi). Cuma henüz tarihsel değilse `mode=eod` yedeği (sembol başı 1 kredi, `minVolume` süzmesi).
- Gün içi opsiyon mumu dokümanda yok; bir kez yoklanır. Yoksa zaman = kapanış 16:00 ET (uydurma gün içi an yok).
- Olaylar `reconstructed=1`. Akış kartında etiket: "Sonradan gerçek veriden oluşturuldu". Push yok.
- Betik: `server/app/flowbackfill.ts` (yalnız sunucuda, md.ts üzerinden). `flow.db` yedeği alınır.

**Açık:** Cuma opsiyon verisi bazı planlarda pazartesi 09:30 ET’ye kadar tarihsel sayılmaz; o durumda eod yedeği veya erteleme.

## 2026-11-14 — Claude (commit prefix [grok], Kaan isteği) — Koç yükleme hatası: görüntü dönüşümü, gerçek hata gösterimi, sunucu günlüğü

**Neden:** Expo Go'da 22 Midas görüntüsü yüklenemedi ("0/22 görüntü işlendi · 0 yeni dolum"). Sunucuya hiçbir `/coach` çağrısı Haiku'ya ulaşmadı: `koç extract` satırı yok, `coach_calls`/`coach_shots` bugün boş. Sunucu 400/413/429 yanıtlarını loglamıyordu; Caddy'de erişim günlüğü yoktu. İstemci tarafında üç kök neden vardı:
1. **Hata gizleniyordu:** `upload()` sonrası `load(day)` başarılı olunca `err` temizleniyordu → görüntü hataları ekrana hiç gelmedi; ekranda GET'in sonucu kaldı.
2. **Görüntü dönüştürülmüyordu:** seçicinin base64'ü "her zaman JPEG" varsayılıyor, boyut sınırı yoktu (tam çözünürlük, PNG/HEIC olabilir). Büyük/yanlış biçimli gövde sunucuda ya da Caddy'de düşüyor, istemci yalnızca genel bir ağ hatası görüyordu.
3. **Sunucu günlüğü yoktu:** 400/413/429 sessizdi; Caddy erişim günlüğü yoktu.

**Ne:**
- `src/ui/coachPicker.ts`: her görüntü `expo-image-manipulator` ile JPEG'e çevrilir (genişlik ≤1600, uzun kenar ≤2000, en-boy korunur, kalite 0,7, base64). Çevirme başarısızsa seçicinin base64'üne düşülür; yalnız gerçek JPEG ise kabul edilir. Dönüşüm sırasında "hazırlanıyor n/N". Atlanan her görüntü için neden döner.
- `src/lib/coach/image.ts`: `scaleDims` (boyut hesabı, büyütme yok), `sniffMime` (JPEG/PNG/GIF/WebP/HEIC sihirli bayt), `b64Head` 12 bayta kadar okur.
- `src/lib/coach/uploadError.ts` (yeni, saf): HTTP durumu + sunucu mesajı → Türkçe metin (ağ, zaman aşımı, 401, 413, günlük/hız 429, 422, 400, 5xx). `majorityDay`: yüklenen dolumların en çok geçen tarihi.
- `src/screens/Koc.tsx`: **"Yükleme (görüntü başına)"** kartı: her görüntü için durum (hazırlanıyor/gönderiliyor/yeniden deneniyor/tamam/hata + nedeni, KB). GET hatası ayrı kartta ("Veri alınamadı"); yükleme hataları artık silinmez. Yüklemeden sonra gün seçici dolumların tarihine geçer. Anahtar yoksa yükleme başlamadan durur.
- `src/lib/coach/client.ts`: ağ hatasına tarayıcı/RN mesajı eklenir ("Sunucuya ulaşılamadı (Network request failed)").
- `server/app/http.ts`: `/coach*` her isteğin sonucunu tek satırda loglar (`koç istek POST /coach 200 1850ms gövde=95448B mime=image/jpeg gün=… dolum=… yeni=… koçluk=…`). 401/429 dâhil. Görüntü verisi, anahtar ve başlıklar yazılmaz. Gövde sınırı aşılırsa bağlantı kopmaz, 413 JSON döner (önceden istemci ağ hatası görüyordu). Gövde sınırları tutarlı: Caddy /coach 7 MB, Node 6 MB base64 (4 MB görüntü ≈ 5,6 MB).
- `server/Caddyfile`: yalnız `/coach*` için JSON erişim günlüğü `/var/log/caddy/coach-access.log` (10 MB × 5 döndürme); `request>headers` silinir (x-app-key asla yazılmaz — doğrulandı: 0 eşleşme). Caddy'nin kendi hataları (413 dâhil) `{"error": "..."}` JSON döner.
- `server/deploy.sh`: Caddyfile **caddy kullanıcısıyla** doğrulanır (önce `caddy` sahipli kopya); geçersizse dağıtım durur. Günlük dosyası dizin/sahip olarak oluşturulur.
- `package.json`: `expo-image-manipulator ~58.0.16` (SDK 58 bundled sürümü; JS + Expo Go'da hazır). `npm test` zincirine `test/coach-image.test.ts`.

**Doğrulama:**
- Birim testleri (`test/coach-image.test.ts`): ölçek (1290×2796 → 923×2000; 4032×3024 → 1600×1200; büyütme yok), sihirli bayt (JPEG/PNG/GIF/WebP/HEIC/AVIF), `checkImage` davranışı, hata metni eşlemesi (ağ, zaman aşımı, 401, 413, 429 günlük/hız, 422, 400, 5xx), `majorityDay`.
- `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest).
- Dağıtım: `server/deploy.sh` (servis yeniden başlatıldı; Caddy yeniden yüklendi).
- **Gerçek yükleme (tek):** 1290×2796 test görüntüsü (Midas benzeri tek ALIŞ dolumu) → uygulamanın dönüşümü (923×2000 JPEG q70) → `POST https://162-243-88-42.sslip.io/coach`: **HTTP 200**, 1,85 sn, 1 dolum (NVDA 150 C, alış, 3 adet, 3,20), 1 Haiku çağrısı (girdi 4514 / çıktı 215 token), koçluk 0. Node günlüğü ve Caddy erişim günlüğü satırı oluştu; anahtar günlüklerde yok.
- **Temizlik:** test kaydı silindi (`coach_shots` 1, `coach_fills` 1, `coach_calls` 1). Silme sonrası koç tabloları boş. Yedek: `/var/lib/optioncalc-flow/flow.db.bak-koc-test-20261114T103249` (test öncesi; silinebilir).

**Kök neden (kanıtlanan / kanıtlanmayan):** Kanıtlanan: hatalar ekrana düşmüyordu (kod), sunucu 4xx'i loglamıyordu, Caddy erişim günlüğü yoktu. Kanıtlanamayan: telefondan hangi aşamada düştüğü — 07:10–07:35 arası için sunucuda hiçbir kayıt yok, bu yüzden tam neden bilinmiyor. Yeni günlük bir sonraki denemede tam durumu verir (`journalctl -u optioncalc-flow | grep "koç istek"` ve `/var/log/caddy/coach-access.log`).

**Olay (07:28–07:31 UTC, ~3 dk site kesintisi):** Dağıtım, Caddy günlük dosyasını root olarak oluşturdu (`caddy validate` root olarak çalıştı) → Caddy yeniden başlamadı. Dosya `caddy` sahibine alındı, sonra servis başladı. Ayrıca doğrulama sırasında yanlış ana bilgisayar adıyla (nokta, `162.243.88.42.sslip.io`) test ettim; gerçek site adı `162-243-88-42.sslip.io` (tire). Bu hata bir süre yanlış teşhise yol açtı; eski sertifika yeniden alındı (Let's Encrypt, `OLD-162-243-88-42.sslip.io` klasörü ve `/root/caddy-certs-backup-*` yedeği duruyor).

**Açık / dikkat:**
- Görüntü boyutu: 1290×2796 → 923×2000 (uzun kenar sınırı nedeniyle genişlik 923). Haiku tarafı zaten ~1568 px'e küçültüyor; okunabilirlik için yeterli görünüyor ama gerçek Midas ekranıyla kontrol edilmeli.
- `coach_trades` tablosu şemada var, sunucu kodunda kullanılmıyor (eski kalıntı; dokunulmadı).
- 13.11 test verisi (15 çağrı, 2 görüntü, 23:01–23:37 UTC) 00:12 yedeğinden önce kaybolmuş; neden bilinmiyor (sıfırlanma ya da yeniden kurulum). Sunucudaki yedeklerde mevcut.
- Expo Go'da cihaz testi yapılmadı (yükleme akışı Kaan'da). Yayın yok; Kaan isteyince.

## 2026-11-14 — Claude (commit prefix [grok], Kaan isteği) — para kuralı: prim stopu −%40 (eskiden %67)

**Neden:** Kaan kararı: sert stop prim girişten %40 düşünce (eskiden %67). Risk = giriş × 0,40; 1:5 hedef = giriş + 5R (×3,0), yedek 1:4 = ×2,6. Örnek: giriş 3,00 → stop 1,80, hedef 9,00, yedek 7,80. Uyarlanabilir ÇIK otomatik çıkış yapmaz, yalnız uyarır.

**Ne:**
- **Tek kaynak** `src/lib/paper/rules.ts` (`PREMIUM_STOP_DROP = 0.40`, `stopPremOf`, `riskPremOf`, `targetPremOf`, `exitPremForR`, `PREMIUM_STOP_PCT`). Kullanan yerler: `signals/rr.ts`, `signals/riskwatch.ts` (`PRIM_STOP_MAX`, `effectiveStopPrem`), `signals/opp.ts` (eski `0.67` literal'i kaldırıldı), `signals/trade.ts` (`STOP_PCT = 40`, kart stop yüzdesi), `signals/verdict.ts` (`levelsFor`: stop/1:5/1:4), `ui/TradeCard`/`ui/VerdictCard` (etiket), `paper/path.ts` (`exitForRPath`, `stopPrem`), `paper/mc.ts` (`stopPrem: fill/3` → `stopPremOf`), `coach/rules.ts` (`stopPriceOf`, `targetPriceOf`, kural etiketi), `coach/context.ts` (Koç'un KAAN kuralları metni, `%40`), `odte/strategies/firsat.ts` (yorum).
- **ÇIK yalnız uyarı:** `signals/riskwatch.ts` ÇIK için artık `close` dönmez (`hold` + mesaj). `paper/engine.ts`: ÇIK geçişinde bir kez `warn` olayı (metin korundu); DİKKAT bildirimi aynen. Sert stop, hedef, 15:45 ET ve gece kuralı değişmedi. Çıkış sebebi ÇIK metni kapanış olarak artık üretilmez.
- **Backtest:** `backtest/engine.mts` `KAAN_PMAX = PREMIUM_STOP_DROP` (0,40); `selftest.mts` B7 eşikleri 0,60 / 0,40. Eski raporlar (%67) yeniden koşulmadı.
- **Fırsat:** `OpportunityCard` hem "Onay bekliyor" hem "Geçmiş kartlar" içinde `ErrorBoundary` ile sarıldı (önceki hotfix'in açık notu kapandı).
- **Belgeler:** AGENTS.md (para kuralı + `rules.ts` haritası), CLAUDE.md (özet), `docs/tasks/SINYAL-FIRSAT.md` (2026-11-14 notu, K5 satırı), `docs/tasks/QULLAMAGGIE.md`. Tarihsel handoff ve `docs/reports` dosyaları eski değerleri korur.
- **Testler güncellendi:** `test/paper.test.ts`, `paper-path.test.ts`, `firsat.test.ts`, `setups.test.ts`, `trade-card.test.ts`, `verdict.test.ts`, `coach.test.ts`, `adaptive.test.ts`. Yeni örnek testi: giriş 3,00 → 1,80 / 9,00 / 7,80 (verdict, coach); ÇIK 0,5R ve 2R'de yalnız uyarı; ÇIK stop'u (0,60) önce gelir.

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest). Sunucu öz-testi de geçti.

**Açık / dikkat:**
- Gece taşıma kapısı "kötü senaryo ≤ 1,5R" R bazlı olduğu için R artık daha büyük $ (giriş × 0,40): aynı kötü senaryo daha az gece taşımaya izin verir. Kaan'ın kararı gerekir (eşik $ mı R mı).
- Kayıtlı Sonuç kartları (AsyncStorage, `status`) ve **açık kâğıt pozisyonlar** (`stopPrem0` = eski 1/3) eski stop/hedef değerleriyle kalır; kartlar bir sonraki taramada, açık pozisyon ise kapanana kadar eski %67 stopuyla yönetilir. Açık pozisyonlar için migrasyon yapılmadı (Kaan karar verecek).
- Test "ÇIK + 1R–2R tetik" durumu (T4–T7) hâlâ mevcut kuralla kapanıyor (R ≥ 2R + tetik); yalnız ÇIK otomatik çıkışı kaldırıldı.
- Commit yapıldı, push ve Expo yayını yok (Kaan yayınlayacak).

## 2026-11-14 — Claude (commit prefix [grok] hotfix) — Fırsat ekranı çökmesi (eski Sonuç kartları)

**Neden:** Üretimde Fırsat ekranı "TypeError: Cannot read property 'S' of undefined" ile çöküyordu. `status` kayıtları AsyncStorage'da (firsat-v1) saklanıyor; eski sürümden kalan Sonuç kartlarında `levels` (ve `crits`/`fired`) yok, `tradeOf` ve `triggerText` bunları doğrudan okuyordu.

**Ne:**
- `src/lib/signals/trade.ts`: `normalizeVerdict` (eksik alan → varsayılan; spot bilinmiyorsa NaN ve işlem kartı yok). `tradeOf`, `triggerText`, `buildBoard` bunu kullanır; bozuk girişler panoda atlanır.
- `src/ui/ErrorBoundary.tsx` (yeni): kart başına hata sınırı, hata olursa "veri yok" kutusu. Fırsat pano bölümü, her işlem/BEKLE kartı, Detaylar'daki Sonuç kartları ve Odte Sonuç bloğu sarılı.
- `src/ui/VerdictCard.tsx`: normalize edilemeyen kart "veri yok" satırı. Firsat `buildBoard` try/catch ve `setups` için `?.` koruması.
- Test: `test/trade-card.test.ts` bölüm 7 (eksik levels/crits/fired, null girdi, hafta sonu/veri yok → BEKLE, throw yok).

**Doğrulama:** `npm run check` geçti (exit 0).

**Açık:** `OpportunityCard` (Onay bekliyor / Geçmiş kartlar) henüz ErrorBoundary ile sarılı değil; eski `cards` kayıtlarında eksik alan görülürse aynı yöntemle sarılmalı.

## 2026-11-14 — Claude (commit prefix [grok], Kaan isteği) — uyarlanabilir çıkış (ÇIK/TUT/DİKKAT) ve rejim histerezisi

**Neden:** Kaan onayı (2026-11-14, bu oturum): "düşünsün eğer dönüyorsa piyasa geçsin, yok devam edeceğine dair gösterge olursa devam". T1/T2 sabit tetikleri yerine açık kâğıt pozisyonda dönüş ↔ devam tartısı istendi. Rejim değişimleri 13/11 20:00–20:40 arasında ham olarak titreşiyordu (TASKS D14).

**Ne:**
- **Uyarlanabilir çıkış** `src/lib/signals/adaptive.ts` (saf): girişten beri lehte uç noktadan karşı hareket ≥ %0,3 olunca değerlendirilir. Dönüş (aleyhte) puanı: VWAP kaybı 2, hacimli ters mum 2, 5 dk dip/tepe kırılımı 2, onaylı rejim aleyhte 2, momentum ters 1. Devam (lehte): VWAP doğru tarafta 2, HH/HL veya LH/LL korunuyor 2, hacimli trend mumu 1, onaylı rejim lehte 1, momentum yönde 1. Dönüş > devam → **ÇIK** (kapatır); devam > dönüş → **TUT**; eşit → **DİKKAT** (izle, çıkış yok). Ağırlıklar `ADAPT` sabitleri. Neden satırı tek satır Türkçe ("ÇIK: VWAP kaybı + hacimli ters mum + …; devam kanıtı zayıf").
- **riskwatch**: uyarlanabilir girdi varsa T1/T2/T3 yerine kullanılır. Sıra: hedef → %67 prim stopu (değişmedi) → 15:45 → ÇIK → T4–T7. ÇIK her kâr düzeyinde çıkarır. Girdi tanımsızsa eski T1–T7 davranışı aynen.
- **Histerezis** `src/lib/market/regime.ts`: ham rejim 5 dk kapanışlarında ölçülür; yeni rejim ardışık `HYST_BARS = 2` kapanış görülmeden onaylanmaz (ilk ölçüm doğrudan). `regimeTrace`, `confirmedRegimeAt` (raw + confirmed + pending), `regimeChanges` artık onaylı değişimleri verir. Rapor (`intra.ts`, yeni alanlar `rawKind`, `pending`; "Onay bekleniyor" satırı), Sonuç/Fırsat kartı (`regimeSummary`) ve risk izleyici onaylı rejimi kullanır.
- Paper: `OpenPosition.adaptive` (son karar); DİKKAT geçişinde bir kez bildirim; ÇIK kapanış metni karar nedenini taşır. Fırsat ekranı açık pozisyonda "Uyarlanabilir çıkış: …" satırı.
- **Yahoo niteliksel geri test** `backtest/riskwatch-replay.mts` (MarketData yok; 429 için üstel bekleme ve önbellek `/workspace/backtest/yahoo/`). Çıktı: `/workspace/backtest/reports/riskwatch-replay-2026-11-12_13.md`, özet `docs/reports/riskwatch-replay-2026-11-12_13.md`.

**Sonuçlar (kısa):** 4 hipotetik pozisyonda 4 ÇIK; 3'ü erken (fiyat sonra pozisyon yönünde devam etti, +0,33% / +1,44% / +0,47% en iyi), 1 yatay. Histerezis: QQQ 12/11 16 → 10 değişim, SPY 12/11 15 → 7, QQQ 13/11 12 → 8, SPY 13/11 12 → 10. 13/11 20:20 tek kapanışlık sıçrama elendi; 20:25 karışık → 20:40 konsolidasyon onaylı kaldı (≥10 dk sürdü).

**Dosyalar:** `src/lib/signals/adaptive.ts` (yeni), `src/lib/signals/riskwatch.ts`, `src/lib/market/regime.ts`, `src/lib/reports/intra.ts`, `src/lib/reports/types.ts`, `src/lib/paper/engine.ts`, `src/lib/paper/types.ts`, `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`, `src/screens/Firsat.tsx`, `test/adaptive.test.ts` (yeni, 25 kontrol; `package.json` test zinciri), `backtest/riskwatch-replay.mts` (yeni), `docs/reports/riskwatch-replay-2026-11-12_13.md`, `docs/TASKS.md` (#41, D14).

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest). Sunucu: `server/deploy.sh` (src/lib değişti) → `optioncalc-flow` active (06:41 UTC). Geri test çalıştı (Yahoo, 4 pozisyon, 2 gün).

**Açık / devir:**
- ÇIK eşiği sıkılığı: 4 örnekte 3 erken çıkış; karşı hareket %0,3 gürültü seviyesinde. Eşik (örn. %0,5 veya ÇIK için yapısal teyit şartı) veya W_MOM ağırlığı Kaan kararı; şimdilik spec'e göre (%0,3, dominans).
- Giriş noktaları hindsight (dip = pencere min'i); test çıkış davranışını ölçer, giriş kalitesini değil. Opsiyon primi modellenmedi (kâğıt sonuç değil).
- Histerezis tam süzme değil (20:25–20:40 karışık kaldı). Daha sert istenirse `REGIME_K.HYST_BARS` (3).
- Örnek raporlar (13/11) DB'de yeniden üretilmedi (isteğe bağlı; sunucu DB'sine yazılmadı). Histerezis etkisi yukarıdaki tablo ve geri test raporunda.
- Yahoo bu kutuda 429 veriyor; geri test yeniden koşulacaksa önbellek varsa ondan çalışır.
- Yayın yok (Expo'ya dokunulmadı), push yok, MarketData çağrısı yok, ücretli Anthropic çağrısı yok.

## 2026-11-14 — Grok — [grok] reports: 21:00 ara raporu, seans rejimi, onaylı dönüş, senaryo olasılıkları

**Neden:** Kaan: 13/11'de piyasa 18:00–20:00 İst arasında sıkıştı, ama 20:00 raporu hâlâ düşüş bekliyordu — eğilim kuralı açılıştan beri ortalamaya bakıyordu, rejimi görmüyordu. Ayrıca dönüş tespiti Sonuç/Fırsat kartlarında yoktu.

**Ne:**
- **21:00 ara raporu** (`intra4`): açılış + 3,5 sa. Kış 21:00 İst, yaz 20:00 İst (NY açılışına çapalı, DST ile kayar). Erken kapanış günlerinde (13:00 ET) atlanır. Kutu başlığı "21:00 Raporu". Yaz/kış ara raporları ve etiketleri `schedule.ts` tek kaynak.
- **Rejim** (`src/lib/market/regime.ts`, saf, eşikler `REGIME_K`): QQQ (yoksa SPY) 1 dk barları, ATR14 5 dk. Konsolidasyon → karar **BEKLE**, etiket "KONSOLİDASYON – bant kırılımını bekle", bant üst/alt + "bant üstü X → CALL, bant altı Y → PUT". Trend (yükseliş/düşüş) ve onaylı dönüş ayrı rejimler; erken seans (<45 dk) eski eğilim kuralına düşer.
- **Dönüş tespiti** (0DTE): seans uç noktasından ≥ %0,3 ters hareket + son 30 dk içinde ≥ 2 teyit (VWAP geri alma/kaybı [≥15 dk ters tarafta kalıştan sonra], hacim ≥ 1,5× önceki 20 mum ortalaması ve fitil ≥ %50 ya da yutan mum, 5 dk yükselen dip / alçalan tepe kırılımı). 1 teyit = aday (rejimi değiştirmez), ≥2 = onaylı.
- **Ara rapor bölümleri:** "Şu ana kadar ne oldu" (açılış, seans yükseği/dibi ve saatleri, VWAP, son fiyat, rejim değişimleri, en sert 15 dk hareket), "Rejim" (bant, teyitler), "Bundan sonra ne bekleniyor — kural tabanlı tahmin": devam / dönüş / yatay, tam sayı, toplam 100, her birinde tetikleyici. Taban olasılıklar `BASE` (rejime göre), VWAP tarafı ±5 puan kayar; en büyük kalan yöntemiyle normalize.
- **Sonuç ve Fırsat kartları:** konsolidasyonda yön **Bekle – bant kırılımı** (bant seviyeleri kartta; BEKLE tetikleyicisi bant üstü/altı), onaylı dönüşte ters yönlü eski puan **Bekle** (dönüş notu kartta). Yön sadece puanla gelir; dönüş tek başına yeni yön vermez.
- **Uygulama:** `ReportParts.IntraBlock` (rozet, metin satırları, olasılık çubukları renkli). Eski raporlarda `intra` alanı yok → düz metin/eski görünüm.

**Eşikler (kalibrasyon: 13/11 ve 12/11 QQQ/SPY 1 dk, Yahoo):** `ATR_N` 14 (5 dk) · `WINDOW_MIN` 75 · `WINDOW_MIN_OK` 45 · `CONS_RANGE_ATR` 3,5 (ilk değer 3,0; 13/11 13:00 ET penceresi 3,18 ATR olduğu için yükseltildi) · `CONS_SESSION_FRAC` 0,5 · `CONS_VOL_RATIO` 0,8 · `CONS_VWAP_CROSSES` 3 · `TREND_SIDE_FRAC` 0,8 · `TREND_MOVE_ATR` 1,5 · `REV_COUNTER_PCT` 0,3 · `REV_LOOKBACK_MIN` 30 · `REV_CONFIRM` 2 · `REV_VOL_MULT` 1,5 · `REV_WICK_FRAC` 0,5 · `VWAP_HOLD_MIN` 15.

**13/11 yeniden kurulumu (sunucu, nokta-zamanlı, MarketData çağrısı yok, push yok):**

| Rapor (İst) | Rejim (QQQ) | Karar | Devam / Dönüş / Yatay |
|---|---|---|---|
| 17:00 piyasa öncesi | — (vadeli skoru +0,11) | BEKLE | — |
| 18:00 açılış +30 dk | erken seans | PUT (eğilim kuralı) | 38 / 33 / 29 (aşağı devam) |
| 19:00 açılış +1,5 sa | düşüş trendi (10:00–11:00 ET düşüşü) | PUT | 55 / 25 / 20 |
| 20:00 açılış +2,5 sa | **konsolidasyon** 671,71–676,30 | **BEKLE** | 25 / 25 / 50 |
| 21:00 açılış +3,5 sa | **konsolidasyon** 673,54–677,89 | **BEKLE** | 25 / 25 / 50 |
| Gün sonu 00:30 | — | PUT (gün değişimi) | — |

19:00 İst = 11:00 ET (düşüş penceresi); 20:00 İst = 12:00 ET (sıkışma). Yani 20:00 raporu artık "düşüş bekle" demez. Gün sonu raporu eski kuralı kullanır (sabah BEKLE → gün sonu PUT: ıska).

**Dosyalar:** `src/lib/market/regime.ts` (yeni), `src/lib/reports/intra.ts` (yeni), `schedule.ts` (intra4, INTRA_KINDS), `types.ts`, `sections.ts`, `text.ts`, `sources.ts` (Yahoo h/l/v), `src/lib/signals/verdict.ts` + `trade.ts`, `src/lib/odte/scan.ts`, `src/ui/signalScan.ts` (rejim girdisi), `src/ui/ReportParts.tsx`, `src/screens/Raporlar.tsx`, `server/app/reporter.ts` (tapeOf, TAPE=QQQ/SPY, 4 gün geri), `server/app/backfill.ts`, `server/README.md`. Testler: `test/regime.test.ts` (sentetik: trend, konsolidasyon, V-dönüşü, VWAP geri alma, erken, olasılık toplamı, kart kuralları), `test/reports-intra.test.ts` (DST: kış 21:00 / yaz 20:00, erken kapanış, etiketler, bölümler, geriye uyum); `test/reports.test.ts` (6 slot). `package.json` test zinciri güncellendi.

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest). Yeni birim testleri: regime 40 kontrol, reports-intra 26 kontrol (hepsi geçti).
- Sunucu: DB yedeği `/var/lib/optioncalc-flow/flow.db.bak-pre-intra4-20261114T061411Z` (VACUUM INTO, sahip ocflow, mod 600). Dağıtım `server/deploy.sh` → `optioncalc-flow` active.
- Örnekler: `backfill.ts --day 2026-11-13 --force` (yalnız `ornek:` satırları silindi); 6 satır yazıldı, `intra` bölümü ve bias doğrulandı. Gerçek (canlı) satırlara dokunulmadı.

**Açık / devir:**
- **riskwatch T1/T2 (açık pozisyon çıkış tetikleri, PLAN §7.3) değiştirilmedi:** kağıt pozisyon çıkışlarını etkiler; yeni 0DTE dönüş tespiti yalnız rapor/Sonuç/Fırsat'ta. Kaan onaylarsa T1/T2 yeni eşiklere bağlanabilir.
- Rejim gün içinde dalgalanabilir (13/11'de 20:00–20:40 arası çok geçiş; `regimeChanges` bunları listeler). Histerezis eklenmedi.
- Expo Go'da görsel kontrol yapılmadı (yalnız tip denetimi ve lint); IntraBlock kart boyutu Kaan'da kontrol edilmeli.
- Yayın yok (Expo'ya dokunulmadı), push yok, MarketData çağrısı yok, ücretli Anthropic çağrısı yok.
- Sonuç kartı eşiği (MIN_SUM=3) ve Fırsat puanları değişmedi; yalnız rejim kuralı eklendi.

## 2026-11-14 — Claude — [grok] ui: Fırsat ekranı yeniden tasarlandı (işlem kartları, BEKLE, Detaylar)

- Üstte en güçlü 1–3 fırsat için büyük işlem kartı: ticker, CALL/PUT rozeti, strike (spot'tan OTM $), vade (0DTE / "n gün" + tarih), giriş (orta), stop (−%67), hedef 1:5, yedek 1:4, kademe ve adet (sermaye · %kademe → N kontrat · maliyet), gidiş-dönüş komisyon, stopta/hedefte net tahmini, güç x/5, düz Türkçe gerekçe, gece etiketi ve makro uyarılar.
- Hiç işlem yoksa BEKLE kartı: neden + her ticker için tetikleyici (ör. "QQQ 690 üstü + VWAP 688 üstü → CALL"). Tetikleyici, eşiğe (±3) en yakın yönden seçilir.
- Ham koşullar, göstergeler, tarama notları, özet, isabet, ayarlar ve Sinyal tickerları varsayılan kapalı "Detaylar" bölümüne taşındı. "Onay bekliyor" kartları (Onayla / Geç) görünür kaldı; geçmiş kartlar Detaylar'da.
- Kurallar değişmedi: vade, strike, prim stopu, RR, kademe (%50/40/30), komisyon ve gece kuralı aynı fonksiyonlardan okunur.
- Yeni saf modül `src/lib/signals/trade.ts` (kart türetimi, adet/komisyon, gece etiketi, BEKLE tetikleyicisi, sıralama); `verdict.ts` artık seviyeleri (`levels`) taşıyor (ek alan, mevcut alanlar değişmedi).
- Yeni görsel: `src/ui/TradeCard.tsx`. Test: `test/trade-card.test.ts` (35 kontrol), `package.json` test betiğine eklendi.
- Doğrulama: `npm run check` geçti (exit 0). Görsel Expo testi yapılmadı; iPhone'da kart boyutu ve kırılma kontrol edilmeli.
- Açık: kâğıt işlem önerisi kesin değildir; komisyon "brüt prim + ayrı komisyon" olarak gösterilir. Gece taşıma koşullarının (rejim, 2σ gece senaryosu) tamamı kartta değil, yalnız etiketinde özetlenir.

## 2026-11-14 — Claude — [grok] reports: Duvarlar ve birikim bloğu daraltılabilir

- Raporlar: "Duvarlar ve birikim ▸/▾" başlığı (tek satır özet: `TICK: CW x · PW y`), varsayılan kapalı. İçinde duvar merdiveni/kartları (CW, PW, gamma flip, max pain) ve opsiyon birikimi. Açık/kapalı durumu oturum boyunca bellekte tutulur (global, rapor başına değil).
- Yer değişikliği: "Opsiyon birikimi" bölümü artık Takvim/Haberler'in üstünde, duvar bloğunun içinde.
- Dosyalar: `src/screens/Raporlar.tsx`, `src/ui/ReportParts.tsx` (WallsBlock), `src/lib/reports/wallSummary.ts` (saf özet), `test/reports-wallsummary.test.ts` (npm test zincirine eklendi).
- Doğrulama: `npm run check` geçti. Fırsat ekranına dokunulmadı.
- Açık nokta: tek satır özet birden çok ticker'da uzun olabilir (numberOfLines=1 ile kırpılır).

## 2026-11-14 — Claude — [grok] reports: yapılandırılmış rapor bölümleri, yeni Raporlar görünümü, 13/11 örnekleri yeniden kuruldu

**Neden:** Kaan: "raporlar çok basit, tek düze, renksiz, özensiz". Metin tek sütundu; karar, seviye ve takvim gözle taranamıyordu.

**Ne:**
- **Veri:** rapor artık `ReportSections` (JSON) taşır: özet (CALL/PUT/BEKLE, `dataOk`, ana seviyeler, tek cümle plan), metrikler,
  duvarlar (ticker başına spot/call/put/flip/max pain, önceki değer ve kaynak etiketi), takvim (ET + İst, etki, açıklandı/bekleniyor),
  haberler (etki etiketi), akış yığını (call/put prim payı), gün sonu incelemesi (sabah beklentisi → gerçek, İSABET/IŞKA, duvar
  kayması okları, yarın planı), veri sorunları. Düz metin (`body`) ve push metni aynen kalır.
- **Karar kuralı** (`src/lib/reports/rules.ts`, tek kaynak): piyasa öncesi = vadeli %70 + Asya/Avrupa %30; intra/gün sonu = izleme
  listesi ortalaması. Eşik ±0,25: üstü CALL, altı PUT, arası BEKLE. Veri yoksa BEKLE + `dataOk=false` (gün sonu "veri yok").
- **Yeni saf modüller:** `sections.ts` (bölüm üretimi, kayma okları, haber etkisi, metrik kartları, plan cümlesi), `ladder.ts`
  (kompakt duvar merdiveni yerleşimi, etiket çakışmasını önler). Eski `text.ts` kuralları `rules.ts`'e taşındı (dışa aktarımlar korundu).
- **VIX:** `^VIX` Yahoo'dan (MarketData değil) tüm raporlara eklendi; nokta-zamanlı backfill'de de aynı şekilde.
- **DB migrasyonu:** `reports.sections TEXT` (NULL = eski satır → uygulama düz metne düşer). Bozuk JSON → null, liste düşmez.
  Gün sonu raporu, aynı günün piyasa öncesi beklentisini DB'den okur (`reportByKey`).
- **Uygulama:** `src/ui/ReportParts.tsx` (rozet, özet kartı, metrik ızgarası, duvar kartı + kompakt merdiven (SVG), takvim
  zaman çizelgesi, haber listesi, akış yığını, gün sonu kartı, veri sorunları). `Raporlar.tsx`: gün ekranının üstünde son durum
  kartı; her kutunun başlığında tür, saat ve karar rozeti; açılınca yapılandırılmış görünüm, bölümü olmayanlarda düz metin.
- **Örnekler (13/11):** 5 örnek satır `--force` ile yeniden yazıldı (yalnız `example=1` satırları silindi). Kaynaklar: `hist_chain`
  (12/11 zinciri, saklı, MarketData çağrısı yok), Yahoo, Finnhub (akış/geçmiş backfill kuralları aynı). 13/11 gün sonu zinciri yok →
  gün sonu duvar kayması "veri alınamadı" (dürüst). Sonuç: sabah BEKLE (skor +0,11) → gün sonu PUT → IŞKA.

**Dosyalar:** `src/lib/reports/{rules,sections,ladder}.ts` (yeni), `types.ts`, `text.ts`, `client.ts`, `group.ts`;
`src/ui/ReportParts.tsx` (yeni), `src/screens/Raporlar.tsx`; `server/app/{store,reporter,backfill,selftest}.ts`;
`test/reports-sections.test.ts` (yeni, npm test zincirine eklendi), `test/reports-pit.test.ts`, `test/reports-hist.test.ts`
(fixture güncellemesi); `server/README.md`.

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest). Yeni birim testleri: 70+ kontrol.
DB yedeği: `/var/lib/optioncalc-flow/flow.db.bak-pre-sections-20261114T005857Z` (VACUUM INTO, sahip ocflow, mod 600; 5 rapor, 7 zincir).
Dağıtım: `server/deploy.sh` → `active`. Kuru çalıştırma ve gerçek yeniden yazım servis kullanıcısıyla (`systemd-run`, aynı
LoadCredential). Sonradan şema ve satırlar okunarak doğrulandı.

**Açık / devir:**
- Uygulama ekranı Expo Go'da henüz görsel olarak denenmedi (yalnız tip denetimi ve lint); Kaan cihazda bakmalı.
- Merdiven yalnız seviye işaretlerini çizer (strike-düzeyi OI saklanmıyor); radar merdiveninin çubukları yok.
- Gün sonu "yarın planı" 13/11 için seviye verisi olmadığından "seviye verisi yok" der; canlı günlerde kapanış zinciri varsa düzelir.
- Yayın yok (Expo'ya dokunulmadı), push yok, yeni MarketData çağrısı yok.

## 2026-11-14 — Claude — [grok] reports: 13/11 örnek raporlar önceki kapanış (12/11) zinciriyle duvar ve birikim

**Neden:** 13/11'de sunucu çalışmadığı için akış/duvar kaydı yoktu; örnek raporlarda duvarlar ve opsiyon birikimi "veri alınamadı" çıkıyordu.

**Ne:**
- `server/app/histfetch.ts` (yeni, yalnız sunucu, tek MarketData istemcisi): tarihsel zincir (`date=`), ticker × vade başına bir istek
  (`expiration=`), vade kümesi akışla aynı (0DTE + 3 ay Cuma). Yalnız özet yazılır (duvar + birikim → `hist_chain` tablosu).
- `src/lib/reports/histchain.ts` (yeni, saf): en yakın vade duvarı; ticker başına en büyük **açık pozisyon (kontrat sayısı)**.
  İlk sürümde OI×fiyat sıralaması vardı; derin-ITM kontratları öne çıkardığı için değiştirildi (12/11 yeniden çekildi).
- `server/app/backfill.ts`: canlı kayıt yoksa önceki kapanışla kurar. Başlıklar "önceki kapanış (12/11) zincirine göre" diye
  etiketli. Intra: açılış anı yok → kayma yazılmaz, "Gözlem" notu yazılmaz. EOD: kayma yalnız gün sonu zinciri varsa.
  PIT kapısı: zincir zamanı (16:00 ET) < rapor anı. Backfill MarketData'ya çağrı yapmaz.
- `src/lib/reports/text.ts`: `ReportInput.basis` (opsiyonel); basis yoksa canlı çıktı değişmez.
- Test: `test/reports-hist.test.ts` (npm test zincirine eklendi).

**Veri durumu:**
- 12/11 kapanış zinciri: VAR (7 ticker; her biri için duvar ve birikim).
- 13/11 gün sonu zinciri: YOK. MarketData `date=2026-11-13` için HTTP 400 döndürdü ("Invalid date. The date parameter is used for
  historical queries only."), kredi tüketilmedi. Gün sonu duvar kayması bu yüzden "veri alınamadı". Bu, 13/11 verisinin henüz
  tarihsel olarak yayımlanmadığını gösteriyor olabilir; sonra yeniden denenebilir (`histfetch.ts --date 2026-11-13 --report-day 2026-11-13`).

**Kredi (yanıt başlıkları):** yoklama 1 + 12/11 ilk çekim 65 + 12/11 sıralama düzeltmesi yeniden çekimi 65 + 13/11 denemesi 0 = **131**.
Kalan (başlık): 96.465.

**Örnek raporlar:** 13/11 için 5 örnek yeniden yazıldı (`--force`, yalnız örnek satırları silindi). DB yedeği:
`flow.db.bak-pre-hist-20261114T004010Z`. Canlı rapor yok.

**Açık konular / devir:**
- Ön piyasa raporunda duvar/birikim bölümü yok (değişmedi). Bilanço takvimi için geçmiş anlık görüntü hâlâ yok.
- Birikim, akış (dV) değil; açık pozisyon. Raporda "en büyük açık pozisyon" olarak etiketli.
- 12/11 zincirinde bazı vadeler yok (ticker başına 9–10 / 14); bunlar atlandı.

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest). Deploy: `server/deploy.sh`,
servis `active`. Örnek metinler DB'den okunup kontrol edildi.

## 2026-11-14 — Claude — [grok] takvim: PPI ve diğer önemli veriler (2026 yayın tabloları)

**Neden "önemli bir şey yok" dedi:** `MACRO_CALENDAR` (events.ts) yalnız FOMC/CPI/NFP içeriyordu; raporlar ve gece kapısı aynı tabloyu kullanıyordu.
PPI (13 Kas 2026 Cuma, 08:30 ET = 16:30 İst) hiçbir yerde yoktu. Finnhub ekonomik takvimi kodda hiç çağrılmıyor (`economic` aramasında
sıfır sonuç); yani kaynak sorgusu yapılmadı, takvim tablosu eksikti.

**Ne:**
- `src/lib/calendar/releases.ts` (yeni, saf): 2026 yayın tablosu — PPI, PCE (kişisel gelir), GSYH, perakende, JOLTS, ISM imalat/hizmet,
  UMich (ön/nihai), FOMC tutanakları; haftalık işsizlik başvuruları (kurala göre, Şükran Günü kayması). Her satır ET saat, `verified`, kaynak URL.
  `eventsOn(gün)`, `releaseWarnings`, `cardCalendarLines(nowMs)`. Saat dönüşümü `Intl` ile (DST dâhil; İstanbul saati sabit yazılmadı).
- **Blokaj kümesi değişmedi:** gece kapısı yalnız FOMC/CPI/NFP (`BLOCKING_KEYS`, `calendarCheck`). Diğerleri `overnight.ts` içinde `warnings`
  olarak döner; taşıma kararını değiştirmez. Taşıma mesajında "Uyarı (engellemez): …" olarak görünür.
- **Raporlar:** piyasa öncesi "Takvim" bölümü (açıklandı / bekleniyor, İst saatiyle); açılış +30 dk / +1,5 / +2,5 sa ve gün sonu raporlarına
  "Bugünkü önemli veriler"; gün sonunda yarın. Sunucu (`reporter.ts`, `backfill.ts`) artık `eventsOn` kullanır.
- **Sonuç kartı** (`src/ui/VerdictCard.tsx`): "⚠️ bugün PPI 16:30 İst · açıklandı" / "⚠️ yarın …" satırları.
- Testler: `test/calendar-releases.test.ts` (tarih araması, 2026-11-13 → PPI, DST İstanbul saati, Şükran Günü başvuru kayması,
  1 Oca → 31 Ara, blokaj kümesi değişmedi, kart ve rapor metinleri). `package.json` test zincirine eklendi. `npm run check` geçti.

**Doğrulama durumu (retrieval 2026-11-14):**
- Resmi sayfadan doğrulandı: PPI (Ekim ref 13 Kas, Kasım ref 15 Ara) — BLS; JOLTS 1 Ara 10:00 — BLS; BEA tam takvimi (PCE ve GSYH 2026
  satırları); Census perakende 13 satır (17 Kas, 16 Ara dâhil); Fed FOMC karar + tutanak tarihleri (Şub–Eki); UMich nihai 20 Kas 10:00 ET.
- **Doğrulanmadı** (`verified=false`, metinde "tarih doğrulanmadı"): ISM imalat 2 Kas, 1 Ara (ikincil kaynak + kural); ISM hizmet 4 Kas, 3 Ara (kural);
  UMich ön 4 Ara (tek ikincil kaynak), UMich nihai 18 Ara (ikincil); FOMC tutanağı 18 Kas ve 30 Ara (karar + 21 gün aritmetiği);
  işsizlik başvuruları tüm yıl (DOL takvimi okunamadı; 25 Kas Şükran kayması ikincil kaynaklarda).
- Eksik/okunamadı: UMich Kasım ön tarihi; ISM resmi takvimi (ismworld giriş sayfasına yönlendiriyor); PPI/JOLTS 2026 Ocak–Eylül satırları sayfada
  yok (geçmiş; eklenmedi); Fed Başkan konuşmaları (güvenilir kaynak yok, atlandı); DOL PDF metni okunamadı.
- Saat dilimi: BEA ve BLS sayfaları saat dilimini yazmıyor; ET varsayıldı (standart yayın saatleri 08:30 / 10:00 / 14:00 ET).
- Tablo yıllık güncellenmeli (kaynaklar yukarıdaki URL'lerde).

**Sunucu (droplet):** `server/deploy.sh` (active). 13 Kasım örnek raporları yeniden üretildi: eski 5 örnek satırı silindi (`example=1`,
`ornek:2026-11-13:*`), DB yedeği `flow.db.bak-2026-11-14T00-14-11-312Z.db` (ocflow sahipliği). Yeni 17:00 raporu takvim bölümü:
`PPI (üretici fiyatları) (08:30 ET · 16:30 İst) — açıklandı; oynaklık artabilir`. MarketData çağrısı yok; push yok. Finnhub yalnız haber/bilanço için
(backfill'in mevcut davranışı). Örnekler `flow.db` içinde 30 gün sonra silinir.

**Dosyalar:** `src/lib/calendar/releases.ts` (yeni), `test/calendar-releases.test.ts` (yeni), `src/lib/reports/text.ts`, `types.ts`,
`src/lib/paper/overnight.ts`, `src/lib/paper/engine.ts` (uyarı metni), `src/ui/VerdictCard.tsx`, `server/app/reporter.ts`, `server/app/backfill.ts`,
`server/fixtures/reports-sample.json`, `test/reports.test.ts`, `package.json`, `docs/TASKS.md`.

**Açık:** UMich Kasım ön tarihi ve ISM resmi takvimi doğrulanmalı; sonraki yıl tablo güncellemesi; Finnhub ekonomik takvimi kullanılmıyor (ücretsiz
planda kapsamı test edilmedi).

## 2026-11-14 — Claude — [grok] koç: saat dilimi hatası (ET→İstanbul +7 sa kayması) düzeltmesi

**Ne:** Canlı testte (QQQ 680P 0DTE, alış 2,44 / satış 3,53) Midas'ın "Gerçekleşme tarihi 13 Kasım 2026, 18:05:24" satırı model
tarafından `2026-11-14T01:05` yazıldı (+7 sa). Alış (17:57) doğruydu. Midas saatleri zaten İstanbul yerelidir; model ET→İstanbul
"çevirisi" yapmıştı. Düzeltmeler: (1) çıkarma isteminde ve `record_fills` şemasında açık kural: saat İstanbul'dur, aynen kopyala, saniyeyi at,
ASLA saat dilimi çevirme; "Gerçekleşme tarihi" > "Emir tarihi". (2) Yeni saf denetim `src/lib/coach/sanity.ts` (`checkFillTime`): dolum
İstanbul seans penceresinde (16:30 → ertesi gün 00:15; sabit İstanbul saati, DST gerekmez) ve 0DTE'de vade gününde olmalı; geçersiz ve
zaman tam −7/−8/+7/+8 saat kaymışsa ve düzeltilmiş zaman geçerliyse düzeltilir + Türkçe uyarı ("saat dilimi düzeltildi: 2026-11-14 01:05 →
2026-11-13 18:05 (-7 sa)"); düzeltilemiyorsa zaman değişmez, uyarı verilir. Denetim eşleştirmeden önce, kayıttan önce çalışır; uyarılar
yükleme yanıtının `warnings` ve dolumun `warn` alanında, önbellekli yüklemelerde de döner. (3) Birden çok düzeltme geçerliyse ilki (−7,
gözlenen model hatası) alınır, alternatif uyarıda yazılır. (4) Canlı testin verisi: Koç tabloları sıfırlandı (aşağıda).

**Dosyalar:** `src/lib/coach/sanity.ts` (yeni), `src/lib/coach/prompt.ts` (`EXTRACT_SYSTEM`, `EXTRACT_TOOL`, `extractUserText`),
`server/app/coach.ts` (`coachImage`: denetim + uyarılar), `server/app/selftest.ts` (+2 öz-test: +7 kayması), `test/coach-time.test.ts`
(yeni, 17 test), `package.json` (test zinciri).

**Veri temizliği (droplet, 2026-11-14):** yedek `/var/lib/optioncalc-flow/flow.db.bak-20261113-234046` (VACUUM INTO, ocflow,
644). Silinen (gün 2026-11-13 + bu görüntülerin dolumları): coach_fills 2 (biri 2026-11-14 kayıtlı — yanlış 01:05 satırı, aynı görüntü
önbelleğiyle silindi), coach_shots 2, coach_reports 1, coach_karne 1, coach_calls 15. Sonra: tüm Koç tabloları 0. Hiçbir sır yazılmadı.

**Doğrulama:** `npm run check` geçti (birim dâhil yeni `coach-time`, tsc, lint, bt:selftest, flow:selftest). Paralı Anthropic çağrısı YOK
(öz-testte sahte istemci). Canlı yeniden yükleme yapılmadı; Kaan aynı iki görüntüyü yeniden yüklerse kayıt 18:05 olmalı.

**Açık sorular / takip:** (a) Belirsiz kayma (−7 ve −8 ikisi de seans içinde, ör. 01:05 → 18:05 veya 17:05) için −7 seçilir; Kaan uyarıdaki
alternatifi ekran görüntüsünden doğrulamalı. (b) Model yine saat çevirirse uyarı `saat dilimi düzeltildi` olarak görünür; sayısı izlenmeli.
(c) Seans penceresi yalnız saat aralığıdır: 0DTE dışında geçerli vade günü kuralı ve tatiller `isTradingDay` ile denetlenir.

## 2026-11-14 — Claude — [grok] koç: dolum çıkarma sağlamlaştırma (JSON yok hatası)

**Ne:** Canlı `POST /coach` (sentetik görüntü, 2026-11-13) `Model çıktısında JSON yok` döndü; sunucu hiçbir şey loglamadı. Kök neden
adayları: (a) çıkarma `max_tokens` 400 idi — 6 satır dolum JSON'u ≈ 450 token, kesilme riski; (b) model düz metin/önsöz yazıp hiç `{`
üretmediyse ayrıştırıcı sessizce hata veriyordu; (c) görüntüde "Sentetik ekran" yazısı modelin metin yazmasına yol açmış olabilir. Hangisi
olduğu bu koşuda loglanmadı; yeni log bunu bir sonraki yüklemede gösterir. **Paralı Haiku çağrısı yapılmadı.**
Düzeltmeler: (1) çıkarma zorunlu araçla (`tool_choice: {type:"tool", name:"record_fills"}`, şema `EXTRACT_TOOL`) — çıktı şema-uyumlu girdi;
(2) `max_tokens` 1024; (3) ayrıştırıcı: ```json çitleri, önsöz/sonsöz, dize-duyarlı dengeli `{…}`/`[…]`, assistant prefill devam metni,
çıplak dolum dizisi (giriş+çıkış); kesik çıktı → "tam JSON yok (kesilmiş olabilir)"; (4) ayrıştırma hatasında log: `stop=`, `in/out`
token, `tool=`, ≤300 karakter örnek (base64 kırpılır, anahtar yok); koçluk ve karne hatalarında da aynı tanı; (5) görüntü bloğu
(image/png|jpeg, base64, görüntü önce) doğrulandı — değişiklik yok.

**Dosyalar:** `src/lib/coach/validate.ts` (`parseModelJson`, `balancedEnd`, `sampleText`, `validateFills` dizi kabulü),
`src/lib/coach/anthropic.ts` (`ToolDef`, `tool` → `tools`+`tool_choice`, `toolInput`), `src/lib/coach/prompt.ts` (`EXTRACT_TOOL`, çoklu satır
kuralı), `server/app/coach.ts` (araç, 1024, `parseWarn`), `server/app/selftest.ts` (sahte araç yanıtı, düz metin hatası, max_tokens),
`test/coach.test.ts` (+21 ayrıştırma/araç testi), selftest (+4), `server/README.md`.

**Doğrulama:** `npm run check` geçti (birim + tsc + lint + bt:selftest + flow:selftest). Sunucu öz-testi sahte Anthropic ile.
Canlı çağrı yok. Deploy sonucu aşağıda (server/deploy.sh).

**Açık sorular / takip:** (a) Canlı ilk yüklemede `KOÇ UYARI: dolum çıkarılamadı` satırına bak; `tool=0` ve `stop=end_turn` ise
model araç yerine metin yazdı (API/model araç desteği veya prompt sorunu). (b) Araç desteği bu modelde 400 dönerse hata
`Anthropic 400 (invalid_request_error)` olarak görünür — o durumda `tools` kaldırılıp yalnız metin+prefill'e dönülür. (c) Bir görüntüde
6'dan fazla satır varsa fazlası atılır (şema ve `validateFills` sınırı 6); gerekirse artırılır.

## 2026-11-14 — Claude — [grok] Raporlar: örnek geri doldurma (nokta-zamanlı) + gün klasörleri (TASKS #36 devamı)

**Ne:** (1) 2026-11-13 (Cuma) için 5 örnek rapor (17:00, 18:00, 19:00, 20:00 İst, gün sonu) sunucuda yeniden kuruldu. Her rapor yalnız
kendi anından önce tamamlanmış veriyi görür (Yahoo barları `t+süre ≤ rapor anı`, günlük kapanış 16:00 ET kapısı, önceki gün kapanışı yerel tarihle,
Finnhub haberleri yayın zamanı < rapor anı). Akış/duvar kaydı o gün yoktu → “veri alınamadı” (MarketData kredisi harcanmadı, geçmiş zincir çağrılmadı).
Bilanço geçmişi yok → “veri alınamadı”. Başlıkta “Örnek ·”, `example = 1`, push yok. (2) Raporlar ekranı: gün klasörleri
(“13/11/26 Cuma Raporları”, en yeni önce); klasör → daraltılabilir kutular (“17:00 Raporu” … “Gün Sonu Raporu”, örnekler “örnek” etiketli).

**Dosyalar:** `server/app/backfill.ts` (yeni), `server/app/store.ts` (`example` sütunu + migrasyon, `flowAgg(day, beforeMs)`, `pollSeenBefore`, `deleteExampleReport`),
`server/app/sources.ts` (`series()`: Yahoo period1/period2), `server/app/selftest.ts`, `server/README.md` (Örnek raporlar),
`src/lib/reports/pit.ts` (yeni, nokta-zamanlı yardımcılar + `exampleReport`), `src/lib/reports/group.ts` (yeni, gün klasörü/kutu etiketleri),
`src/lib/reports/sources.ts` (`parseYahooSeries`, `Bar`), `src/lib/reports/text.ts` + `types.ts` (`flowKnown`), `src/lib/reports/client.ts` (`example`, limit 50),
`src/screens/Raporlar.tsx`, `test/reports-pit.test.ts` (yeni), `test/reports-group.test.ts` (yeni), `package.json` (test zinciri).

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest — örnek satır ve akış sorgusu kontrolleri dâhil).
Sunucu yerelde kuru çalıştırıldı (`--dry-run`, yalnız Yahoo; Finnhub anahtarı yok, haberler “veri alınamadı”).
**Dağıtım ve gerçek koşu:** `server/deploy.sh` (servis active, `/health` 200). `backfill.ts --day 2026-11-13` droplette `ocflow` olarak (systemd-run + LoadCredential, anahtar yazdırılmadı): 5/5 yazıldı (id 1–5, `example: true`, push yok). `GET /reports?limit=50`: 5 örnek. Haberler yayın saatine göre (18:00 raporunda en yeni 17:59 İst).

**Açık / dikkat:** (a) Genel haber akışı (`/news?category=general`) geriye dönük sorgulanamıyor; kapsam dışıysa rapor bunu “Veri sorunları”nda yazar.
(b) Örnek raporlar 30 gün sonra diğer raporlarla birlikte silinir. (c) Canlı raporlarda duvar/birikim hâlâ anlık görüntüden; geçmiş günlerde yalnız akış kaydı
olan günlerde dolu olur (11-13 için kayıt yok). (d) Premarket fiyatları Yahoo 5 dk barlarından; CME/Asya günlük sınırları Yahoo tarih damgasına bağlı, küçük sapmalar olabilir.

En yeni üstte. Biçim: `## 2026-11-14 — Grok — [grok] Radar detay: dikey merdiven (ladder) grafiği (TASKS #33 devamı)

**Ne:** Yatay OI/hacim çubukları yerine dikey merdiven: strike'lar yukarıdan aşağıya (en yüksek üstte), ortada strike etiketi, call çubukları sağa (yeşil), put sola (kırmızı), en büyük çubuğa göre ölçek.
Spot, Call/Put duvarı, Gamma flip, Max pain yatay çizgi; konumu iki strike arasında doğrusal enterpolasyonla. Dikey ScrollView (420 px görünüm); açılışta ve OI ⇄ Hacim geçişinde spot satırına kayar.
Pencere ±%25, en fazla 80 strike (yoğunsa kovalanır). Zincir istek boyutu (`CHAIN_LIMIT` 80) değişmedi → MarketData kredisi aynı.

**Dosyalar:** `src/lib/radar/detail.ts` (`ladderOrder`, `valueIndex`, `rowY`, `nearestIndex`, `scrollTargetY`, `markerFracs`, `LADDER` sabitleri),
`src/ui/OiLadder.tsx` (yeni; `react-native-svg`), `src/ui/OiChart.tsx` (silindi), `src/screens/RadarDetail.tsx`, `test/radar-detail.test.ts` (+24 kontrol).

**Doğrulama:** `npm run check` geçti (test, typecheck, lint, bt:selftest, flow:selftest). Görsel test Expo Go'da yapılmadı.

**Açık / dikkat:** Pencere ±%25 ama zincir yalnız 80 strike isteniyor (MarketData `strikeLimit`); yoğun hisselerde ±%25 dışı kalan strike'lar olabilir (CBOE tam zincir döner). Çizgi enterpolasyonu strike indeksine göre (eşit satır aralığı); strike aralıkları düzensizse (ör. $1 ve $5 adımlar) satır başına mesafe eşit görünür.

## YYYY-MM-DD — Ajan — başlık`, sonra ne / dosyalar / nasıl doğrulandı / açık sorular.

## 2026-11-14 — Claude — [grok] Koç v2: toplu yükleme, kodda eşleştirme, işlem başına koçluk (TASKS #37)

**Ne:** 40'a kadar Midas görüntüsü tek seferde; her görüntü için tek küçük Haiku çıkarma çağrısı (dolum: tk, vade, strike, C/P, adet, alış/satış, prim, saat);
dolumlar SQLite'ta; alış–satış eşleştirmesi koddan (sözleşme başına FIFO, kısmi çıkışlar tek işlemde, kapanmamış = açık pozisyon, açılışsız satış = eşleşmeyen);
her kapanmış işlem için **bir** koçluk çağrısı (metin, görüntüsüz), rapor işlem imzasıyla saklanır (aynı işlem tekrar koçlanmaz).
Aynı görüntü (sha256) önbellekten; Haiku ve sayaç harcamaz.

**Dosyalar:** `src/lib/coach/fills.ts` (yeni, saf eşleştirme), `src/lib/coach/queue.ts` (yeni, saf yükleme kuyruğu: n/N, 429/ağ/5xx geri çekilme, günlük sınır ve 401'de dur),
`src/lib/coach/{validate,prompt,limits,types,client}.ts`, `src/screens/Koc.tsx`, `src/ui/coachPicker.ts` (40), `server/app/{coach,store,http,config,selftest}.ts`,
`server/README.md` (Koç bölümü + maliyet), `test/coach.test.ts`, `test/coach-fills.test.ts` (yeni), `test/coach-queue.test.ts` (yeni), `package.json` (test zinciri).
Bağımlılık eklenmedi. Caddy 7 MB /coach sınırı korundu (tek görüntü ≤ 4 MB).

**Kararlar (kendi seçimim, geri alınabilir):** (1) Yalnız uzun işlem: flat satış = eşleşmeyen satış (Kaan uzun opsiyon işliyor; açığa satış koçlanmaz).
(2) Koçluk görüntüsüz (metin): görüntü tokeni yok, yalnız bağlam JSON. (3) Dolum kimliği = içerik (zaman+sözleşme+yön+fiyat+adet); aynı dakikada aynı
sözleşme/yön/fiyat/adet iki ayrı dolum ise tek sayılır (ekranda tek satır görünürse nadir bir kayıp olabilir). (4) Yükleme başına en çok 3 koçluk;
kalanı istemci döngüsü (`/coach/process`). (5) COACH_MIN_GAP_SEC 2, COACH_DAILY_CAP 100 (varsayılanlar; droplet'te env geçersiz kılma yok).

**Doğrulama:**
- `npm run check`: exit 0 (test + typecheck + lint + bt:selftest + flow:selftest). Sunucu öz-testi 49 sınama (0 FAIL; tüm öz-test 49 koç + tespit sınaması) (sahte Haiku/Yahoo): önbellek, sırasız yükleme,
  kısmi çıkış (2,75 ort., 2 bacak), koçluk hatası ve kurtarma, gap/daily 429, karne, yedek model, anahtar sızıntısı yok.
- Birim testleri: eşleştirme (FIFO, kısmi, farklı sözleşme/vade/C-P, sırasız, yetim, kimlik kararlılığı) ve kuyruk (gap, geçici, 422, daily, 401, n/N).
- **Dağıtım:** `server/deploy.sh` başarılı; `optioncalc-flow` ve `caddy` active; `/coach/process` ve `GET /coach` anahtarsız 401, `/health` 200.
- **Ücretli test: YAPILMADI (0 çağrı).** Anthropic anahtarı bu ortamda yok; droplet'teki anahtar okunmadı (kural). Yani çıkarma istemi (EXTRACT_SYSTEM v2)
  gerçek modelle henüz denenmedi.

**Canlı test komutu (Kaan, kendi terminalinde; anahtar ekrana basılmadan):** bir görüntüyle tek çıkarma:
```bash
K=$(ssh -i ~/.ssh/do_flow root@162.243.88.42 'cat /etc/optioncalc-flow/app_key')
B=$(base64 -w0 midas.png)
curl -s https://162-243-88-42.sslip.io/coach -H "x-app-key: $K" -H 'content-type: application/json' \
  -d "{\"image\":\"$B\",\"mime\":\"image/png\",\"day\":\"2026-11-13\"}"
```
(Bu komut koçluk da üretir; ilk gerçek ekran görüntüsünü kullanın.)

**Maliyet (tahmin, server/README):** 40 çıkarma + 20 koçluk ≈ **$0,035/gün** (Haiku 5.5: $0,10 / $0,50 per MTok). Görüntü tokeni
ölçülmedi (varsayım ≈ 1.600 token); ilk gerçek yüklemeden sonra `usage` ile doğrulanmalı.

**Açık / dikkat:**
- Gerçek Midas ekranında çıkarma doğruluğu (fiyat, saat dilimi, C/P, alış/satış) canlı test edilmedi; en büyük risk bu.
- Uygulama tarafı Expo Go'da (`expo-image-picker` mevcut) denenmedi; 40 görüntü belleği ~10–30 MB.
- Eski tek görüntü tablosu `coach_trades` artık yazılmıyor (30 gün sonra temizlenir); yeni tablolar: `coach_shots`, `coach_fills`, `coach_reports`.
- Commit öneki `[grok]` (istek üzerine), ajan notu Claude. Yayın (Expo) yok, push yok.

## 2026-11-14 — Claude — [grok] Koç canlı doğrulama: Caddy 413 düzeltildi, tam rapor üretildi (TASKS #37)

**Sonuç:** koçluk artık kesilmiyor; tam rapor (Başlık · Ne oldu · Çıkış · Giriş · Strike · Kaçan fırsat · Bir dahakine · Karne) doğrulandı, uyarı yok.

**Bulgular:**
1. **Koç uygulamadan çalışmıyordu (kök neden, kesilme değil):** `server/Caddyfile` tüm siteye `request_body max_size 8KB` koymuştu. Görüntü içeren
   `POST /coach` (≈ 28 KB+) Caddy'de **413** alıyordu; uygulama hiç sunucuya ulaşamazdı. Canlı denemeler 127.0.0.1:8787'ye doğrudan yapılmıştı, bu yüzden fark edilmemişti.
   Düzeltme: `/coach*` yolu için **7 MB**, diğer her uç için **8 KB** (`handle` blokları). Droplet'te `caddy validate` geçti.
2. **Kesilme (önceki iki deneme, max_tokens 2000/3500):** bu oturumun deneyinde, yani "tam öğe sayısı" talimatı ve 3500 sınırı ile koçluk çağrısı
   yeniden kesilmedi (çıktı 2054 ve 1266 token, `stop=end_turn`). Tek örnekle kesin kök neden kanıtlanmadı; prompt'a dokunulmadı (kanıt yoksa değiştirilmedi).
   Yeniden kesilme olursa uyarı metnine ve logda `stop=` alanına bakılacak.

**Ne:**
- `server/Caddyfile`: yola göre gövde sınırı (yukarıda).
- `server/app/coach.ts`: her Anthropic çağrısının logu `stop=<stop_reason>` alanını yazar (kesilme teşhisi için).
- `server/app/selftest.ts`: log satırında `stop=` olduğunu sınayan 1 test.

**Canlı testler (sentetik Midas PNG, QQQ 600C, 2026-11-13 18:05 → 18:32 İst; hepsi 127.0.0.1 değil, 2. testte HTTPS):**
| # | Yol | Sonuç | Çıkarma (in/out) | Koçluk (in/out) | stop |
|---|---|---|---|---|---|
| 1 | 127.0.0.1:8787 (önceki kod, max 3500) | 200, uyarı yok | 1235 / 505 | 4438 / 2054 | (log yok; çıktı < sınır) |
| 2 | HTTPS (düzeltilmiş Caddy + yeni log) | 200, uyarı yok | 1235 / 412 | 4438 / 1266 | end_turn / end_turn |

Ayrıca ücretsiz kontrol (ücret yok): HTTPS'e 28 KB gövde + `image/gif` → önceden 413, şimdi **400** "Yalnız PNG veya JPEG" (uygulamaya ulaşıyor).
Ücretli çağrı sayısı: **2** (sınır 2). Toplam token: 1. çağrı 5673 in / 2559 out; 2. çağrı 5673 in / 1678 out.

**Doğrulama:** `npm run check` yeşil (exit 0). `deploy.sh` çalıştı; `optioncalc-flow` ve `caddy` active; `/health` 200.

**Rapor (2. test, uygulamanın göstereceği biçim; sayılar kodda):**
> **Başlık:** QQQ 600 C · 0 DTE · giriş 1,85 · çıkış — (açık) · adet 2 · brüt/net P/L yok (çıkış yok)
> **Ne oldu:** Giriş öncesi 15 dk referans 682,14; girişte 679,73. Giriş 18:05, 16:30–20:00 penceresi içinde, VWAP'a −%0,75.
> Tutma aralığı (en yüksek/en düşük) ve çıkış sonrası hareket: henüz hesaplanmadı (pozisyon açık).
> **Çıkış: ❔ Belirsiz** — Pozisyon açık, çıkış fiyatı yok. Stop 0,61, hedef 8,05 kurala göre takip edilmeli.
> **Giriş: ✅ İyi** — Pencere içinde, VWAP'a yakın (−0,751). Kovalama belirtisi yok.
> **Strike: ⚠️ Uzak** — OTM %11,73; otmPerEm 4,56 (kural ≈ 0,5 çok üzerinde).
> **Kaçan fırsat (tahmini):** pozisyon açık; hesaplanamadı.
> **Bir dahakine:**
> 1. Stop seviyesini (0,61) girişten hemen sonra broker ekranında kaydet.
> 2. Strike'ı beklenen hareketin yarısına yaklaştırarak OTM mesafesini hesapla.
> 3. Çıkış kararını önceden yaz: stop, hedef ve ters dönüş koşulları.
> **Karne (/10):** disiplin çıkış 5 · giriş zamanlaması 8 · strike 3
> Veri eksik: duvar anlık görüntüsü; akış olayları.

**Açık / dikkat:**
- **Çıkarma çıkış fiyatını okumadı:** sentetik görüntüde "Çıkış $ 2.40" var ama model `exitPrice: null`, `status: acik` döndü. Rapor bu yüzden "açık" yazdı. Gerçek Midas ekranında doğrulanmalı; gerekirse çıkarma prompt'u/örnek ekran güncellenir (ayrı görev, ücretli test gerekir).
- Koç görüntü yüklemesi uygulamada hâlâ **dev build** gerektirir (`expo-image-picker` — #37 engeli 2).
- Prompt değişmedi; tek başarılı çalıştırmadan "kesilme düzeldi" kesin kanıt sayılmaz. Uzun çıktı tekrarlanırsa `stop=max_tokens` logu görülecek.

## 2026-11-14 — Claude — [grok] Koç: çoklu görsel seçici (expo-image-picker) (TASKS #37)

- **Ne:** `expo-image-picker` kuruldu (`~58.0.10`, SDK 58 `bundledNativeModules` ile aynı). `src/ui/coachPicker.ts`: izin → çoklu seçim (en çok 5, JPEG base64, quality 0.7) → `checkImage` ile 4 MB + sihirli bayt denetimi; native modül yoksa Türkçe mesaj (çökme yok, dinamik import). Koç ekranı: görüntüleri sırayla `POST /coach` ile yükler, ilerleme (`n/N`), görüntü başına hata, atlananlar ve özet.
- **Dosyalar:** `src/ui/coachPicker.ts`, `src/screens/Koc.tsx`, `app.json` (expo-image-picker plugin, `photosPermission` Türkçe; runtimeVersion/version/buildNumber değişmedi), `package.json` + `package-lock.json`, `docs/TASKS.md` (#37 engel satırı).
- **Doğrulama:** `npm run check` yeşil (exit 0). Canlı yükleme henüz Expo Go'da denenmedi.
- **Açık / dikkat:** (1) Koç'un canlı testi için `ANTHROPIC_API_KEY` droplet'te olmalı (önceki engel). (2) `base64` alanı JPEG olarak alınır (expo-image-picker belgesi); PNG ekran görüntüsü de JPEG'e dönüşür. (3) `expo-image-manipulator` eklenmedi; boyut yalnız quality ile kontrol edilir, büyükse görüntü atlanır ve belirtilir. (4) Expo Go'nun bu modülü gerçekten içerdiği cihazda doğrulanmalı.

## 2026-11-14 — Claude — [grok] Koç raporu biçimi: sayılar kodda, yorum modelde (TASKS #37, devam)

Kaan onaylı rapor biçimi: Başlık · Ne oldu · Çıkış ✅/⚠️/❌ · Giriş · Strike · Kaçan fırsat (tahmini) · Bir dahakine (3 madde) · Karne (3 × /10).

**Ne:**
- Model yalnız yorum/karar üretir (`ModelFeedback`); sayılar (brüt/net P/L, DTE, pencere, VWAP uzaklığı, OTM / beklenen hareket oranı, tutma ve çıkış sonrası hareket, opsiyon tahmini) kodda hesaplanır.
- **Net P/L:** komisyon $1,50 / kontrat / yön → giriş + çıkış = $3,00 / kontrat; `pnlOf` (`src/lib/coach/report.ts`).
- **Opsiyon tahmini:** Black-Scholes (IV %45, r %4) kalibre: gerçek giriş primi + (BS(S_ext) − BS(S_giriş)). Etiket "tahmini".
- Emoji ve pencere/DTE kodda; model emoji yazmaz.
- Uygulama: `src/ui/CoachReport.tsx` (rapor kartı), `src/screens/Koc.tsx` güncel.
- Sunucu: rapor kaydı ve yanıt `trades[].report`; karne girdisi rapor özeti.
- Testler: `test/coach.test.ts` (P/L, BS yönü, rapor emoji/pencere/3 madde, şema doğrulama); sunucu selftest yeni şema ile.

**Canlı denemeler (Haiku, sentetik fiş, 2026-11-13 QQQ 600C, 18:05 → 18:32 İst):**
1. Eski sürüm: fiş vade/saat dilimi içermiyordu → çıkarma 422 (ilk deneme; çıkarma çağrısı yapıldı).
2. Yeni prompt, `max_tokens` 2000: çıkarma OK (in 1182 / out 278); koçluk **2000'de kesildi** → JSON yok.
3. `max_tokens` 3500: koçluk yine 3500'de kesildi (in 4586 / out 3500), JSON ayrıştırılamadı → **rapor üretilemedi**.
- Tahmin: model feedback dizisini tekrar edip/ uzatıyor olabilir. Önlem: kullanıcı mesajına tam öğe sayısı ve "tekrar ekleme" kuralı + durma nedeni ve çıktı örneği logu. Bu önlemle canlı tekrar **yapılmadı** (kullanıcı tek test istemişti).
- Toplam token (üç denemenin çağrıları): çıkarma 1182+1182 in / 278+725 out; koçluk 4586+4586 in / 2000+3500 out (kesilmiş).

**Açık:** canlı tek bir başarılı raporu görmek için bir kez daha çağrı gerekiyor (≈ 6 k girdi + ≈ 3 k çıktı token). Onay bekleniyor.


## 2026-11-14 — Claude — [grok] Koç (işlem koçu): Haiku ile Midas görüntüsü → geri bildirim + günlük karne (TASKS #37)

Commit öneki kullanıcı isteğiyle `[grok]`; işi yapan Claude. **Durum: kod tamam, canlı Haiku testi YAPILMADI (anahtar yok).**

**Ne:**
- **Sunucu** (`server/app/coach.ts`): `POST /coach` (base64 PNG/JPEG, çözülmüş ≤ 4 MB, 20/gün, 10 sn arası), `GET /coach?day=`, `POST /coach/karne?day=`. Akış: Haiku #1 işlem çıkarma (JSON) → bağlam (Yahoo 1 dk, VWAP, 5 dk mumlar, çıkış sonrası hareket, hacim patlaması, duvar anlık görüntüsü, akış olayları) → Haiku #2 görüntü + bağlam ile koçluk → SQLite. Karne kapanıştan 20 dk sonra otomatik (`COACH_KARNE_AUTO`).
- **Saf mantık** (`src/lib/coach/`): `time` (İst 16:30–20:00, DTE), `rules` (stop %67, hedef 1:5 / 1:4), `bars` (Yahoo OHLCV, VWAP, çıkış sonrası, hacim), `context` (sınırlı bağlam, veri eksiği listesi), `prompt` (üç prompt, Türkçe, yalnız JSON), `validate` (JSON ayrıştırma, enum/uzunluk doğrulama), `image` (PNG/JPEG imza, 4 MB), `limits`, `anthropic` (gövde/yanıt), `client` (uygulama istemcisi).
- **Model:** `COACH_MODEL` (varsayılan `claude-haiku-5-5`). Yedek `COACH_FALLBACK_MODEL` yalnız tanımlıysa ve birincil reddedilirse; `KOÇ UYARI` logu ve `fallback=1`. Tanımsızsa açık hata, sessiz geçiş yok.
- **Anahtar:** `anthropic_key` systemd `LoadCredential` (dosya: `/etc/optioncalc-flow/anthropic_key`). Loglarda/yanıtlarda yok (selftest kanıtlar).
- **Token kaydı:** `coach_calls` (model, giriş/çıkış token, süre, hata, yedek), `coach_trades`, `coach_karne`; 30 gün.
- **Uygulama:** Menü'ye **Koç** kartı; `src/screens/Koc.tsx` (gün seçici, ekran görüntüsü yükleme, işlem kartları: kural ✓/✗/?, Ne yaptın / Doğru mu / Neden / Bir dahakine, karne). Görsel seçici yok (aşağıya bak).
- **Dosyalar:** `src/lib/coach/*.ts` (yeni), `src/ui/coachPicker.ts`, `src/screens/Koc.tsx`, `src/screens/Menu.tsx`, `server/app/{coach,config,store,http,main,selftest}.ts`, `server/optioncalc-flow.service`, `server/README.md`, `test/coach.test.ts` (yeni), `package.json` (test zinciri), `docs/{TASKS,CHANGELOG}.md`.

**Nasıl doğrulandı:**
- `npm run check` yeşil: `test/coach.test.ts` (alt testler: zaman/pencere, DTE, stop/hedef, mum analitiği, doğrulama, görüntü denetimi, hız sınırı, Anthropic gövdesi), typecheck, lint, bt:selftest, flow:selftest.
- Sunucu öz-testinde **sahte** Anthropic ve Yahoo ile uçtan uca koç: 2 çağrı, anahtar başlıkta, token toplamı SQLite'ta, karne kaydı, 429/400/404/503 yolları, yedek model (işaretli) ve yedeksiz model reddi (açık hata), anahtar yanıtta/logda yok. **Gerçek API çağrısı YAPILMADI.**
- Canlı test: aşağıda (dağıtım ve canlı test).

**Dağıtım ve canlı test (2026-11-13 gecesi, UTC):**
- `server/deploy.sh` ile dağıtıldı; `optioncalc-flow` **active**. İlk deneme **başarısız**: `anthropic_key` `LoadCredential` kaynağı yoktu → systemd servisi başlatmadı (`status=243/CREDENTIALS`), akış sunucusu ~2 dk düştü. Düzeltme: boş, root 600 yer tutucu (`deploy.sh` artık idempotent oluşturur; commit `[grok] infra: …`).
- Canlı uç nokta (droplet, localhost, sentetik 640×360 PNG — Midas benzeri fiş, metinsiz): anahtarsız → **401**; koç → **503** (anahtar yok, Haiku çağrılmadı, ücret 0); GIF → **400**; `GET /coach?day=2026-11-13` → **200**. Anahtar hiçbir yanıtta/logda yok. Haiku ile uçtan uca canlı test **yapılmadı** (anahtar yok) → token kullanımı: 0.

**Açık sorular / engeller:**
- **Anahtar:** yerel ortamda `ANTHROPIC_API_KEY` tanımlı değil → droplet'e kopyalanmadı. Kopyalama komutu `server/README.md` "Koç" bölümünde; ardından `systemctl restart optioncalc-flow`.
- **Görsel seçici:** `expo-image-picker` kurulu değil (native; OTA ile eklenemez). Ekran liste/geri bildirim/karne ile çalışır; yükleme düğmesi açıklama gösterir. Dev build ile `src/ui/coachPicker.ts` doldurulur.
- **Saat dilimi varsayımı:** Midas zamanlarını İstanbul saati kabul ediyoruz (model "ET ise +7/+8" dönüşümünü yapar). Gerçek ekranla doğrulanmalı.
- **Kural yorumu:** "kademe 50/40/30" ve "hacim-dönüş çıkışı" görüntüden ölçülemez → "bilinmiyor" / model yorumu. Pencere "16:30–20:00 İst" saat olarak uygulandı; kış saatinde bu aralık ET'de 08:30–12:00'dir (açılış 17:30 İst). Kaan'ın niyetini teyit et.
- Koçluk çıktısı "eğitim amaçlıdır"; tavsiye değildir (AGENTS.md).


## 2026-11-14 — Claude — [grok] Zamanlanmış piyasa raporları (sunucu + Menü › Raporlar) (TASKS #36)

Commit öneki kullanıcı isteğiyle `[grok]`; işi yapan Claude.

**Ne:**
- **Zamanlama** (`src/lib/reports/schedule.ts`): ABD açılış/kapanışına çapalı (ET, DST dâhil). Piyasa öncesi = açılış −30 dk; açılış +30 dk / +1,5 sa / +2,5 sa; gün sonu = kapanış +30 dk. Kış (EST): 17:00 / 18:00 / 19:00 / 20:00 İst; gün sonu 00:30 İst. Yaz (EDT): hepsi 1 saat erken, gün sonu 23:30 İst. Tatil: rapor yok. Erken kapanış (13:00 ET): 27 Kas, 24 Ara, 3 Tem kuralı; gün sonu kapanışa göre kayar. Sunucu yeniden başlarsa 45 dk'dan eski slotlar üretilmez.
- **Metin** (`src/lib/reports/text.ts`, saf, LLM yok): Asya/Avrupa/vadeliler/ön piyasa, haber, makro, bilanço, açılış eğilimi (vadeli %70 + Asya/Avrupa %30, eşik ±0,25); seans içi yön ve duvar kayması (açılış → şimdi); opsiyon birikimi (dV toplamı, prim); gün sonu SMA20/50/200 ve yarın beklentisi. Veri yoksa "veri alınamadı" yazar, rapor düşmez.
- **Sunucu:** `server/app/reporter.ts` (zamanlayıcı, toplama, kayıt, push), `server/app/sources.ts` (Yahoo chart seri 350 ms; Finnhub `X-Finnhub-Token` başlığıyla, 1,1 sn aralık), `server/app/store.ts` (`reports`, `snap` tabloları; 30 gün saklama), `server/app/poller.ts` (her taramada duvar anlık görüntüsü; gün başı "open"), `server/app/http.ts` (`GET /reports?limit=`, `GET /reports/<id>`), `server/app/push.ts` (`broadcast`), `server/app/config.ts` (Finnhub anahtarı, `REPORTS=off`), `server/optioncalc-flow.service` (`LoadCredential=finnhub_key`).
- **Duvarlar:** `src/lib/reports/walls.ts` — poller satırlarından analytics.ts (oiWalls, gex flip, maxPain). IV satırda yok; Γ için analytics varsayılanı 0,30 kullanılır.
- **MarketData:** rapor için EK kredi yok (duvarlar mevcut taramadan).
- **Uygulama:** Menü'ye "Raporlar" kartı (`src/screens/Raporlar.tsx`): liste (tür, İst saati, başlık), dokununca tam metin, aşağı çekerek yenileme. İstemci `src/lib/reports/client.ts` (anahtar yalnız başlıkta).
- **Kuru çalıştırma:** `node server/app/main.ts --report-dry-run <tür>` — sentetik fixture (`server/fixtures/reports-sample.json`), ağ/DB/push yok.
- **Dosyalar:** `src/lib/reports/{schedule,types,sources,text,walls,client}.ts`, `test/reports.test.ts` (yeni), `server/app/{reporter,sources}.ts` (yeni), `server/fixtures/reports-sample.json` (yeni), `server/app/{store,poller,http,push,config,main}.ts`, `server/optioncalc-flow.service`, `server/README.md`, `src/screens/{Raporlar,Menu}.tsx`, `package.json` (test zinciri), `docs/{TASKS,CHANGELOG}.md`.

**Nasıl doğrulandı:**
- `npm run check` yeşil (test incl. `test/reports.test.ts`; typecheck; lint; bt:selftest; flow:selftest).
- Zamanlama testleri: kış ve yaz haftaları (2026-03-16, DST uyumsuz hafta dâhil), Şükran/Noel tatili, erken kapanışlar, vakti gelmiş slotlar ve grace.
- Metin: sentetik fixture ile üç rapor türü; veri yokken düşmeme.
- Sunucu kuru çalıştırma çıktısı deploy raporunda.

**Açık sorular / sınırlar:**
- Erken kapanış tablosu kural tabanlı (27 Kas, 24 Ara, 3 Tem); NYSE takvimiyle yıllık doğrulanmalı.
- Gün sonu kaymasına karar: çapa "kapanış +30 dk" (yaz 23:30 İst, kış 00:30 İst). Kaan "23.30" dediği için yazda tutuyor; kışın 00:30 olur.
- Yahoo ve Finnhub kaynakları resmi değil; hız sınırı/engelleme olursa "veri alınamadı" ile düşer.
- Duvar anlık görüntüsü tarayıcı açıkken alınır; tarayıcı kapalıysa intra raporlar bunu belirtir.
- Pazartesi 16.11'e kadar hafta sonu olduğu için ilk gerçek rapor 16.11 17:00 İst'te beklenir.

## 2026-11-14 — Claude — [grok] Sonuç kartı (0DTE + Fırsat) ve Fırsat dayanak gecikmesi düzeltmesi (TASKS #34, #35)

Commit öneki kullanıcı isteğiyle `[grok]`; işi yapan Claude.

**Ne:**
- **Sonuç kartı** (`src/ui/VerdictCard.tsx`): 0DTE'de her ticker kartının üstünde, Fırsat'ta "Sonuç" bölümünde (Açık pozisyonun üstünde). Mevcut ayrıntı kontrolleri yerinde duruyor.
  - Yön: CALL al / PUT al / Bekle. Puanlama 7 kriter (her biri −1/0/+1): VWAP, açılış aralığı kırılımı, gamma flip, yakın duvar (EM×0,35), put/call oranı, sıra dışı hacim, momentum. |toplam| ≥ 3 → yön; güç = min(5, |toplam|).
  - Vade: 16:30–20:00 İst. penceresinde 0DTE varsa o; yoksa 0–3 DTE içinde en yakın.
  - Strike: OTM, hedef = S ± k×EM (`autoK`, oynaklığa göre; 0DTE için k başlangıç değeri 0,5 — geçmiş yetersiz), spread ≤ %15, hacim ≥ 50 veya OI ≥ 100, hedefe en yakın.
  - Prim: giriş = mid; stop = giriş × 0,33 (%67 prim stopu); hedef 1:5 = giriş + 5 × (giriş − stop); yedek 1:4 da gösterilir. Komisyon (1,50 $/kontrat) hariç.
  - Kademe: Fırsat'ta %50/%40/%30 kademe ve hesap bütçesinden adet (`sizePosition`); 0DTE'de yalnız oran.
  - Gerekçe: "CALL, güçlü (4/5): VWAP üstünde, gamma flip üstünde, düşük put/call (0,50); giriş 1,20 stop 0,40 hedef 5,20" biçimi.
  - Not: "Kâğıt üstü · tavsiye değildir."
- **Saf mantık** `src/lib/signals/verdict.ts` (kriterler, puanlama, vade, strike, seviyeler, gerekçe) ve `src/lib/signals/spot.ts` (dayanak fiyatı seçimi).
- **Fırsat gecikmesi — kök neden:** `signalScan.ts` fiyatı `loadSymbol(t, 'auto', {})` ile alıyordu. Anahtar olmadığı için sıra CBOE → Yahoo. CBOE uç noktası `delayed_quotes` (kaynak `delayedMin: 15`), yani fiyat 15 dk geride. Tarama aralığı (1/2/5 dk) ve 60 sn `SCAN_TTL` önbelleği de üstüne biniyordu.
- **Düzeltme:** dayanak = taze 1 dk barının kapanışı (en fazla 5 dk yaşlı); yoksa kotasyon ve kendi gecikme etiketi. Değişim yüzdesi bar fiyatına göre `prevClose`'dan hesaplanır. Kaynak etiketi "1 dk bar (N sn önce)" olarak gösterilir.
- **Dosyalar:** `src/lib/signals/verdict.ts`, `src/lib/signals/spot.ts`, `src/ui/VerdictCard.tsx`, `src/lib/odte/scan.ts` (verdict + `verdictInputsOf`, `ODTE_OTM_RULE`), `src/ui/signalScan.ts` (spot + verdict), `src/ui/firsatStore.ts` (`verdict` alanı), `src/screens/Odte.tsx`, `src/screens/Firsat.tsx`, `test/verdict.test.ts` (yeni; `package.json` test zinciri), `docs/{TASKS,CHANGELOG}.md`.

**Nasıl doğrulandı:**
- `npm run check` yeşil (test incl. `test/verdict.test.ts`: 42 kontrol; typecheck; lint; bt:selftest; flow:selftest).
- Örnek gerekçe ve 1:5 / 1:4 seviyeleri birim testte doğrulandı (giriş 1,20 → stop 0,40, 1:5 5,20, 1:4 4,40; kontrat riski 80 $).
- Ağ çağrısı YOK. Ekranlar Expo Go'da görsel olarak test edilmedi.

**Açık sorular / sınırlar:**
- Vade kuralı: pencere dışında da en yakın vade (0DTE dâhil) seçiliyor; pencere yalnız 0DTE varlığında fark yaratıyor. Pencere dışında 1–3 DTE tercih edilsin mi? Kaan kararı.
- 0DTE tarafında vade listesi tek vade (tarayıcının seçtiği). Fırsat tarafında gerekirse aynı zincir önbelleğinden ek vade çekilir (CBOE zinciri tek istekte gelir).
- **Kalan gecikme kaynakları:** 0DTE zinciri hâlâ CBOE (15 dk gecikmeli) — yalnızca fiyat değil opsiyon prim/OI/hacim de gecikmeli olabilir. Bu, 0DTE ekranındaki "~15 dk gecikmeli" uyarısıyla tutarlı. Gerçek zamanlı zincir için MarketData (sunucu proxy'si, kredi bütçesi) gerekir (TASKS #15/#16).
- Fırsat dayanak barı Yahoo 1 dk barı: ~1 dk gecikme. Bar yoksa (ör. tatil/ağ) kotasyona düşülür ve etiket gecikmeyi gösterir.
- Taramayı ekran açılınca tetikleme (refresh on focus) yapılmadı; `index.tsx` zamanlayıcısı ayarlanan aralıkta (varsayılan 2 dk) çalışıyor.

## 2026-11-14 — Grok — [grok] Radar: hisse detay grafiği (OI / hacim × strike, duvarlar, gamma flip, max pain) (TASKS #33)

Kaan'ın talebi: Radar'da hisseye dokununca görsel grafik. Yeni bağımlılık yok (react-native-svg 15.16.0 zaten var).

**Ne:**
- **Radar:** “Piyasa nabzı” satırları ve “Hisse grafiği” çipleri (ayarlardaki izleme listesi) dokunulabilir → detay ekranı; “‹ Radar” ile dönüş.
- **Detay** (`src/screens/RadarDetail.tsx`): tek zincir isteği, en yakın vade (`expirations`: Cuma/aylık; günlük 0DTE listesi yok). Sunucu anahtarı varsa MarketData (proxy, `mdMode: cached`, 1 kredi); yoksa CBOE. Yükleniyor / hata (Türkçe) / ⟳ tekrar. Üstte spot, vade (gün), Call/Put OI, P/C.
- **Grafik** (`src/ui/OiChart.tsx`, react-native-svg): strike başına çubuklar; call yukarı (yeşil), put aşağı (kırmızı). Metrik: Açık pozisyon / Hacim. Çizgiler: spot (beyaz), Call duvarı, Put duvarı (kesikli yeşil/kırmızı), Gamma flip (sarı), Max pain (mavi). Aralık dışı değer legend'da “(aralık dışı)” ile yazılır.
- **Saf mantık** `src/lib/radar/detail.ts`: `strikeRows` (calls+puts birleşimi), `windowRows` (spot ±%15, en fazla 200 → spot'a en yakın), `bucketRows` (en fazla 40 çubuk, kovalama), `metricMax`, `markers` (analytics: `oiWalls`, `gex` flip, `maxPain`), `nearestExpiry`, `inRange`.
- **Dosyalar:** `src/lib/radar/detail.ts`, `src/ui/OiChart.tsx`, `src/screens/RadarDetail.tsx`, `src/screens/Radar.tsx`, `test/radar-detail.test.ts`, `package.json` (test zinciri), `docs/{TASKS,CHANGELOG}.md`.

**Nasıl doğrulandı:**
- `npm run check` yeşil (test incl. yeni `test/radar-detail.test.ts`, typecheck, lint, bt:selftest, flow:selftest).
- Birim testler: birleştirme, pencere, kovalama (toplam korunur), ölçek, duvar/max pain/spot işaretleri, boş zincir, vade seçimi (açık/kapalı seans).
- Ağ/MarketData çağrısı YOK; ekran Expo Go'da görsel olarak test edilmedi.

**Açık sorular / notlar:**
- Vade: `expirations()` Cuma ve aylık vadeleri listeler; SPY/QQQ gibi günlük 0DTE vadeleri bu listede yok. İstenirse ayrı bir vade seçici (her seçim = 1 istek).
- Strike penceresi ±%15 sabit; ETF'ler için daha dar istenirse `WINDOW_PCT`.
- Gamma flip yaklaşık (analytics.ts varsayımları); “Yatırım tavsiyesi değildir” notu ekranda.
- Commit öneki kullanıcı isteğiyle `[grok]`.
## 2026-11-14 — Grok — [grok] Takip listesi + Menü sekmesi (TASKS #32)

Kaan'ın talebi: Hesapla'da kurulan opsiyonu takip listesine ekle, ekleme gününden beri K/Z'yi gör. "Geçmiş" sekmesi "Menü" oldu; Menü kartları: Geçmiş (mevcut Journal) ve Takip Listesi.

**Ne:**
- **Hesapla:** "★ Takip listesine ekle" (opsiyon bacakları). Kayıt: sembol, vade, strike, C/P, adet, ekleme primi (zincir mid / girilen / teorik), ekleme anı (ISO), hisse fiyatı. Aynı kontrat+yön tekrar eklenmez (yineleme sayısı bildirilir); vadesi dolmuş kontrat eklenmez.
- **Takip Listesi** (Menü kartı): her kalem için canlı prim, K/Z $ ve %, giriş/şimdi prim, hisse ekleme→şimdi, adet, vade (kalan gün), eklenme (İstanbul saati, kaç gün önce), toplam K/Z. Takipten çıkar (onaylı).
- **Yenileme:** ekran açılınca (60 sn'den eskiyse), ⟳ / çekip yenile, ve 60 sn'de bir YALNIZ seans açıkken + uygulama öndeyken. Sembol+vade başına **tek** zincir isteği (cached mod, 1 kredi); vadesi dolanlara istek yok, son bilinen fiyat gösterilir. Veri katmanı mevcut `MD.loadChain` (sunucu proxy'si); yeni doğrudan MarketData yolu YOK, yeni native bağımlılık YOK.
- **Menü:** `src/screens/Menu.tsx` kart kaydı (`CARDS` + `SCREENS`); alt ekranlardan "‹ Menü" ile dönüş. 0DTE'den Geçmiş'e geçiş artık Menü › Geçmiş'i açar.
- **Saf mantık** `src/lib/watchlist/`: `model.ts` (kalem, OCC sembolü, vade durumu, İstanbul damgası, yineleme anahtarı, ekleme), `pl.ts` (K/Z: long (şimdi−giriş)×adet×100, short işaret ters), `refresh.ts` (sembol+vade gruplu yenileme eşlemesi), `build.ts` (Hesapla bacakları → kalem), `view.ts` (satır görünümü, toplam).
- **Depo** `src/ui/watchStore.ts` (AsyncStorage `watchlist-v1`).
- **Dosyalar:** `src/lib/watchlist/*`, `src/ui/watchStore.ts`, `src/screens/{Menu,Watchlist,Calc}.tsx`, `src/app/index.tsx`, `test/watchlist.test.ts`, `package.json` (test zinciri), `docs/{TASKS,CHANGELOG}.md`.

**Nasıl doğrulandı:**
- `npm test` (yeni `test/watchlist.test.ts`: OCC, K/Z long/short, vade/İstanbul saati, ekleme/yineleme, sahte zincirle yenileme (tek istek, vadesi dolan atlanır, 0 fiyat korunur, hata korunur), bacak→kalem, satır/toplam), `npm run typecheck`, `npx expo lint` — yeşil.
- MarketData/ağ çağrısı YOK; ekran yalnız kod okuma ile doğrulandı (görsel Expo testi yapılmadı).

**Açık sorular / notlar:**
- Zincir isteği `strikeLimit=80` ile; çok uzak strike gerekirse artırılır (cached modda kredi etkilenmez).
- Sağlayıcı: sunucu anahtarı varsa MarketData (cached), yoksa CBOE. Tradier/Yahoo kullanılmıyor.
- Görsel test (Menü kartları, K/Z satırları) Expo Go'da yapılmalı. Yayın yok.
- Commit öneki kullanıcı isteğiyle `[grok]`; TASKS sahibi (Claude) ile çelişebilir — Kaan'a not.

## 2026-11-14 — Grok — [grok] FLOW: Akış son 3 işlem gününü gösterir (gün başlıklı liste, saklama 5 işlem günü)

Kaan'ın talebi: “olağandışı akışta geçmiş 3 günde görünsün”. Yalnız bugün değil, son 3 **işlem** günü (hafta sonu ve NYSE tatilleri atlanır).

**Ne:**
- **Sunucu** `GET /flow?days=N` — varsayılan 3, 1..5 aralığına sıkıştırılır (geçersiz → 3). Sorgu `day >= fromDay` ile yapılır. Yanıta `days`, `fromDay`, `tradingDays` eklendi (eski alanlar aynen).
- **Saklama:** `Store.prune` olayları artık takvim günü yerine son **5 işlem günü** için tutar (eskiden 14 takvim günü). Taban/kredi/push sayaçları eskisi gibi 14 gün.
- **Uygulama:** Akış listesi günlere göre gruplanır: başlık “Bugün”, “Dün” (önceki işlem günü), diğerleri “Cuma, 13 Kasım” (yıl farklıysa sonuna eklenir). Kart saatleri İstanbul `SS:DD`. Üstte “Son 3 işlem günü (YYYY-MM-DD →)” bilgisi. İstek: `days=3`, `limit=500`.
- **Saf mantık** `src/lib/flow/days.ts`: `clampFlowDays`, `tradingDaysEndingAt` / `tradingDaysBack` / `oldestTradingDay` (usmarket `isTradingDay`/`prevTradingDay`), `dayHeaderLabel`, `groupByDay`. `model.ts`: `fmtIstTime`. `proxy.ts`: `flowEventsUrl` `days` parametresi. `client.ts`: `fetchFlow` `days`.
- **Dosyalar:** `src/lib/flow/{days,model,proxy,client}.ts`, `src/screens/Akis.tsx`, `server/app/{http,store,selftest}.ts`, `server/README.md`, `test/flow.test.ts`.

**Nasıl doğrulandı:**
- `npm run check` (test, typecheck, lint, bt:selftest, flow:selftest) — yeşil.
- Yeni testler: pencere (Pazartesi, Cumartesi, Şükran 26 Kas tatili, Kutsal Cuma 2027-03-26, ET Pazar gecesi, 5 gün), başlıklar (Bugün/Dün/haftanın günü/yıl), gruplama sırası, `fmtIstTime`, `days` URL'si; sunucu: `fromDay` sorgusu ve 5 işlem günü saklama.
- **Deploy (2026-11-14):** `server/deploy.sh` → `systemctl is-active optioncalc-flow` = active; `/flow?days=3` anahtarlı 200 (`days`, `fromDay`, `tradingDays` dönüyor), anahtarsız 401. Kodda `days.ts` ve `fromDay` sunucuda doğrulandı. MarketData çağrısı YOK (kutu ve sunucu tarafında; yalnız HTTP/sağlık kontrolü).

**Açık sorular / notlar:**
- “Dün” = bugünden önceki son işlem günü (Pazartesi'de Cuma). Takvim dünü değil; farklı istenirse `dayHeaderLabel` tek satır.
- Sunucu tarafında yeni kod `FLOW_DAYS` gibi bir env gerektirmiyor. MarketData çağrısı YOK (yalnız yerel DB sorgusu ve test); kutu MarketData'ya çağrı yapmadı.
- Push (Expo) ve tarama davranışı değişmedi.

## 2026-11-14 — Grok — [grok] FLOW: akış sunucusu, MarketData proxy'si, Akış sekmesi, Expo push (TASKS #31)

Kaan'ın talebiyle (`docs/tasks/FLOW.md`). Commit'ler: `95f2b71` (sunucu + saf akış mantığı), `6c56073` (uygulama), docs commit'i bu girdinin commit'i.

**Ne:**
- **Sunucu** `server/` — DigitalOcean `optioncalc-flow` (162.243.88.42, Ubuntu 24.04): Node 24 LTS, `node:sqlite`, sıfır npm bağımlılığı, systemd `optioncalc-flow` (kullanıcı `ocflow`), Caddy HTTPS (`https://162-243-88-42.sslip.io`), ufw yalnız 22/80/443. Port 80 yalnız 308 yönlendirme.
- **Tek MarketData istemcisi:** sunucu. Token yalnız `/etc/optioncalc-flow/md_token` (root 600, systemd `LoadCredential`); kod ortam değişkeninden token OKUMAZ. Aynı anda tek istek kuyruğu.
- **Proxy:** `/api/md/...` yalnız dört yol (hisse kotu, vade listesi, zincir cached/live, 1 dk mum); diğerleri 403. Uygulama anahtarı `x-app-key`, sunucuda `openssl rand` ile üretildi, root 600 dosyada; sabit zamanlı karşılaştırma; dakikada 120 istek; 20 sn önbellek.
- **Akış tarayıcısı:** piyasa saatlerinde 2 dk; ticker başına TEK cached istek (`dte` listesi: 0DTE + 3 ay Cuma, tatil Cuması → Perşembe); dV ile aday; en yüksek 6 aday canlı teyit (`options/quotes`); teyitsizler kayıtlı ama push'suz; kontrat başına 15 dk soğuma; push: yalnız teyitli + dar spread + ≥100k$ prim, günde en çok 30.
- **Kredi:** günlük akış tavanı 10k, toplam tavan 40k, MarketData kalan kredisi 5k altına inerse durur. Tahmin: önbellekli 1 365 + teyit tavanı 1 170 ≈ **≤ 2 535/gün** (2 dk, 7 ticker). Sayaç SQLite'ta, `/health` ve `/status`'ta.
- **Uygulama:** Akış sekmesi (Türkçe; kontrat, call/put, hacim Δ, prim, orta fiyat, OI, hacim/OI, İstanbul saati, teyit/geniş-spread rozetleri, yenile + dakikada bir). MarketData çağrıları artık sunucudan; anahtar “Hesapla › Ayarlar › Akış sunucusu anahtarı”. Eski kayıtlı MarketData tokenı yükleme sırasında silinir. `EXPO_PUBLIC_FLOW_API_KEY` isteğe bağlı yedek. Push kaydı `src/ui/flowPush.ts` (mevcut izin akışı, `expo-notifications` zaten bağımlılık; native ekleme YOK).
- **Test:** `test/flow.test.ts` (vade seçimi incl. Kutsal Cuma → Perşembe ve 25 Aralık → 24 Aralık, tespit eşikleri, baseline, kredi tahmini, proxy izin listesi, URL, biçim, sütun → satır). `server/app/selftest.ts` (sentetik fixture uçtan uca, anahtar, hız sınırı, Expo push sahte fetch, bütçe freni). `npm run check`'e `flow:selftest` eklendi; `server/` tsc ve eslint'ten dışlandı.

**Dosyalar:** `server/**`, `src/lib/flow/**`, `src/lib/market/marketdata.ts`, `src/lib/state.ts`, `src/lib/freshness.ts` (sağlayıcı adı), `src/screens/{Akis,Calc,Odte}.tsx`, `src/ui/{flowPush,monitor}.ts`, `src/app/index.tsx`, `test/flow.test.ts`, `package.json`, `tsconfig.json`, `eslint.config.js`.

**Nasıl doğrulandı:**
- `npm run check` yeşil (testler 929+ OK, tsc, lint, bt:selftest, flow:selftest).
- Droplet: `systemctl is-active` = active; `127.0.0.1:8787` dinleniyor; HTTPS sertifikası Let's Encrypt; `/health` 200; anahtarsız `/flow` ve `/api/md/…` 401; port 80 → 308.
- Dry-run (ağ yok): `npm run flow:dry` ve sunucuda `--dry-run --fixture` aynı sonucu verdi; sunucu `selftest` geçti.
- Anahtarlı uçtan uca (sunucudan; droplet'in toplam MarketData kullanımı 4 kredi): `stocks/quotes/SPY` → 203, `consumed=1`. `options/chain/QQQ` (`dte` listesi, cached) → 203, `consumed=1`, 4 880 satır, 802 KB, tüm alanlar. Bu yanıtla vade kontrolü: 10/14 planlanan Cuma listeli (4'ü QQQ'da yok, doğal).
- `options/quotes` (teyit): tek kontrat, sunucudan doğrudan 1 kredi, 203, sütun biçimli, aynı alanlar.
- Push kaydı: sahte token `POST /push/register` → 200; geçersiz biçim → 400; `unregister` → 200; DB'de sayı 0 (silindi).
- Sızıntı taraması: `git grep` ve staged diff'te MarketData tokenı yok; anahtar hiçbir çıktıya/repoya girmedi.

**⚠ Kayıt — ben yaptım:** Geliştirme sırasında yerel bir sunucu testi, bu kutunun ortam değişkeninde bulunan MarketData tokenı ile **1 kredilik bir SPY kotasyonu** çağırdı (21:12 UTC). Hata: config’te ortam değişkeni yedeği vardı. Düzeltildi (artık yalnız dosya). Sonrasında droplet çağrıları bu pencereden 5+ dk sonra yapıldı (tek IP kuralı). Bu kutuda `MARKETDATA_TOKEN` ortam değişkeni hâlâ tanımlı; `backtest/` scriptleri bunu kullanır → sunucu çalışırken backtest çalıştırılmamalı.

**Açık / Kaan:**
1. **Uygulama anahtarını almak** (sohbete yazılmadı): `ssh -i ~/.ssh/do_flow root@162.243.88.42 'cat /etc/optioncalc-flow/app_key' | pbcopy` → Hesapla › Ayarlar › “Akış sunucusu anahtarı”. (Yerel kopya/okuma yok.)
2. **Yayın kararı:** uygulama değişikliği OTA ile gitmeli mi? Kaan isteyince `eas update` (bu görevde YAYINLANMADI). Uzak push için Expo Go’nun yetmeyebileceği not edildi; gerekirse dev build (native ekleme yok).
3. **Pazartesi 2026-11-16 09:30 ET:** ilk canlı tarama. `journalctl -u optioncalc-flow -f` ve `/status` ile izle; eşikler (25k$ olay, 100k$ push) ilk günlerde kalibre edilmeli.
4. `backtest/` scriptleri hâlâ MarketData'yı doğrudan çağırır (proxy dışı). Tek IP kuralı için sunucu çalışırken çalıştırılmamalı; istenirse proxy üzerinden yönlendirilir.
5. `docs/PLAN.md` / sinyal motoru: akış yalnız bilgi amaçlı; sinyal değil (“No proven edge”).

## 2026-11-13 — Claude — [claude] Veri tazelik göstergesi (TASKS #30)

**Ne:**
- **Saf çekirdek** `src/lib/freshness.ts`: üç kaynak — `md-options` (MarketData zincir/quote), `quotes` (hisse fiyatı / 1 dk bar; sağlayıcı kaydı: marketdata/yahoo/cboe/tradier), `news` (Radar: yahoo/sec/finnhub). Durumlar: kapalı (gri), hata (kırmızı), güncel (yeşil), gecikmeli (sarı), kullanılmıyor (dışlanır). Genel durum = en kötüsü. Tolerans = max(2 × aralık, 2 dk); haber için 15 dk.
- **Piyasa takvimi** `usmarket.ts`: yeni `sessionCloseMs` / `isSessionOpenNow` (erken kapanış 13:00 ET: Şükran ertesi, 3 Temmuz, 24 Aralık — yalnız işlem günüyse). `closeMs` / `marketOpen` / backtest DEĞİŞMEDİ.
- **Kapalı piyasa:** tüm kaynaklar gri (Radar haberleri de seans içinde çekildiği için). Son başarı ve son hata detayda görünür.
- **MarketData hisse verisi:** `quotes` + sağlayıcı `marketdata` → "gecikmeli (15 dk)" notu; sarı/kırmızı yalnız gerçek hatada ya da 15 dk payı da aşılınca.
- **Mesaj temizleme:** URL query atılır; Authorization / Bearer / token= / apikey= değerleri, kayıtlı ve ortam tokenları, 32+ karakterlik token benzeri dizgiler maskelenir; ≤ 160 karakter. Bildirimler asla fırlatmaz.
- **Bildirim noktaları:** `market/index.ts` `loadSymbol` (her sağlayıcı denemesi; MarketData bayat yanıtı = hata), `loadChain` (yalnız MarketData), `market/bars.ts` `loadBars` (Yahoo / MarketData), `news/index.ts` `NewsHub.poll` (kısmi başarı = güncel; tümü başarısız = hata).
- **Beklenen aralık:** sahip başına (`odte`, `firsat`, `radar`); etkin = en kısa aktif sahip. Tarama kapalıysa sahip kaldırılır.
- **UI:** `src/ui/freshnessStore.ts` (useSyncExternalStore, 20 sn'de bir yeniden hesap), `src/ui/FreshnessPill.tsx` (hap + RN Modal: kaynak, sağlayıcı, son başarı/hata İstanbul saatiyle, sonraki yenileme, renk açıklaması). Hap: 0DTE, Fırsat, Radar başlıkları.
- Yeni bağımlılık YOK. Token yazdırılmıyor; testler ağsız (fetch sahte).

**Dosyalar:** `src/lib/freshness.ts` (yeni), `src/ui/freshnessStore.ts` (yeni), `src/ui/FreshnessPill.tsx` (yeni), `test/freshness.test.ts` (yeni, npm test zincirinde), `src/lib/usmarket.ts` (ekleme), `src/lib/market/{index,bars}.ts`, `src/lib/news/index.ts`, `src/app/index.tsx`, `src/screens/{Odte,Firsat,Radar}.tsx`, `docs/TASKS.md`.

**Doğrulama:** `npm run check` geçti (testler, typecheck, lint, bt:selftest). Tazelik testi: durum geçişleri, hafta sonu / tatil / 13:05 ET erken kapanış, MD 15 dk notu, en kötü birleşim, mesaj temizleme (token, query, ≤160), reportFail'in fırlatmaması, sahte-401 ile loadSymbol bildirimleri ve token sızıntısı yok.

**Açık / Kaan'a sorular:**
- Görsel test yok: hap ve modal Expo Go'da henüz görülmedi (cihazda kontrol gerekli).
- MarketData hisse verisinde 15 dk payı aşılırsa sarı yapılıyor (yorum: "kırmızı/sarı yok" isteğinin yorumu). Yalnız "hiç yellow olmasın" istenirse tek satır değişir.
- Beklenen aralık sahipleri ekran başına; Odte ve Fırsat aynı `quotes` kaynağını farklı aralıkla tarar, etkin aralık en kısa olan olur.
- Yahoo fiyatlarının gecikmesi bilinmiyor → not düşülmedi (AGENTS: iddia etme).

## 2026-11-13 — Claude — [claude] QULLAMAGGIE: Q1/Q1S/Q2/Q3 setupları, Fırsat ayarları, çevrimdışı backtest (Kaan onayı yok)

**Ne:**
- **Etiket:** tüm Q kuralları "Qullamaggie uyarlaması — Kaan onayı yok". WEIGHTS değişmedi. Q setupları kâğıda uygun değil (`Q_PAPER_ELIGIBLE` boş); Q kartları görünür, Onayla yok.
- **Günlük bağlam** (`src/lib/signals/qull/daily.ts`): EMA, ATR%, RS21/63 (SPY), daralma, yakın tepe/dip, uzama, Q-kalite (bilgi amaçlı).
- **Setuplar** (`setups/q1-orh.ts`, `q2-ep.ts`, `q3-parabolik.ts`, `q-common.ts`): kırılım tetiği ızgara-bağımsız — OR dışındaki ilk kapanış son 5 dk içinde, hacim kırılım barında. İlk sürümdeki bar-bazlı kural (önceki bar içeride) kırılımların ~1/5'ini yakalıyordu; backtest'te Q1 neredeyse sinyal üretmiyordu. Düzeltildi, testli.
- **UI/ayar** (`src/screens/Firsat.tsx`, `src/ui/signalScan.ts`, `firsatStore.ts`): Q rozeti, Q-kalite satırı, Q1/Q1S/Q2 açık, Q3 kapalı; LOD/HOD ve 5 dk EMA10 çıkışları varsayılan kapalı (`src/lib/signals/qull/exits.ts`, paper `qExit`). Günlük Yahoo barları (1d, 6 ay, ticker başına günde bir kez, AsyncStorage). Firsat şema 3 (`migrateSettings` yalnız şema<2'de DURDU açar — `test/paper.test.ts` ile uyumlu).
- **Backtest:** `src/lib/odte/strategies/qull.ts` (qull-q1/q1s/q2/q3), `backtest/qull.mts`, `backtest/tables-common.mts` (firsat.mts ortak yardımcılarına geçti; duman koşusu çalıştı).
- **Rapor:** `docs/reports/qullamaggie-backtest.md`.

**Dosyalar:** `src/lib/signals/{qull/*,setups/*,types.ts,opp.ts}`, `src/lib/odte/strategies/{qull,index,types}.ts`, `src/lib/paper/{engine,account}.ts`, `src/lib/market/bars.ts`, `src/ui/{firsatStore,signalScan}.ts`, `src/screens/Firsat.tsx`, `backtest/{qull,tables-common,firsat,bt,engine}.mts`, `test/qull.test.ts` (npm test'e eklendi), `docs/{TASKS,reports/qullamaggie-backtest}.md`.

**Doğrulama:** `npm run check` geçti. Backtest çevrimdışı: `unset MARKETDATA_TOKEN; BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/qull.mts --n 60 --folds 5 --paths 10000` (76 sn). MarketData'ya bağlanılmadı.

**Sonuç:** hiçbir setup × ticker × grup kriteri geçmedi (hepsi YETERSİZ VERİ). OOS'taki 13 işlemin hepsi kayıp; Q1 OOS'ta hiç sinyal yok. Huni: yapısal günlük koşul (Q1) 1484 hisse-günün 28'inde. RS63 yüzünden 2026-02-04'e kadar Q1/Q1S yok (veri 2025-11-03'ten başlıyor).

**Açık / Kaan'a sorular:**
- Q-kalite skora katılsın mı; LOD/HOD ve EMA10 çıkışları backtest'e eklensin mi (şu an ölçülmüyor)?
- MU/INTC sinyal listesine eklensin mi? (Uygulama listesi değişmedi.)
- 2025-11 öncesi günlük D-mumu çekimi (RS63 erken hazır olsun) için MarketData onayı.
- Backtest'te Q3 (IS n=2, OOS n=2) ve MC yorumu: küçük havuzda MC bilgi vermiyor (rapor §Monte Carlo).

## 2026-11-13 — Claude — [claude] SINYAL-FIRSAT Aşama 6 tamamlandı (çevrimdışı backtest, D13)
**Ne:**
- **D13 (Kaan kararı, TASKS):** (1) 1:5 brüt ölçülür, komisyon hariç; komisyon yalnız P&L'de. (2) 4 kazanç → 1:2 modunda 2 kayıp → güvenli; güvenli modda 2 kayıp daha → o gün dur; mevcut davranış, `test/paper-path.test.ts` D13(2) testiyle doğrulandı. (3) NVDA bilanço: Finnhub anahtarı yalnız ortam değişkeni/uygulama ayarı; kodda ve çıktıda yok.
- **Walk-forward + replay + MC:** `backtest/firsat.mts` (5 kat, 60 parametre, 10 000 yol, $300, kademe 50/40/30, DURDU açık). Yol MC'si `src/lib/paper/path.ts` (gerçek OOS işlemleri, hedef başına ayrı sonuç, güvenli mod hedefi 1:2).
- **Sonuç:** `docs/reports/asama-6-backtest.md` (rapor), `docs/reports/asama-6-tablolar.md` (otomatik tablolar). Hiçbir hücre kriteri geçmedi; OOS ortalama R negatif; S4–S6 veri yok.
- **NVDA bilanço tarihleri:** `backtest/aux-earnings.mts` (tek seferlik çekim). Finnhub bu planda yalnız gelecek tarihi (2026-11-17) döndürdü; `backtest/aux/earnings-NVDA.json` `complete: false` → kapı NVDA'yı "bilinmiyor" sayıyor.
- **Hata düzeltmeleri:** zincir önbellek anahtarında son kullanım tarihi (E) yoktu; 0DTE zinciri 1–3 DTE koşusuna sızıyordu (`backtest/sources.mts`, `backtest/bt.mts`). 1–3 DTE sayıları düzeldi (OOS 137 → 143). Yol MC'sinde işlem dizisi kırpıldı (495 sn → 49 sn duman koşusu).
**Dosyalar:** `backtest/{firsat,aux-earnings}.mts` (yeni), `backtest/{engine,peers,sources,bt}.mts`, `package.json` (test betiğine paper-path), `src/lib/paper/path.ts` (yeni), `test/paper-path.test.ts` (yeni), `docs/reports/asama-6-*.md`, `docs/TASKS.md` (#26 done, D13), bu kayıt.
**Doğrulama:** MarketData'ya bağlanılmadı (`unset MARKETDATA_TOKEN`; firsat.mts token varsa çıkar). Tam koşu: `BT_OFFLINE=1 BT_START=2025-11-14 BT_END=2026-11-11 BT_FEE=1.5 node backtest/firsat.mts --n 60 --folds 5 --paths 10000` (88 sn). `npm test` (paper-path dâhil), typecheck çalıştırıldı.
**Açık / Kaan'a sorular:**
- Yarım kalan MC iflas tanımı: sermaye 1 kontratı alamayınca hesap durur ama "iflas" sayılmaz (spec: < %10). Kaan tanımı değiştirmek isterse söylesin.
- 1–3 DTE gece taşıma backtest'te modellenmedi (gün içi kapanış). Taşıma kazancı/gap riski ölçülmedi.
- S4 (duvar), S5 (haber), S6 (IV rank) için veri yok; test edilemedi.
- NVDA geçmiş bilanço tarihleri: Finnhub planı/başka kaynak gerekir (`complete: true` olmadan kapı açılmaz).
- Grok'a: `src/lib/paper/path.ts` ile `mc.ts` (sentetik sonuçlu MC) iki ayrı yol MC'si var; path.ts Aşama 6'da kullanılan, mc.ts karşılaştırma. Birleştirme isterseniz söyleyin.

## 2026-11-13 — Claude — [claude] Başkan incelemesi 6 (oc-review-6) düzeltmeleri: D12, DURDU, takvim, B7/B9

**Ne:**
- **Etiketler:** "Kaan onayı" diye işaretlenmiş K8/K9 kaldırıldı (kod yorumları, SINYAL-FIRSAT §6.1/§7.4/§11, TASKS D10 → GEÇERSİZ). Kaan'ın kararı D12 olarak kaydedildi.
- **1:N risk bazlı (B1, `rr.ts`, `opp.ts`):** hedef = giriş + N × risk (150/50 → risk 100 → 1:5 = 650, 1:4 = 550). RR = (model çıkış − giriş)/risk. Kart hedefi risk bazlı; `MODE_RULES` eşikleri (5/4/2/1,5) aynı.
- **MC (`mc.ts`):** birincil `RISK` (+5R, 650 $) + DURDU açık; K8 yalnız karşılaştırma etiketli; R650 kaldırıldı.
- **DURDU (B2–B5, `account.ts`, `types.ts`, `firsatStore.ts`):** varsayılan AÇIK. 2 kayıp → GUVENLI_ZARAR; güvenli moda girişten sonra `safeLossStreak` 2 → DURDU (kazanç sıfırlar, başabaş değiştirmez). Kaldırıldı (onaysız): gün içi %50 düşüş (B2), kademe 30'a inen tek kayıp (B4), 4 kayıp eşiği (B3). Kayıt şeması 2: eski kayıtlarda `durduEnabled` bir kere true (`migrateSettings`).
- **Takvim (B6, `src/lib/calendar/events.ts`, yeni):** gece taşıma yalnız `calendarCheck` temizse. FOMC 2026 karar günleri hafızadan yazıldı (**doğrulanmadı**); CPI/NFP tablosu boş → kapsam yok → taşıma yok. Bilanço: Finnhub (anahtar yoksa "bilinmiyor" → taşıma yok; ETF muaf). Kontrol yalnız 15:45 ET'de, dte≥1 için, gün başına bir kez sorgulanır.
- **Backtest (B7, `backtest/engine.mts`, `bt.mts`, `sources.mts`):** komisyon 1,50; gün sonu 15:45 ET; `RunOpts.kaan` ile prim stopu %67 (giriş×0,33) ve prim hedefi (giriş + N×risk). `maxHoldMin` firsat'tan kaldırıldı.
- **Strike (B9, `firsat.ts`):** varsayılan `otmMode: 'oto'` → S ± k×EM0 (QQQ sabit 0,45; NVDA/GLD/SLV oto). `delta` yalnız karşılaştırma. Oto k geçmişi (`DayInfo.ratios`) yalnız önceki günlerden (selftest ile sızıntı yok kontrolü).

**Dosyalar:** `src/lib/signals/rr.ts`, `opp.ts`, `riskwatch.ts`; `src/lib/paper/account.ts`, `types.ts`, `mc.ts`, `overnight.ts`, `engine.ts`; `src/lib/calendar/events.ts` (yeni); `src/lib/news/finnhub.ts`; `src/lib/odte/strategies/firsat.ts`, `types.ts`; `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`; `backtest/engine.mts`, `bt.mts`, `sources.mts`, `selftest.mts`; testler `test/setups`, `paper`, `mc`, `firsat`, `firsat-strategy`, `calendar` (yeni); `package.json` (calendar testi); `docs/TASKS.md` (D10, D12, #26), `docs/tasks/SINYAL-FIRSAT.md`.

**Doğrulama:** `npm run check` çıkış 0 (test, tsc, lint, bt:selftest). Yeni testler: 1:5 = 650, 1:4 = 550, DURDU sayaçları (K K → güvenli, K K ✓ K K → DURDU), tek kayıp kademe 30'da güvenli değil, takvim kapısı, oto k, prim stop/hedef ve 15:45 backtest kontrolleri.

**Yapılmadı / açık:**
- **Adım 9 (koşu) yapılmadı:** `/workspace/bt-data-QQQ-GLD-SLV-NVDA.zip` yok. MarketData'ya bağlanılmadı, ağdan veri çekilmedi. Adım 10 (MC OOS, moda göre hedef — B8) ve 11 (rapor) koşuya bağlı, yapılmadı.
- **B8 henüz yok:** MC hâlâ her işlemi tek N ile sayar (moda göre hedef seçimi yok). Adım 10'da.
- **Takvim:** CPI/NFP tarihleri girilene kadar gece taşıma hiç olmaz (güvenli taraf). FOMC tarihleri doğrulanmalı. NVDA bilançosu için Finnhub anahtarı gerekir (Radar ayarı).
- **Gece taşıma backtest'te modellenmiyor:** tüm pozisyonlar 15:45'te kapanır.
- **Dayanak hedef/stop hâlâ çıkış olarak duruyor** (prim kuralına ek). Prim hedefi önce gelirse o çıkılır; sonuçlar buna göre yorumlanmalı.
- **`fixedKademe` gün içi** (mc.ts) ve **MC'de moda göre N** (B8) açık (adım 10).
- **Kaan'a sorulacak:** gün içi %50 düşüş ve 120 dk maks. tutma kaldırıldı; isterse "öneri, varsayılan kapalı" olarak geri gelebilir.
- **Eski "Kaan onayı" kayıtları** (bu dosyadaki eski girişler, `docs/tasks/handoff/*`): tarihsel kayıt olarak bırakıldı, yukarıdaki düzeltme notuyla.

**Sonraki:** Başkan (Grok) inceleme. Veri zip'i gelince adım 9–11 (ayrıca TASKS #26).

## 2026-11-14 — Claude — [claude] haber çeşitliliği + çeviri, bilanço takvimi, Akış arama ve aylık opex

**Haber:** Kaynaklar: Yahoo Finance (hisse), Google News (4'erli sorgular), CNBC (üst haberler); Radar haber havuzuna da eklendi (`src/lib/news/feeds.ts`, `index.ts`). Tekrarlar URL ve başlık anahtarıyla elenir. Başlıklar otomatik Türkçeye çevrilir (`src/lib/news/translate.ts`); orijinal başlık altta. Haberler ekranında kaynak durumu (kaç kaynak çalıştı) gösterilir.
- Çeviri için anahtarsız Google gtx uç noktası kullanıldı. Resmî API değildir; kullanım koşulu ve hız sınırı değişebilir. Güvenilir üretim için resmî çeviri anahtarı önerilir.

**Bilanço takvimi (Menü kartı):** İşlem günü şeridi; gün için piyasa öncesi / sonrası / saat belirtilmemiş gruplar. Şirkete dokununca detay: EPS beklentisi ve analist sayısı, 14 gün bilanço haberleri, en yakın vade CBOE zinciri özeti (OI, hacim, en yoğun strike'lar), son 5 gün Akış olayları (`src/lib/earnings/*`, `src/screens/Bilanco.tsx`, `BilancoDetay.tsx`).
- Takvim kaynağı Nasdaq halka açık uç noktası (anahtarsız, resmî değil). Yanıt biçimi değişirse ayrıştırıcı boş liste döner.

**Akış:** Hisse arama kutusu (yazdıkça liste daralır). Vade filtresine "Aylık opex (2 ay)" eklendi: 3. Cuma vadeleri, bugünden en çok 2 ay ileri (`src/lib/flow/filter.ts`, `src/ui/AkisFiltre.tsx`).

**Doğrulama:** `npm run check` yeşil. Ağ çağrıları (Google News, çeviri, Nasdaq takvimi, CNBC) bu ortamdan denenemedi; telefonda doğrulanmalı.

**Açık:** Radar haber havuzunda çeviri yok (yalnız liste ekranı çevirir). Bilanço takvimi için geçmiş arama ve otomatik bildirim yok.

## 2026-11-14 — Claude — [claude] kurul düzeltmeleri + Kaan kararları (tur 2)

**Kaan kararları (uygulandı):**
1. **RR brüt:** komisyon RR'ye girmez; yalnız net K/Z'de düşülür (`signals/rr.ts`).
2. **1R sabit, stop −%50:** `PREMIUM_STOP_DROP = 0.50` (`paper/rules.ts`). 1R = giriş × 0,50, dayanak stopu 1R'yi değiştirmez. Hedef 1:5 → 1:4 → 1:3 (yeni `AGRESIF_3`; `RR_MIN = 3`). Örnek: giriş 3,00 → stop 1,50 · 1:5 10,50 · 1:4 9,00 · 1:3 7,50.
3. **Fırsat → Geçmiş:** onaylanan kâğıt pozisyon `journal`a düşer (`fromSignal`), kapanınca çıkış fiyatı ve nedeni yazılır.
4. **Uygulama anahtarı:** `EXPO_PUBLIC_FLOW_API_KEY` yedeği kaldırıldı (`flow/client.ts`). Anahtar paketin içine girmez; yalnız cihazda (Hesapla › Ayarlar).
5. **Koç:** çift yükleme engellendi (`Koc.tsx`). Düzeltme `claude/new-session-73a54r` dalında; `master`'a PR açılmadı (açıkça istenmedi).

**Kritik / yüksek düzeltmeler:**
- 0DTE 15:45 zorunlu çıkış: kontrat veya bid yoksa son bilinen bid ile çalışır; veri yoksa veya erken kapanış günüyse de çıkar (`ui/signalScan.ts` tickPaper).
- Sermaye NaN/0 → işlem açılmaz, NaN adet üretilmez (`paper/sizing.ts`).
- Erken kapanış günleri (13:00 ET) seans süresi doğru (`signals/session.ts`).
- Kart girişi = dolum (ask + 0,01); kart ve pozisyon adet/hedef uyumlu (`signals/verdict.ts`).
- `mid()`: alıcı ve son fiyat yoksa ask/2 uydurulmaz (`market/types.ts`).
- Radar: MarketData boş zinciri (204) CBOE yedeğini tetikler; isabet sonucu boşsa yeniden denenir (`ui/radarScan.ts`).
- Yahoo: istenen vade dışında dönen zincir önbelleğe girmez (`market/yahoo.ts`).
- Takip, Journal, Fırsat, Radar depoları: yükleme bitmeden üstüne yazmaz (`ui/*Store.ts`).
- Haberler: üst boşluk güvenli alan kadar (`screens/Haberler.tsx`).

**Yenilik (Ürün kurulu, kabul edilenler):** P1 onay öncesi kontrol satırı (bilgi); P5 "DURDU'ya kalan kayıp" sayacı.

**Açık (yapılmadı):** P2 olay şeridi (takvim "bilinmiyor" gösterimi), P3 Hesapla kademe önizlemesi, P4 Radar+Akış tekilleştirme. Koç zaman aşımı (150 sn, doğrulanmadı), Radar zincir yaşı denetimi, Radar bildirim dokunuşu. Strateji (S1–S4) ve veri (D1–D4) önerileri veri ve lisans gerektirir; uygulanmadı.

**Açık soru:** Güvenli modlar (1:2 / 1:1,5) hâlâ eski hedefte; 1:3–1:5 kuralı yalnız agresif modda mı uygulansın?

**Doğrulama:** `npm run check` yeşil (test, typecheck, lint). Test beklentileri yeni kurala göre güncellendi; `paper.test.ts` §7.2 örnekleri tarihsel (−%40) olarak işaretlendi.

## 2026-11-14 — Claude — [claude] time: kullanıcıya görünen saatler İstanbul (UTC+3)

**Ne:** Kullanıcıya gösterilen tüm ET saatleri İstanbul saatine (UTC+3, yaz saati yok) çevrildi. Dönüşüm ABD yaz saatine göre dinamik (`etToIst`, `istHM` — `src/lib/usmarket.ts`). Örnek: 15:45 ET = kışın 23:45 TR, yazın 22:45 TR. İç mantık (piyasa saatleri, kural kontrolleri) ET'de kalır; yalnız gösterim değişti.

**Dosyalar:** `src/lib/usmarket.ts`, `src/lib/alerts.ts` (`etHM` → `trHM`), `src/lib/signals/trade.ts`, `src/lib/signals/confidence.ts`, `src/lib/odte/signal.ts`, `src/lib/market/marketdata.ts`, `server/app/md.ts` (hata metni; sunucu deploy gerektirir), `src/screens/{Calc,Firsat,Journal,Odte}.tsx`, `test/timezone.test.ts` (yeni), `test/run.ts`, `test/signals.test.ts`, `test/trade-card.test.ts`.

**Doğrulama:** `npm run check` yeşil (uyarısız). Kış ve yaz DST testleri eklendi.

**Açık:** `server/app/md.ts` değişikliği için sunucu deploy gerekir. Dokümanlardaki (docs, README) ET saatleri değiştirilmedi.

## 2026-11-14 — Claude — [claude] menu: Haberler kartı

**Ne:** Menü'ye "Haberler" kartı eklendi. Radar izleme listesinin son 48 saat haberleri Yahoo RSS'ten (anahtarsız) listelenir; başlığa dokununca kaynak açılır; aşağı çekerek yenilenir. Chat'teki haber portalının uygulamadaki karşılığı.

**Dosyalar:** `src/screens/Haberler.tsx` (yeni), `src/screens/Menu.tsx`.

**Doğrulama:** `npm run check` yeşil. Yahoo RSS'in telefondan yanıt verdiği ve listenin dolduğu henüz doğrulanmadı. Sınırlar: yalnız Yahoo; SEC ve Finnhub yok; haberler sunucu tarafında saklanmıyor.

## 2026-11-14 — Claude — [claude] radar: veri kaynağı ve bayat veri kapısı

**Ne:** Radar gecikmesi CBOE'den geliyordu (zincir ve spot 15 dk gecikmeli, `delayedMin: 15` sabit). Artık spot Yahoo kotasyonundan, opsiyon zinciri MarketData `cached` modunda sunucu proxy'si üzerinden (tek IP kuralı korunur). Anahtar yoksa ya da MarketData düşerse CBOE yedeği; o durumda gecikme 15 dk olarak işaretlenir. Trend girişi spot verisi 3 dk'dan eskiyse üretilmez.

**Dosyalar:** `src/ui/radarScan.ts`, `src/lib/radar/detectors/trend.ts`, `test/radar.test.ts`.

**Doğrulama:** `npm run check` yeşil. Yahoo'nun gerçek gecikme alanı (`exchangeDataDelayedBy`) ve sunucu proxy'sinin Radar'dan çağrısı telefonda henüz doğrulanmadı. Radar'da "Yahoo + MarketData" yazısı ve veri yaşı kontrol edilmeli.

## 2026-11-14 — Claude — [claude] coach: yükleme gövdesi sunucuyla hizalandı

**Ne:** Koç ekran görüntüsü yüklemesi her görüntüde "Reddedildi (HTTP 400): Görüntü verisi yok" veriyordu. Kök neden: istemci `uploadScreenshot` gövdesini `{base64, mime, day}` gönderiyordu, sunucu `coachImage` ise `{image, mime, day}` bekliyor (`server/app/coach.ts`). Gövde artık `{image, mime, day}`. Bu yüzden karne de "koçluk kaydı yok" (404) veriyordu; dolum kaydolmadığı için.

**Dosyalar:** `src/lib/coach/client.ts`.

**Doğrulama:** `npm run check` yeşil. Gerçek telefon yüklemesi henüz denenmedi; Başkan'ın 22 görüntülük yüklemesiyle doğrulanmalı.

**Not:** Bu dal `origin/master` ile birleştirildi (master'daki Koç kodu bu dala geldi). Yeni paketler (`expo-image-picker`, `expo-image-manipulator`) için `npm ci` gerekti.

## 2026-11-14 — Claude — [claude] radar: giriş ve skor algoritması

**Ne:**
- **Giriş (`trend`):** tek fiyat–OR kontrolü yerine onaylı kırılım: OR dışına %0,1 tampon, VWAP hold (son 5 bar aynı tarafta), EMA hizası, ET 10:00–15:30 penceresi. Şiddet kırılım mesafesine bağlı (0,55–0,80); sabit 0,6 kaldırıldı.
- **Skor (`engine.ts`):** aynı kaynaktan gelen sinyaller (akış: P/C, olağan dışı kontrat, OI) bağımsız sayılmıyor; aile başına en güçlü şiddet, aileler arası 1 − Π(1 − max). Bildirim için teyit şart: iki farklı aile, haber, sektör ya da onaylı trend. Tek aileden gelen uyarı listede kalır.
- **İsabet (`track.ts`, `radarScan.ts`):** yeni `barrierOf` — 2 saat içinde +½·EM hedefi mi önce vuruldu, −½·EM stopu mu (bar high/low yolu, aynı barda ikisi → kayıp). `barrierSummary` win% = win/(win+loss). Eski "2 saat sonra yön" ölçümü duruyor.

**Dosyalar:** `src/lib/radar/detectors/trend.ts`, `src/lib/radar/engine.ts`, `src/lib/radar/track.ts`, `src/ui/radarScan.ts`, `test/radar.test.ts`.

**Doğrulama:** `npm run check` yeşil (test, typecheck, lint, bt:selftest). Radar testlerine yeni 14 kontrol eklendi (giriş kuralları, aile birleşimi, teyit kapısı, bariyer uçları).

**Açık / dürüst not:** Win rate'in gerçekten yükseldiğini bu oturumda ölçemedim: sandbox'ta Yahoo erişimi ve gerçek radar kaydı yok. Tek kanıt birim testleri. Gerçek ölçüm için uygulamada birkaç hafta kayıt + `barrierSummary` çıktısı gerekir; eşikler (OR tamponu, 0,5·EM hedef, 5 bar hold) o veriye göre kalibre edilmeli. Radar UI'ında win% henüz gösterilmiyor. Bilinmiyor: yeni eşiklerle bildirim sayısının düşüp düşmeyeceği.

## 2026-11-13 — Grok — [grok] Aşama 4–5 incelemesi

**Ne:** Claude'un Aşama 4 (kâğıt hesap) ve Aşama 5 (Fırsat sekmesi + tarama bağlama) kodu doğrulandı. İlk `npm test` / `tsc --noEmit` / lint / `bt:selftest` yeşildi. Kaan'ın sayısal örnekleri (300→150→1:3 çıkış→600; 150→50 kayıp→200→%40=80; ikinci kayıp → %30 + güvenli mod), %50 tavan, kademe 50→40→30 ve 30→40→50, güne taşıma, 4 kazanç / 2 kayıp güvenli mod, 1:5 sonra 1:4, %67 prim stopu, 1,50 $ komisyon, 0DTE 15:45, onay 3/5 dk ve "fiyat kaçtı" testlerde tutuyor. %50 kuralına dokunulmadı.

**Düzeltmeler:**
- 15:45 ET'de 1–3 DTE gece kararı hedef/stop/risk kontrolünden önce çalışıyordu; hedefe veya stopa gelmiş pozisyon taşınabilirdi. Sıra tersine çevrildi.
- "Onayla" taraması başarısız olunca `leftMin=0` yüzünden kart yanlışlıkla "pencere kapandı" ile düşüyordu. Artık yerel seans saati kullanılır; taze fiyat yoksa kart durur ve Başkan'a tekrar denemesi söylenir.
- Kart geçersizliği ve yeniden fiyatlama, kart etiketi AGRESIF diye 1:5'e kilitleniyordu (1:4,2 "fiyat kaçtı" olabilirdi). Tabana hesap modu uygulanır (Agresif'te 1:4 geçerli).
- Açık kâğıt pozisyon varken bekleyen kartlarda "Onayla" görünüyordu; bilgi notuna alındı.
- `firsat-v1` yüklemesinde kâğıt hesap ayarları ve kademe arındırılır.

**K8 / K9 (düzeltildi, D12):** Claude bunları "Kaan onayı 2026-11-13" diye işaretlemişti; yanlıştı. Kaan'ın kararı risk bazlı 1:N ve DURDU açık. Kaan'ın 1:3 örneği (150→450) hem eski "kazanç/risk" hem K8 (çıkış/giriş=3) ile uyumlu; 1:5 ise ayrılır (eski +5R → çıkış 650, K8 → çıkış 750). DURDU varsayılan kapalı, Kaan'ın form cevaplarında açıkça yoktu (§11.2 varsayılanı). Kod K8/K9 ile bırakıldı; Başkan teyidi istenir.

**Dosyalar:** `src/lib/paper/engine.ts`, `src/lib/paper/account.ts`, `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`, `src/screens/Firsat.tsx`, `test/firsat.test.ts`, `docs/TASKS.md` (D11), `docs/tasks/handoff/SINYAL-FIRSAT-asama-5-inceleme.md`.

**Doğrulama:** `npm test` (yeni 15:45 hedef/stop testleri dâhil), `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` geçti. Token, ağ çekimi, Expo yayını yok.

**Açık:** T4/T5/T7 bağlı değil; gece kararında `eventBeforeOpen` her zaman false (bilanço/FOMC/CPI/NFP yok sayılıyor); T1–T3 "son 30 dk" aslında anlık bar; A2 RS yok; görsel Expo testi yok.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 6 (kısmi: Monte Carlo, kriterler, setup sarmalayıcısı)

**Ne:**
- MarketData: Kaan "MarketData kapalı, devam et" dedi; token yalnızca çekim sürecinin ortamına alındı, repoya, log'a ya da sohbete yazılmadı. BT_DRYRUN: GLD/SLV/NVDA/QQQ 12 ay ≈ 1480 kredi. Çekim başladı, Başkan'ın talimatıyla durduruldu. Önbellek yarım (`C:\dev\bt-data`, repo dışı, 258 dosya). **Gerçek veri koşusu Başkan'dan gelecek.**
- `src/lib/odte/strategies/firsat.ts`: setup → Strategy sarmalayıcısı, `firsat-s1`…`firsat-s6` (STRATEGIES'e kayıtlı). A1 yalnız kendi sembolünün VWAP tarafı; kalan EM = günlük EM × √(kalan dk/390); S4 (duvar), S5 (haber), S6 (IV rank) verisi olmadığı için üretmez.
- `src/lib/paper/mc.ts` güncellendi: hedef tanımı iki varyant. **Birincil K8** (1:5 = çıkış 750 $) — *Claude'un yanlış etiketi, Kaan onayı değildi; 2026-11-13 D12 ile birincil risk bazlı (650 $) oldu, K8 karşılaştırma.* **DURDU birincilde açık** (D12), kapalı karşılaştırma olarak. `runMcVariants` dört kombinasyonu aynı tohum ve gün dizisiyle koşar.
- `src/lib/signals/criteria.ts`: `FIRSAT_CRITERIA`, backtest kapısı, "Güvenilir ✓" koşulları.
- Testler: `test/mc.test.ts` (K8 900 $ / R650 800 $ tek hedef; DURDU 4 kayıp sonrası 4 işlem / kapalıyken 5), `test/firsat-strategy.test.ts` (S1 kırılımı: hedef 2×OR, hacim/EM/pencere koşulları, S4–S6 veri yokken boş, bağlam).

**Doğrulama:** `npm run check` (aşağıda commit öncesi sonuç).

**Açık:** 1:5 hedefi 750 (K8) mı 650 mı, Başkan teyidi bekleniyor; MC her iki tanımı da raporlar. Gerçek veri koşusu, walk-forward raporu ve geçen/kalan tablosu yok (Başkan'dan veri bekleniyor).

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 5 (Fırsat ekranı + tarama bağlama) ve K8/K9 kararları

**Ne:**
- **Kararlar (Claude etiketi — Kaan onayı DEĞİL; 2026-11-13 Başkan incelemesinde düzeltildi, D12):** K8 — 1:N = çıkış/giriş (1:5 = 750). K9 — DURDU varsayılan kapalı. Her ikisi de Kaan'ın kararı değildi. `src/lib/signals/rr.ts`, `src/lib/paper/account.ts`, `SINYAL-FIRSAT.md` §6.1/§7.4/§11.1 güncellendi.
- **Aşama 5:** Fırsat sekmesi (`src/screens/Firsat.tsx`): hesap şeridi, sinyal tickerları (Radar'dan taşındı), açık pozisyon, onay kartları (skor dökümü, geri sayım, Onayla/Geç), özet/kayıt, İsabet, ayarlar.
- **Tarama bağlama** (`src/ui/signalScan.ts`): skor (A1–H), RR (1:N), mod uygunluğu, boyut önizlemesi, kart yaşam döngüsü (süre, fiyat kayması, geçersizleşme, 30 dk soğuma, günde 10), pozisyon tick'i (T1/T2/T3/T6, 15:45, gece kararı, ertesi sabah gap), "Onayla" zinciri 60 sn'den eskiyse yeniden çeker.
- **Saf çekirdek:** `src/lib/signals/opp.ts` (kart), `src/lib/paper/engine.ts` (pozisyon tick), `riskwatch.ts` (`TRIGGER_AD`), `overnight.ts` (IV yoksa taşıma yok), `approval.ts`.
- Radar sekmesinden "Sinyal tickerları" kaldırıldı; artık Fırsat sekmesinde.

**Dosyalar:** yeni `src/lib/signals/opp.ts`, `src/lib/paper/engine.ts`, `src/screens/Firsat.tsx`, `test/firsat.test.ts`, `docs/tasks/handoff/SINYAL-FIRSAT-asama-5.md`. Değişen `src/ui/signalScan.ts`, `src/ui/firsatStore.ts`, `src/app/index.tsx` (sekme, açık pozisyonda 1 dk tarama), `src/screens/Radar.tsx`, `src/lib/signals/rr.ts`, `src/lib/signals/riskwatch.ts`, `src/lib/paper/{account,types,overnight}.ts`, `test/paper.test.ts`, `test/setups.test.ts`, `package.json` (test betiği), `docs/TASKS.md` (#25 done, D10), `docs/tasks/SINYAL-FIRSAT.md`.

**Doğrulama:** `npm run check` çıkış 0 (tsc, lint 0 uyarı, test, bt:selftest). `test/firsat.test.ts` kart (1:5 uygun, 1:4 AGRESIF_4, 1:3 veto, piyasa kapalı, DURDU, sermaye yetersiz) ve pozisyon adımı (hedef +300, stop −100, uyarı→çıkış, 15:45, 2DTE gece taşıma, ertesi sabah gap) için yeşil. **Ekran görsel olarak test edilmedi; tarama ağ üzerinde çalıştırılmadı.**

**Açık / eksik:** T4, T5, T7 tetikleri bağlı değil; haber/makro/bilanço bayrakları `false`; sektör göreli güç yok; H (tarihsel) n=0 nötr; D'de dokunma olasılığı EM tabanlı yaklaşım; "Güvenilir" rozeti yok (Aşama 6); CSV yok; özsermaye eğrisi liste.

**Sonraki:** Aşama 6 (backtest, Monte Carlo, iflas raporu). MarketData token'ı için Kaan onayı gerekir.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 4 (kâğıt hesap ve para yönetimi)

**Ne:** §7 durum makinesi, kademe/boyut, maliyet, "Onayla" akışı, gece taşıma ve risk izleyici (T1–T7, iz süren stop) saf fonksiyon olarak yazıldı. Kaan'ın sayısal örnekleri birim testi yapıldı. Gerçek emir, aracı ve UI yok.
- `src/lib/paper/types.ts`, `costs.ts`, `sizing.ts`, `account.ts`, `approval.ts`, `overnight.ts` (yeni)
- `src/lib/signals/riskwatch.ts` (yeni: T1–T7, `evaluatePosition`, `trailPrem`, `effectiveStopPrem`, `modeTargetR`)
- `test/paper.test.ts` (yeni, 143 kontrol) — `package.json` `test` betiğine eklendi
- `docs/tasks/handoff/SINYAL-FIRSAT-asama-4.md`, `docs/TASKS.md` (#24 done, #28 notu)

**Kaan kuralları:** %50 azami ve kademe 30/40/50 değişmedi (`MAX_KADEME`, `KADEMELER`). Kayıp → bir adım düş; kazanç → bir adım yüksel; başabaş değişmez; kademe gün geçişinde taşınır. Komisyon Midas 1,50 $ açılış+kapanış. Prim stopu %67. Onay süreleri 0DTE 3 dk / 1–3 DTE 5 dk. 1–3 DTE gece taşınabilir, 0DTE 15:45'te kapanır.

**Doğrulama:** `npm run check` çıkış 0 (test dahil paper 143 OK, tsc, lint 0 uyarı, bt:selftest). Ör.1–8 ve §6.1 örnekleri birebir (R 100, 600, 300, 80, 146,67, 650, 157); 10.000 işlemlik özellik testi (kesirli ve tam kontrat) pozisyonun sermayenin %50'sini hiç aşmadığını gösterdi.

**Açık / Başkan kararı:**
1. **Çelişki:** Kaan ör.3 (iki kayıp sonrası GUVENLI_ZARAR ile devam) ile §7.4 "gün içi %50 düşüş → DURDU" (varsayılan açık) aynı günde çakışıyor (%51). Varsayılan değiştirilmedi; §11.2 #1 Kaan'a sorulmalı.
2. Prim stopu 0,67 formülü R = 100,5 veriyor; Kaan'ın yuvarlak 100/600 örneği 2/3 ile tutuyor. Test iki varyantı da kapsıyor.
3. Mod sayaçları yapışkan (gün sonuna kadar). Hedef primi sinyalin RR'ından gelir.

**Sonraki:** Aşama 5 (Fırsat ekranı, `firsatStore`, tarama döngüsüne bağlama). Veri kaynağı yok, MarketData token kullanılmadı, Expo yayını yok.

## 2026-11-13 — Grok — [grok] fix of stage 3 verification

**Ne:** Claude'un SINYAL-FIRSAT Aşama 3 kodu (S1–S6, `optionRR`, strike tarayıcı, `signalScan` bağlantısı) doğrulandı. İlk `npm test` / `tsc --noEmit` / lint / `bt:selftest` yeşildi; Claude'un şüpheleri (eksik import, çalışmayan align testleri, `firsatStore` başlangıç `setups`) typecheck/testte doğrulanmadı. İncelemede net hatalar bulundu ve düzeltildi:
- `T0` takvim `dte × 390` kullanıyordu (Cuma→Pazartesi 3 hayali seans). Artık yalnız işlem günleri sayılıyor.
- `sessionLeftMin` hafta sonu ve tatilde de pozitif kalabiliyordu; artık 0.
- Kalan EM canlı ATM straddle'ı `√(kalan/390)` ile tekrar küçültüyordu (0DTE'de çift iskonto). Artık `EM_vade × √(kalan seans / vadeye işlem dk)`.
- QQQ rejiminde kendisi var; `aux` kendi barlarını içermediği için A1 asla true olmuyordu. `scanOne` artık `aux[t] = sessionBars`.
- Tarama hatasında `TickerStatus.setups` tanımsız kalabiliyordu; boş dizi varsayılanı eklendi.
- `test/setups.test.ts` ortasındaki `import` üstte toplandı; T0 / `leftMin` / `emRemain` / QQQ uyum testleri eklendi.
**Dosyalar:** yeni `src/lib/signals/session.ts`; değişen `src/ui/signalScan.ts`, `test/setups.test.ts`, `docs/TASKS.md` (#23 done, D9), bu kayıt, `docs/tasks/handoff/SINYAL-FIRSAT-asama-3.md`.
**Doğrulama:** `npm test`, `npx tsc --noEmit`, `npm run lint`, `npm run bt:selftest` geçti. MarketData token kullanılmadı, ağ çekimi ve Expo yayını yok.
**Açık / sonraki:** Aşama 4 (kâğıt hesap durum makinesi, %50 kademe değişmez, risk izleyici, maliyet). Skor ve bildirim hâlâ taramaya bağlı değil. A2 göreli güç (RS) henüz yok (sektör = yalnız VWAP). IV takvim yılı (`buildSnapshot`) ile T0 işlem yılı (252×390) karışımı duruyor; canlı veriyle fiyat kıyası gerekir. `sessionBars` günü `now` değil son barın tarihine bakıyor.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 1 (tamam) + Aşama 2 (çekirdek)
**Ne:**
- **Aşama 1 (#21):** sinyal tickerları ayarı (varsayılan QQQ, GLD, SLV, NVDA; en fazla 8; doğrulama; 0–3 DTE uyarısı), ticker profilleri (`profiles.ts`), OTM sabit/oto k (`otm.ts`), `firsatStore` (AsyncStorage `firsat-v1`), 60 sn paylaşılan önbellek (`scanCache.ts`), tarama turu (`signalScan.ts`, 2 dk), `notifyFirsat`, ayar bileşeni (geçici olarak Radar ayarlarında).
- **Aşama 2 (#22, çekirdek):** `scoreSignal` (A1–H, vetolar, gecikmeli veri tavanı, Beta küçültme, etiketler), `features.ts`, `outcome.ts` (hedef/stop/zaman, MFE/MAE R), `log.ts` (kayıt + kalibrasyon özeti). Kalibrasyon ekranı, CSV, canlı bağlama ve "Güvenilir" rozeti açık.
- **Replay hatası:** `backtest/replay.mts` için `--help` ve Türkçe ağ hatası; token kullanmaz.
**Dosyalar:** yeni `src/lib/signals/*` (9 dosya), `src/ui/firsatStore.ts`, `src/ui/scanCache.ts`, `src/ui/signalScan.ts`, `src/ui/SignalTickers.tsx`, `test/signals.test.ts`. Değişen: `src/ui/notify.ts` (ekleme), `src/screens/Radar.tsx` (ayar bileşeni), `src/app/index.tsx` (firsat.load + 2 dk tarama aralığı), `package.json` (test betiği), `backtest/replay.mts`.
**Doğrulama:** temiz kopyada typecheck, `npm test` (signals 67 + radar + prob + run), lint, `bt:selftest` geçti. `replay --help` çıkış 0; ağsız çalıştırma Türkçe hata verir.
**Açık:** seans modu (keep-awake paketi yok); NBIS/GLW sektör kararı (§11.2 #4, SMH varsayılan; Radar hâlâ QQQ); minOi/minVol/spread varsayılanları Aşama 6'da; Aşama 3–7 yapılmadı; Expo'da görsel test ve yayın yok; MarketData token kullanılmadı.
**Grok'a devir:** `docs/tasks/handoff/SINYAL-FIRSAT-asama-1.md` ve `-asama-2.md`.

## 2026-11-13 — Claude — SINYAL-FIRSAT Aşama 0 (port + bağlama)
**Ne:** Grok'un box dosyaları ana repoya kopyalandı (kaanMomentum, strateji tipleri/util/index, backtest engine/bt/compare/prep/validate/peers/live/replay, replay.defaults.env, test/run.ts, backtest/README, docs/tasks, docs/reports). `package.json`'a yalnız `bt:live` ve `bt:replay` eklendi.
**Doğrulama:** temiz kopyada `npm ci` (835 paket). `npm test`, `npm run typecheck`, `npm run lint`, `npm run bt:selftest` geçti. `replay.mts --help` bayrağı yok; komut Yahoo'ya gidiyor, ağ yokken ham hata veriyor (Türkçe değil, açık).
**Açık:** replay hata mesajı; Radar ve kaanMomentum SECTOR/ETF tanımları Aşama 1'de birleşecek; Aşama 0 sonunda dur, Başkan onayı bekleniyor. Expo yayını yapılmadı (Kaan istemedi); commit henüz yok.
**Grok'a devir:** `docs/tasks/handoff/SINYAL-FIRSAT-asama-0.md`.

## 2026-11-13 — Grok — SINYAL-FIRSAT: Kaan'ın cevapları işlendi

**Ne:** `docs/tasks/SINYAL-FIRSAT.md` güncellendi. §11 ikiye ayrıldı: §11.1 Kaan'ın kesin kararları (K0–K7), §11.2 açık sorular (DURDU, kış saati, 1 kontrat/kesirli, NBIS/GLW).
- Kademe: kayıptan sonra her kazanç bir adım yükseltir (30 → 40 → 50); kademe ertesi güne taşınır (§7.2, §7.4).
- Manuel onay: yeni §7.7 "Onayla" akışı; süre dolumu (0DTE 3 dk, 1–3 DTE 5 dk, %25 fiyat kayması, stop/hedef yarısı, pencere sonu, geçersizleşme), onayda yeniden fiyatlama ("fiyat kaçtı": ask +%10 veya RR düşüşü). Çıkışlar otomatik.
- Gece: yeni §7.8; 0DTE 15:45 ET'de kapanır, 1–3 DTE ön koşullarla taşınır (olay yok, rejim uyumlu, 2σ gece gap senaryosu ≤ 1,5R), ertesi sabah 09:31 gap çıkışı.
- Prim stopu %67 kesinleşti. OTM uzaklığı: yeni §4.2.1 `otm.ts` / `autoK` (60 günlük trend günü uzanması, IV rank düzeltmesi, kMin/kMax); MU/INTC/QQQ çapaları sabit.
- Komisyon: Midas 1,50 $/kontrat açılış ve kapanışta, RR'a ve adet hesabına dahil; Fırsat backtest'lerinde `BT_FEE=1.5`.
- Birim test listeleri (Aşama 3 ve 4) ve dosya planı (`otm.ts`, `approval.ts`, `overnight.ts`) güncellendi. TASKS #28 daraltıldı, D8 eklendi.
**Kod değişikliği yok** (yalnızca belgeler).

## 2026-11-13 — Grok — box işlerinin portu + SINYAL-FIRSAT görev tanımı
**Ne:**
- Box'ta kalıp GitHub'a gitmemiş işler GitHub sürümüne uyarlandı: `src/lib/odte/strategies/kaanMomentum.ts` (4 varyant), `types.ts` (`peer`, `strike`, `exitCheck`, `peers`),
  `util.ts` (`pickStrike`, yalnız OTM), `index.ts` (kayıt), `backtest/engine.mts` / `compare.mts` / `bt.mts` / `prep.mts` / `validate.mts` / `README.md`,
  yeni `backtest/peers.mts`, `live.mts`, `replay.mts`, `replay.defaults.env` (yalnız `BT_STEP=1`; Windows'ta da çalışsın diye `--env-file-if-exists`),
  `test/run.ts` (kaan-momentum + pickStrike testleri), `package.json` (`bt:live`, `bt:replay`; Claude'un `test` betiği korundu),
  `docs/tasks/RADAR.md`, `docs/reports/2026-11-12-*.md`.
- Yeni görev tanımı `docs/tasks/SINYAL-FIRSAT.md` (Sinyal tickerları, Güven Skoru, Fırsat Penceresi 1:5 RR, kâğıt hesap durum makinesi, backtest + iflas raporu);
  TASKS #20–#28; `AGENTS.md` §1/§2/§8/§10 güncellendi, yeni §11 (orkestra/uygulayıcı akışı); `CLAUDE.md` iş akışı maddeleri.
**Doğrulama:** GitHub sürümünün kopyasında port uygulanmış halde `npx tsc --noEmit` temiz, `npm test` (run + prob + radar) geçti,
`npm run bt:selftest` geçti (`BT_CACHE`/`BT_SNAPS` geçici dizin), `npx eslint src test` temiz; `live/replay/peers/compare/engine.mts` ayrı tsc ile temiz. Token kullanılmadı.
**Claude için:** Aşama 0 = bu dosyaları bağla/doğrula (SINYAL-FIRSAT §3). Radar `universe.ts` ile kaan-momentum `SECTOR`/`ETFS` farklı; Aşama 1'de birleştirilecek.

## 2026-11-13 — Claude — Radar (Aşama A–E)
**Ne:**
- **A. Olasılık** `src/lib/prob/implied.ts`: OTM smile (ln(K/F), 3'lü medyan, doğrusal enterpolasyon, düz ekstrapolasyon), risk-nötr `pAbove` (N(d2) − e^{rT}·vega·∂σ/∂K), `pBelow`/`pBetween`, dokunma olasılığı (≈ 2·P), kantiller, dijital çapraz kontrol, 25Δ risk reversal ve put kanadı eğimi.
- **B. Dedektörler** `src/lib/radar/`: baseline (20 gün P/C ve hacim, 1 yıl ATM IV ile IV rank/percentile, RV10/20, RR25 ort./std), 11 dedektör dosyası (P/C yığılması, olağan dışı kontrat, OI birikimi, IV sıçraması, skew kayması, rehavet/panik, pin/gamma, sektör ayrışması, bilanço, trend adayı). Her biri saf fonksiyon `(snapshot, baseline) => Signal[]`.
- **C. Haber** `src/lib/news/`: Yahoo RSS, SEC EDGAR (8-K, Form 4; User-Agent gerekli), Finnhub (anahtar isteğe bağlı), sözlük sınıflandırıcı, sembol ve şirket adı eşleme, 5 dk'da tek çekim, görülmüş-öğe kümesi.
- **D. Uyarı motoru ve Radar sekmesi**: `engine.ts` (30 dk gruplama, skor = 1 − Π(1 − şiddet), haber ve sektör teyidi, bildirim eşiği 0,6, liste eşiği 0,35, 60 dk soğuma, günlük bildirim tavanı 12), `text.ts` (Türkçe, "Başkan," ile başlar, ne oldu / neden önemli / olası senaryo / dikkat, veri yaşı, seans dışında "yarın için not"), `ui/radarStore.ts`, `ui/radarScan.ts`, `screens/Radar.tsx`. Tarama 5 dk aralıkla, uygulama aktifken ve piyasa açıkken çalışır.
- **E. İsabet**: 30 dk, 2 sa, gün sonu ve ertesi gün açılış fiyatları otomatik doldurulur; yön isabeti ve dedektör bazında özet; 👍/👎 geri bildirimi (`track.ts`).
**Dosyalar:** yeni: `src/lib/prob/implied.ts`, `src/lib/radar/**`, `src/lib/news/**`, `src/ui/radarStore.ts`, `src/ui/radarScan.ts`, `src/screens/Radar.tsx`, `test/prob.test.ts`, `test/radar.test.ts`. Değişen: `src/app/index.tsx` (Radar sekmesi, Hesapla'ya geçişte yeniden bağlama anahtarı), `src/ui/notify.ts` (`notifyRadar`), `package.json` (`test` betiğine iki dosya eklendi).
**Veri:** Radar yalnızca anahtarsız kaynakları kullanır (CBOE, sonra Yahoo). MarketData'ya hiçbir çağrı yapılmaz; token yalnızca `MARKETDATA_TOKEN` ortam değişkeninden okunur, kodda, testte, fikstürde veya commit'te yoktur.
**Doğrulama:** `npm test` (run + prob + radar) geçti; prob 28/28, radar 74/74. `npm run typecheck`, `npx eslint src test` ve `npm run bt:selftest` geçti. `bt:selftest` için `BT_CACHE` ve `BT_SNAPS` geçici dizine yönlendirildi (varsayılan `/workspace` yazılabilir değil). Radar testleri: her dedektör için pozitif ve negatif örnek, CBOE SPY 0DTE fikstürüyle anlık görüntü, dört türün birlikte tetiklendiği senaryo ve Türkçe metin kontrolleri.
**Doğrulanamadı / açık sorular:**
- Yahoo haber, SEC ve finans uç noktaları bu ortamdan 403 ile erişilemedi; ayrıştırıcılar sentetik örneklerle test edildi, canlı çağrı yapılmadı.
- Expo Go'da Radar sekmesi görsel olarak test edilmedi; Expo yayını yapılmadı.
- `kaanMomentum.ts` repoda yok; trend dedektörü geçici kuralla çalışıyor (1 dk açılış aralığı + VWAP + EMA9/21; hedef strike = spot ± k·beklenen hareket, hisse 1,8, ETF 0,45).
- Bilanço dedektörü pasif: son 8 bilanço hareketi kaynağı yok. Finnhub bilanço ayrıştırıcısı hazır ama tarama turuna bağlı değil.
- SEC için User-Agent iletişim e-postası Kaan'dan bekleniyor; boşsa SEC kapalı.
- Aşama F (sunucu tarayıcısı, Telegram/ntfy) başlatılmadı; Kaan onayı gerekiyor.
- Commit kapsamı: bu çalışma ağacında önceki oturumlardan commit'lenmemiş değişiklikler de var (`backtest/`, `docs/`, strateji modülleri, monitor/alert dosyaları, `package.json` bağımlılıkları). Radar'a ait olmayanlar bu commit'e karıştırılmadı; karar Kaan'da.
**Grok'a devir:** Radar evreni `src/lib/radar/universe.ts` ve `RADAR_WATCH` listesinde. Gün içi isabet verisi `radar-v1` AsyncStorage anahtarında birikiyor; 4–6 haftalık veriyle eşik kalibrasyonu yapılabilir. Dedektör eşikleri `src/lib/radar/detectors/` altında, her biri ayrı test edilebilir.

## 2026-11-12 — Grok — backtest altyapısı v2, aday stratejiler, plan ve ajan belgeleri
**Ne:**
- `src/lib/odte/strategies/`: takılabilir `Strategy<P>` arayüzü (saf TS, uygulamada da çalışır), `pickContract`, `withTimeFilter`;
  stratejiler `confluence-v2/v1` (mevcut motor sarmalı), `orb-vwap`, `gamma-regime`, `oi-wall`, `em-breach`, `orb-vwap@sabah`, `gamma-regime@ogleden-sonra`.
- `backtest/engine.mts` (genel motor), `sources.mts` (modeled / recorded / hybrid fiyat kaynağı), `wf.mts` (walk-forward), `compare.mts` (rapor JSON+MD),
  `criteria.mts`, `record.mts` (gerçek gün içi zincir kaydı), `probe.mts` (onay sonrası doğrulama), `validate-intraday.mts`, `selftest.mts`.
- `backtest/md.mts`: `BT_MAX_CREDITS` / `BT_RESERVE` bütçe koruması, `BT_DRYRUN=1` kredi tahmini, `noCache` (canlı istekler), gecikme ölçümü.
- Uygulama: `bars.ts` artık önce Yahoo (MarketData candles hiçbir planda gerçek zamanlı değil → eskiden 15 dk gecikmeli barlar kabul ediliyordu);
  `ProvOpts.mdMode: 'live' | 'cached'` (MarketData zincirinde cached mod — henüz UI'da yok, TASKS #6). Diğer UI davranışı değişmedi.
- `package.json`: `bt:*` betikleri ve `npm run check`.
**Doğrulama:** `npm run check` geçti. `confluence-v2` yeni motorda eski `bt.run` ile birebir aynı (290 işlem, −%4,65).
İlk duman karşılaştırması (deneme verisi, modellenmiş, 91 gün): hiçbir strateji ADAY değil; en iyisi `orb-vwap@sabah` OOS 18 işlem +%5 (anlamsız örneklem).
**Önemli bulgular:** MarketData'da geçmiş gün içi opsiyon verisi yok (yalnızca EOD) → gerçek gün içi fiyat için ileriye dönük kayıt şart.
12 ay × 19 sembol geçmiş ≈ 5.100 istek / ~7.000 kredi; 24 ay ≈ 10.100 istek / ~13.800 kredi (kuru çalıştırma; 45 günlük yedek zincir istekleri için +%10–20 pay).
**Claude için açık sorular:** TASKS #5 (motor denetimi) özellikle `simulateEntry` giriş/çıkış zamanlaması ve `precompute` gösterge penceresi.
