# CHANGELOG / devir notları

En yeni üstte. Biçim: `## YYYY-MM-DD — Ajan — başlık`, sonra ne / dosyalar / nasıl doğrulandı / açık sorular.

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
