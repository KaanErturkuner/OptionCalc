# Tester Kurulu

**Amaç:** Uygulamayı ve sunucuyu test etmek: veriler doğru mu, görüntüler doğru mu, hata ya da açık var mı. Bulunanları raporlamak ve güvenli olanları düzeltmek.
**Sahip:** Claude (koordinasyon). **Başkan:** Kaan.

## Üyeler (7)

| # | Rol | Görev |
|---|---|---|
| 1 | Veri doğrulayıcı | Fiyat, zincir, IV, OI, hacim, Greek'ler, mumlar: kaynak ↔ ekran tutarlılığı, bayat veri, gecikme etiketi |
| 2 | Hesap denetçisi | Fiyatlama (Amerikan / LR + Richardson), kâğıt hesap, K/Z, komisyon, kademe, stop/hedef: `src/lib/paper/rules.ts` ile karşılaştırma |
| 3 | Görüntü ve arayüz denetçisi | Ekran düzeni (telefon genişliği, güvenli alan, karanlık/açık tema), metinlerin Türkçe ve doğru olması, taşma/kırpılma |
| 4 | Kod ve birim test mühendisi | Sınır durumları, çökmeler, boş veri, null/NaN, zaman dilimi (ET ↔ İstanbul), DST, tatil günleri |
| 5 | Güvenlik denetçisi | Sır sızıntısı (token, `x-app-key`, Anthropic anahtarı), girdi doğrulama, yetkisiz uçlar, loglarda veri sızması |
| 6 | Sunucu ve entegrasyon | `server/` uçları, proxy izin listesi, kredi sayaçları, koç akışı, Caddy/dağıtım, bildirim |
| 7 | Uçtan uca senaryo | Gerçek kullanıcı akışları: hesapla → takip → kayıt; radar → uyarı → isabet; koç yükleme → karne |

## Sınırlar (değiştirilemez)

- **Sır yok:** Token, anahtar, `.env*` okunmaz, yazılmaz, loglanmaz. Sunucuda sır dosyası içeriği `cat` edilmez.
- **MarketData'ya doğrudan çağrı yok.** Sunucu çalışırken `backtest/` API scripti çalıştırılmaz. Test için sabit fikstür veya kayıtlı örnek kullanılır.
- **Para kurallarını değiştirmez.** %50 kademe tavanı ve −%40 stop gibi sayılar yalnız `src/lib/paper/rules.ts` üzerinden ve Kaan onayıyla değişir.
- **Yayın yok.** `eas update` yalnız Kaan istediğinde yapılır.
- **Yıkıcı işlem yok.** Force-push, dal silme, veri silme yok.

## Çalışma akışı

1. **Tarama:** Her üye kendi alanını tarar. Bulgu şablonu: `docs/kurullar/bulgular.md`.
2. **Sınıflandırma:** Her bulgu şu seviyelerden biriyle etiketlenir:
   - **Kritik:** Yanlış para hesabı, yanlış fiyat, sır sızıntısı, çökme.
   - **Yüksek:** Yanlış veri ya da görüntü, bozuk akış.
   - **Orta / düşük:** Kozmetik, metin, performans.
3. **Doğrulama:** Bulgu tekrar üretilerek doğrulanır. Doğrulanamayan bulgu "doğrulanmadı" diye işaretlenir, düzeltilmez.
4. **Düzeltme:** Kritik ve yüksek bulgular düzeltilir. Her düzeltme ayrı commit (`[claude] <alan>: <ne>`), önce `npm run check` yeşil olmalı. Düzeltme test ile kanıtlanır.
5. **Kaan'a rapor:** Kısa özet: ne bulundu, ne düzeltildi, ne kaldı. Para kuralıyla ya da kullanıcı davranışıyla ilgili kararlar Kaan'a sorulur, kendi başına uygulanmaz.

## Ne zaman durur

- Kritik bir bulgu para hesabını etkiliyorsa düzeltmeden önce Kaan'a sorulur.
- Bir düzeltme birden fazla kurul ya da Kaan kararı gerektiriyorsa ayrı işaretlenir.
- Bir test için gerçek API çağrısı gerekiyorsa önce onay alınır.
