import { useEffect, useState } from 'react';
import { AppState, Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Calc from '@/screens/Calc';
import Odte from '@/screens/Odte';
import Menu, { type CardId } from '@/screens/Menu';
import Radar from '@/screens/Radar';
import Firsat from '@/screens/Firsat';
import Akis from '@/screens/Akis';
import { tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { checkOpenPositions, syncBackgroundTask } from '@/ui/monitor';
import { radar } from '@/ui/radarStore';
import { runRadarScan, pollSecNews } from '@/ui/radarScan';
import { firsat } from '@/ui/firsatStore';
import { runSignalScan } from '@/ui/signalScan';
import { marketOpen } from '@/lib/usmarket';
import { nextRefresh, setExpected } from '@/lib/freshness';

type Tab = 'calc' | 'radar' | 'firsat' | 'odte' | 'akis' | 'menu';
const TABS: [Tab, string, string][] = [['calc', '∑', 'Hesapla'], ['radar', '◎', 'Radar'], ['firsat', '◆', 'Fırsat'], ['odte', '⚡', '0DTE'], ['akis', '≋', 'Akış'], ['menu', '☰', 'Menü']];
const RADAR_EVERY_MS = 5 * 60000;
const WEB_MAX = 1100;

export default function Home() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('calc');
  // 0DTE ekranı baştan bağlı: bildirimler açıksa sinyal taraması diğer sekmelerdeyken de sürer
  const [seen, setSeen] = useState<Record<Tab, boolean>>({ calc: true, radar: false, firsat: false, odte: true, akis: false, menu: false });
  // Menü'nün açılış kartı (Odte'den Geçmiş'e geçişte) ve yeniden bağlama anahtarı
  const [menuStart, setMenuStart] = useState<CardId | null>(null);
  const [menuKey, setMenuKey] = useState(0);
  // Hesapla'ya Radar'dan kontrat aktarımında Calc yeniden bağlanır (durumu mount'ta okur)
  const [calcKey, setCalcKey] = useState(0);
  // Uygulama açıkken: açık pozisyonları 2 dk'da bir kontrol et (hedef/stop bildirimi); arka plan görevini eşitle
  useEffect(() => {
    radar.load();
    firsat.load();
    syncBackgroundTask().catch(() => {});
    const tick = () => { if (AppState.currentState === 'active' && marketOpen()) checkOpenPositions().catch(() => {}); };
    const id = setInterval(tick, 120000);
    const sub = AppState.addEventListener('change', s => { if (s === 'active') { tick(); syncBackgroundTask().catch(() => {}); } });
    return () => { clearInterval(id); sub.remove(); };
  }, []);
  // Tazelik göstergesi: beklenen tarama aralıkları (sahip başına; etkin = en kısa). Ayar değişimi ≤ 60 sn'de yansır.
  useEffect(() => {
    const sync = () => {
      const r = radar.get().settings.auto, f = firsat.get();
      setExpected('news', r ? RADAR_EVERY_MS : null, 'radar');
      setExpected('quotes', r ? RADAR_EVERY_MS : null, 'radar');
      setExpected('quotes', f.settings.tickers.length ? f.settings.intervalMin * 60000 : null, 'firsat');
    };
    sync();
    const id = setInterval(sync, 60000);
    return () => clearInterval(id);
  }, []);
  // Radar: seans içinde 5 dk'da bir tara (ayarlardan kapatılabilir)
  useEffect(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active' && marketOpen() && radar.get().settings.auto) {
        nextRefresh('news', Date.now() + RADAR_EVERY_MS);
        runRadarScan().catch(() => {});
      }
    }, RADAR_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  // SEC 8-K / Form 4: günde 1 — açılışta ve öne gelince; 24 sa dolmadıysa pollSecNews atlar (secUa yoksa da)
  useEffect(() => {
    const run = () => { radar.load().then(() => (radar.get().settings.auto ? pollSecNews() : 0)).catch(() => {}); };
    run();
    const sub = AppState.addEventListener('change', s => { if (s === 'active') run(); });
    return () => sub.remove();
  }, []);
  // Fırsat taraması: seans içinde ve uygulama açıkken, ayarlanan aralıkta (varsayılan 2 dk; kontrol dakikada bir)
  useEffect(() => {
    const id = setInterval(() => {
      const f = firsat.get();
      // Açık kâğıt pozisyon varken risk izleyicisi için her dakika; değilse ayarlanan aralık
      const every = f.paper?.position ? 1 : f.settings.intervalMin;
      const due = !f.lastScan || Date.now() - f.lastScan >= every * 60000;
      if (AppState.currentState === 'active' && marketOpen() && f.settings.tickers.length && due) {
        nextRefresh('quotes', Date.now() + every * 60000);
        runSignalScan().catch(() => {});
      }
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const go = (t: Tab) => {
    tap(); setTab(t); setSeen(p => p[t] ? p : { ...p, [t]: true });
    if (t === 'radar' && marketOpen() && radar.get().settings.auto && (!radar.get().lastScan || Date.now() - (radar.get().lastScan ?? 0) > RADAR_EVERY_MS)) runRadarScan().catch(() => {});
  };
  // Web: masaüstü tarayıcıda içerik ortada, en çok WEB_MAX genişlikte (telefonda değişmez)
  const webFrame = Platform.OS === 'web' ? { width: '100%' as const, maxWidth: WEB_MAX, alignSelf: 'center' as const } : null;
  return (
    <View style={{ flex: 1, backgroundColor: C.bg, ...webFrame }}>
      {/* Ekranlar bir kez açıldıktan sonra bağlı kalır (durum korunur) */}
      <View style={{ flex: 1, display: tab === 'calc' ? 'flex' : 'none' }}><Calc key={calcKey} /></View>
      {seen.radar ? <View style={{ flex: 1, display: tab === 'radar' ? 'flex' : 'none' }}><Radar onOpenCalc={() => { setCalcKey(k => k + 1); go('calc'); }} /></View> : null}
      {seen.firsat ? <View style={{ flex: 1, display: tab === 'firsat' ? 'flex' : 'none' }}><Firsat /></View> : null}
      {seen.odte ? <View style={{ flex: 1, display: tab === 'odte' ? 'flex' : 'none' }}><Odte active={tab === 'odte'} onJournal={() => { setMenuStart('journal'); setMenuKey(k => k + 1); go('menu'); }} /></View> : null}
      {seen.akis ? <View style={{ flex: 1, display: tab === 'akis' ? 'flex' : 'none' }}><Akis active={tab === 'akis'} /></View> : null}
      {seen.menu ? <View style={{ flex: 1, display: tab === 'menu' ? 'flex' : 'none' }}><Menu key={menuKey} active={tab === 'menu'} start={menuStart} /></View> : null}
      <View style={{ flexDirection: 'row', backgroundColor: '#0d1426', borderTopWidth: 0.5, borderTopColor: C.border, paddingBottom: insets.bottom }}>
        {TABS.map(([id, icon, label]) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => go(id)} accessibilityRole="tab" accessibilityState={{ selected: on }}
              style={({ pressed }) => ({ flex: 1, minHeight: 60, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1 })}>
              <Text style={{ fontSize: 20, color: on ? C.blue : C.muted }}>{icon}</Text>
              <Text style={{ fontSize: 13, fontWeight: on ? '800' : '600', color: on ? C.text : C.muted, marginTop: 2 }}>{label}</Text>
              {on ? <View style={{ position: 'absolute', top: 0, width: 36, height: 3, borderRadius: 2, backgroundColor: C.accent }} /> : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
