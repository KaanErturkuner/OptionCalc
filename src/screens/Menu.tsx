/* Menü sekmesi: alt ekran kartları. Yeni özellik = CARDS dizisine bir kart + SCREENS'e bir render satırı. */
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Journal from '@/screens/Journal';
import Watchlist from '@/screens/Watchlist';
import Raporlar from '@/screens/Raporlar';
import Koc from '@/screens/Koc';
import Haberler from '@/screens/Haberler';
import Bilanco from '@/screens/Bilanco';
import KorkuAcgozluluk from '@/screens/KorkuAcgozluluk';
import { useWatch } from '@/ui/watchStore';
import { Btn, tap } from '@/ui/controls';
import { C } from '@/ui/theme';

export type CardId = 'journal' | 'watch' | 'reports' | 'coach' | 'news' | 'earnings' | 'sentiment';
interface MenuCard { id: CardId; icon: string; title: string; desc: (ctx: { watchCount: number }) => string }

/** Kart kaydı: sıra = ekranda görünen sıra */
const CARDS: MenuCard[] = [
  { id: 'journal', icon: '☰', title: 'Geçmiş', desc: () => 'İşlem günlüğü, sinyal kayıtları, açık pozisyonlar' },
  { id: 'watch', icon: '★', title: 'Takip Listesi', desc: ({ watchCount }) => `Hesapla'dan eklenen opsiyonlar · ${watchCount} kalem` },
  { id: 'reports', icon: '▤', title: 'Raporlar', desc: () => 'Piyasa öncesi, açılış +30 dk / +1,5 / +2,5 sa, gün sonu' },
  { id: 'coach', icon: '✎', title: 'Koç', desc: () => 'Midas ekran görüntüsü → işlem geri bildirimi ve günlük karne' },
  { id: 'news', icon: '▦', title: 'Haberler', desc: () => 'Takip listesi haberleri, çok kaynaklı, Türkçe başlıklar' },
  { id: 'sentiment', icon: '◐', title: 'Korku ve Açgözlülük', desc: () => 'Piyasa duygu ölçeği (0–100): VIX, SPY momentumu, güvenli liman, tahvil talebi' },
  { id: 'earnings', icon: '▣', title: 'Bilanço takvimi', desc: () => 'Hangi gün hangi şirket bilanço açıklıyor · beklenti, haber, zincir, akış' },
];

export default function Menu({ active, start = null }: { active: boolean; start?: CardId | null }) {
  const insets = useSafeAreaInsets();
  const { items } = useWatch();
  const [open, setOpen] = useState<CardId | null>(start);
  const back = () => { tap(); setOpen(null); };
  const SCREENS: Record<CardId, ReactNode> = {
    journal: <Journal active={active && open === 'journal'} />,
    watch: <Watchlist active={active && open === 'watch'} onBack={back} />,
    reports: <Raporlar active={active && open === 'reports'} onBack={back} />,
    coach: <Koc active={active && open === 'coach'} onBack={back} />,
    news: <Haberler active={active && open === 'news'} onBack={back} />,
    earnings: <Bilanco active={active && open === 'earnings'} onBack={back} />,
    sentiment: <KorkuAcgozluluk active={active && open === 'sentiment'} onBack={back} />,
  };

  if (open) {
    const card = CARDS.find(c => c.id === open)!;
    return (
      <View style={{ flex: 1 }}>
        {open === 'journal' ? (
          <View style={{ paddingTop: insets.top + 4, paddingHorizontal: 16, paddingBottom: 6, backgroundColor: 'rgba(10,15,28,.97)' }}>
            <Btn label={`‹ Menü · ${card.title}`} onPress={back} style={{ alignSelf: 'flex-start', minHeight: 36 }} />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>{SCREENS[open]}</View>
      </View>
    );
  }

  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingTop: insets.top + 12, paddingHorizontal: 14, paddingBottom: 30, gap: 12 }}>
      <Text style={{ color: C.text, fontSize: 24, fontWeight: '800', marginBottom: 4 }}>Menü</Text>
      {CARDS.map(c => (
        <Pressable key={c.id} onPress={() => { tap(); setOpen(c.id); }} accessibilityRole="button"
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16, borderRadius: 18, backgroundColor: C.card, borderWidth: 0.5, borderColor: C.border, opacity: pressed ? 0.6 : 1 })}>
          <View style={{ width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.accentSoft }}>
            <Text style={{ fontSize: 22, color: C.blue }}>{c.icon}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color: C.text, fontSize: 17, fontWeight: '700' }}>{c.title}</Text>
            <Text style={{ color: C.muted, fontSize: 13, marginTop: 2 }}>{c.desc({ watchCount: items.length })}</Text>
          </View>
          <Text style={{ color: C.muted, fontSize: 22 }}>›</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
