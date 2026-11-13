import { useEffect, useState } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Calc from '@/screens/Calc';
import Odte from '@/screens/Odte';
import Journal from '@/screens/Journal';
import Radar from '@/screens/Radar';
import { tap } from '@/ui/controls';
import { C } from '@/ui/theme';
import { checkOpenPositions, syncBackgroundTask } from '@/ui/monitor';
import { radar } from '@/ui/radarStore';
import { runRadarScan } from '@/ui/radarScan';
import { firsat } from '@/ui/firsatStore';
import { runSignalScan } from '@/ui/signalScan';
import { marketOpen } from '@/lib/usmarket';

type Tab = 'calc' | 'radar' | 'odte' | 'journal';
const TABS: [Tab, string, string][] = [['calc', '∑', 'Hesapla'], ['radar', '◎', 'Radar'], ['odte', '⚡', '0DTE'], ['journal', '☰', 'Geçmiş']];
const RADAR_EVERY_MS = 5 * 60000;

export default function Home() {
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('calc');
  // 0DTE ekranı baştan bağlı: bildirimler açıksa sinyal taraması diğer sekmelerdeyken de sürer
  const [seen, setSeen] = useState<Record<Tab, boolean>>({ calc: true, radar: false, odte: true, journal: false });
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
  // Radar: seans içinde 5 dk'da bir tara (ayarlardan kapatılabilir)
  useEffect(() => {
    const id = setInterval(() => {
      if (AppState.currentState === 'active' && marketOpen() && radar.get().settings.auto) runRadarScan().catch(() => {});
    }, RADAR_EVERY_MS);
    return () => clearInterval(id);
  }, []);
  // Fırsat taraması: seans içinde ve uygulama açıkken, ayarlanan aralıkta (varsayılan 2 dk; kontrol dakikada bir)
  useEffect(() => {
    const id = setInterval(() => {
      const f = firsat.get();
      const due = !f.lastScan || Date.now() - f.lastScan >= f.settings.intervalMin * 60000;
      if (AppState.currentState === 'active' && marketOpen() && f.settings.tickers.length && due) runSignalScan().catch(() => {});
    }, 60000);
    return () => clearInterval(id);
  }, []);
  const go = (t: Tab) => {
    tap(); setTab(t); setSeen(p => p[t] ? p : { ...p, [t]: true });
    if (t === 'radar' && marketOpen() && radar.get().settings.auto && (!radar.get().lastScan || Date.now() - (radar.get().lastScan ?? 0) > RADAR_EVERY_MS)) runRadarScan().catch(() => {});
  };
  return (
    <View style={{ flex: 1, backgroundColor: C.bg }}>
      {/* Ekranlar bir kez açıldıktan sonra bağlı kalır (durum korunur) */}
      <View style={{ flex: 1, display: tab === 'calc' ? 'flex' : 'none' }}><Calc key={calcKey} /></View>
      {seen.radar ? <View style={{ flex: 1, display: tab === 'radar' ? 'flex' : 'none' }}><Radar onOpenCalc={() => { setCalcKey(k => k + 1); go('calc'); }} /></View> : null}
      {seen.odte ? <View style={{ flex: 1, display: tab === 'odte' ? 'flex' : 'none' }}><Odte active={tab === 'odte'} onJournal={() => go('journal')} /></View> : null}
      {seen.journal ? <View style={{ flex: 1, display: tab === 'journal' ? 'flex' : 'none' }}><Journal active={tab === 'journal'} /></View> : null}
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
