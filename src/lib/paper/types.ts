/* Kâğıt hesap (Aşama 4) tipleri — SINYAL-FIRSAT §7. Saf. Gerçek emir yok. */

/** Hesap modu (§7.1). AGRESIF_4 yalnızca sinyal etiketidir: hesap modu AGRESIF iken 1:5 yoksa 1:4 kabul edilir. */
export type PaperMode = 'AGRESIF' | 'AGRESIF_4' | 'GUVENLI_KAR' | 'GUVENLI_ZARAR' | 'DURDU';

/** Kademe (pozisyon yüzdesi). Kaan kararı: 30 → 40 → 50; azami 50 değişmez (§7.2). */
export type Kademe = 0.3 | 0.4 | 0.5;

export type TradeResult = 'kazanc' | 'kayip' | 'basabas';

/** Çıkış nedeni (§7.3, §7.8). */
export type ExitReason =
  | 'stop' | 'hedef' | 'prim-stop' | 'iz-suren-stop' | 'risk'
  | 'zaman' | 'gap' | 'gece-kapanis' | 'vade' | 'manuel';

/** Açık kâğıt pozisyon. Fiyatlar kontrat başına prim ($), R dolar cinsinden. */
export interface OpenPosition {
  id: string;
  ticker: string;
  setup: string;
  dir: 'call' | 'put';
  expiry: string;            // ET tarih (yyyy-mm-dd)
  dte: number;
  strike: number;
  contracts: number;         // kesirli simülasyonda ondalıklı olabilir
  fill: number;              // giriş dolumu (ask + kayma)
  costBasis: number;         // adet × fill × 100 + açılış komisyonu ($)
  openComm: number;          // açılış komisyonu toplamı ($)
  stopPrem0: number;         // başlangıç prim stopu (kontrat başına)
  stopPrem: number;          // güncel stop (iz süren stop ile yükselebilir)
  targetPrem: number;        // hedef prim
  rPrice: number;            // kontrat başına risk (fill − stopPrem0)
  rDollars: number;          // R ($) = rPrice × 100 × adet + 2 × komisyon × adet
  targetR: number;           // mod hedefi (5 / 4 / 2 / 1,5)
  openedAt: number;          // ms
  day: string;               // açıldığı işlem günü (ET)
  mode: PaperMode;           // sinyal modu (AGRESIF / AGRESIF_4 / GUVENLI_*), açılışta
  kademe: Kademe;            // açılış anındaki kademe
  overnight: boolean;        // gece taşınıyor mu
  maxR: number;              // görülen en yüksek kâr (R)
  warned: boolean;           // 1R–2R arası uyarı verildi mi
  und?: { entry: number; stop: number; target: number };  // dayanak seviyeleri (gap ve gece kararı için)
  nightDay?: string;         // gece kararının verildiği gün (15:45)
  adaptive?: 'CIK' | 'TUT' | 'DIKKAT' | 'YOK';   // uyarlanabilir çıkış son kararı (DİKKAT geçişinde bildirim için)
}

/** Kapanmış işlem. */
export interface ClosedTrade {
  id: string;
  ticker: string;
  setup: string;
  day: string;               // kapandığı gün (sayaçlar buraya yazılır, §7.4)
  mode: PaperMode;           // işlem açılırkenki sinyal modu
  kademe: Kademe;            // işlem açılırkenki kademe
  contracts: number;
  fill: number;
  exit: number;
  rDollars: number;
  netPnl: number;            // komisyon dâhil net K/Z ($)
  rMultiple: number;         // netPnl / rDollars
  result: TradeResult;
  reason: ExitReason;
  capitalBefore: number;
  capitalAfter: number;
  overnight: boolean;
  gap: boolean;
}

export interface PaperSettings {
  startCapital: number;
  fractional: boolean;       // kesirli kontrat simülasyonu (varsayılan kapalı, §11.2 #3)
  commission: number;        // kontrat başına ($), açılış ve kapanışta ayrı (Midas 1,50)
  slippage: number;          // $ (giriş ask + kayma, çıkış bid − kayma)
  durduEnabled: boolean;     // DURDU kuralı (varsayılan açık, Kaan kararı D12)
}

/** Hesabın tamamı (durum makinesi girdisi/çıktısı). */
export interface PaperAccount {
  capital: number;           // gerçekleşmiş sermaye ($); açık pozisyonun K/Z'si kapanınca eklenir
  kademe: Kademe;
  mode: PaperMode;
  winStreak: number;         // gün içi ardışık kazanç
  lossStreak: number;        // gün içi ardışık kayıp
  safeLossStreak: number;    // GUVENLI_ZARAR'a girişten sonra ardışık kayıp (2 → DURDU, Kaan D12)
  day: string;               // işlem günü (ET)
  dayStartCapital: number;
  dayPnl: number;
  position: OpenPosition | null;
  trades: ClosedTrade[];     // son N işlem (kayıt)
  settings: PaperSettings;
}
