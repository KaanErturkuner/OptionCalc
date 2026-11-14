# Yenilik Kurulu

**Amaç:** Para kazanmak için karar almada destek olacak fikirleri bulmak. Fikirleri Kaan'a sormak. Kaan beğenirse uygulamak.
**Sahip:** Claude (koordinasyon). **Karar veren:** Kaan. Kurul karar vermez, öneri yapar.

## Üyeler (6)

| # | Rol | Görev |
|---|---|---|
| 1 | Strateji araştırmacısı | Test edilebilir kenar (edge) hipotezleri üretir; her hipotez için kestirilebilir bir ölçüt ve OOS (out-of-sample) test planı yazar |
| 2 | Veri kaynakları uzmanı | Ücretsiz ya da ucuz yeni veri kaynaklarını ve bunların lisans, gecikme, kredi maliyetini araştırır |
| 3 | Risk yöneticisi | Her öneri için en kötü senaryo, düşüş (drawdown), kademe ve para kurallarıyla uyumu değerlendirir |
| 4 | Ürün stratejisti | Kararı hızlandıran ekran ve özellikleri önerir (uyarı, özet, karar kartı) |
| 5 | Davranış ve günlük analisti | İşlem günlüğünden hata kalıplarını çıkarır (erken çıkış, geç stop, aşırı işlem) ve koçluk fikirleri üretir |
| 6 | Kırmızı takım (eleştirmen) | Diğer beşinin her önerisini çürütmeye çalışır; sahte kenar, geriye dönük uyum (overfitting), yanlış yorum arar |

## Kurallar

1. **Kanıtsız öneri yok.** Her fikir şu üç şeyden birini içerir: bir ölçüt, bir test planı ya da bir risk gerekçesi. Yalnız "iyi görünüyor" diyen fikir listeye alınmaz.
2. **Her öneri kırmızı takımdan geçer.** Kırmızı takımın itirazı yazılı olarak kaydedilir; itiraz çözülmeden Kaan'a gitmez.
3. **Tavsiye değil.** Kurulun çıktısı işlem tavsiyesi değildir. Sinyaller kâğıt üzerinde kalır (`AGENTS.md`: "No proven edge").
4. **Para kuralı değişmez.** %50 kademe tavanı ve −%40 stop üzerine öneri yapılabilir, ama değişiklik yalnız Kaan onayıyla uygulanır.
5. **Kaan onaylamadan uygulanmaz.** Kurul önerisini `docs/kurullar/oneriler.md` dosyasına yazar ve Kaan'a sorar. Onay gelmeden kod, yayın ya da veri değişikliği yapılmaz.
6. **Maliyet ve sınır.** Yeni veri kaynağı için kredi ya da üyelik maliyeti Kaan'a açıkça yazılır.

## Öneri biçimi

Her öneri `docs/kurullar/oneriler.md` içinde şu alanlarla yazılır:

- **Başlık** ve **sahibi** (rol)
- **Ne:** Tek cümlelik öneri
- **Neden:** Ölçülebilir gerekçe ya da kaynak
- **Test planı:** Nasıl doğrulanır, hangi veriyle, hangi OOS dönemiyle
- **En kötü senaryo:** Kayıp, düşüş ya da yanlış karar riski
- **Kırmızı takım itirazı:** Varsa, ve nasıl yanıtlandı
- **Maliyet:** Para, kredi, zaman
- **Durum:** `öneri` / `Kaan onayladı` / `uygulandı` / `reddedildi`

## Ne zaman Kaan'a sorulur

- Her yeni öneri, kırmızı takım itirazıyla birlikte.
- Maliyet ya da veri sağlayıcı değişikliği.
- Para kuralı ya da kademe etkisi.
