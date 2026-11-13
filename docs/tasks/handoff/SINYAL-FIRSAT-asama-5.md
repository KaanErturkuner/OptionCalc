# SINYAL-FIRSAT — Aşama 5 devir notu (Claude, 2026-11-13)

**Yapılan**
- Fırsat sekmesi (`src/screens/Firsat.tsx`, tab ◆): hesap şeridi, sinyal tickerları (Radar'dan taşındı), açık pozisyon, onay kartları (skor + döküm, geri sayım, Onayla/Geç), özet ve kayıt, İsabet (kalibrasyon tablosu), ayarlar.
- Tarama bağlama (`src/ui/signalScan.ts`): aday → skor (A1–H) → RR 1:N → mod uygunluğu → boyut → kart; kart yaşam döngüsü (süre, fiyat kayması, geçersizleşme, soğuma/günlük kapı); pozisyon tick'i; "Onayla" zinciri 60 sn kuralıyla yeniden çeker.
- Saf çekirdek: `src/lib/signals/opp.ts` (kart), `src/lib/paper/engine.ts` (tick: risk, 15:45 gece kararı, ertesi sabah gap).
- Kararlar uygulandı: 1:N = çıkış/giriş (K8), DURDU varsayılan kapalı (K9).
- Test: `test/firsat.test.ts` (kart ve pozisyon adımı), toplam `npm test` yeşil.

**Doğrulama:** `npm run check` çıkış 0 (tsc, lint 0 uyarı, testler, bt:selftest). Ağ ve Expo ile tarama çalıştırılmadı; ekran görsel olarak test edilmedi.

**Eksik / varsayım (dürüst liste)**
- Tetikler: T1, T2, T3, T6 bağlı. T4, T5, T7 kapalı (RSI/IV girişi ve kilit seviye verisi bu turda yok).
- Skor girdileri: sektör göreli güç (RS) yok (`rsOk=false`); haber/makro/bilanço bayrakları `false`; H (tarihsel isabet) n=0 nötr 7,5; D'de dokunma olasılığı EM tabanlı yaklaşım (`pTouchApprox`), olasılık motoru bağlı değil.
- C (radar uyumu): son 30 dk radar şiddetleri (0–1 varsayımı).
- Onay "Onayla" yalnızca kart fiyatına göre; zincir 60 sn'den eskiyse tazeleme yapılır, ama tazelenen zincir bulunamazsa kart fiyatıyla devam eder.
- Kalibrasyon: "İsabet" tablosu var; CSV dışa aktarım yok. "Güvenilir ✓" rozeti yok (Aşama 6 kriteri).
- Özsermaye eğrisi grafik değil, son 20 işlem listesi.
- Açık pozisyonda tarama 1 dk; dış kapanış kuralları (1 kontrat/kesirli, kış saati) §11.2'de açık.

**Başkan'dan istenen**
1. Yukarıdaki eksik girdiler (özellikle T4/T5 ve haber bayrakları) Aşama 6'ya mı, yoksa Aşama 5 onayı öncesi mi?
2. Ekranın Expo Go'da açılıp açılmadığını ve kartların görünümünü Kaan ile birlikte kontrol edin.

**Yayın:** yok. MarketData token'ı kullanılmadı.
