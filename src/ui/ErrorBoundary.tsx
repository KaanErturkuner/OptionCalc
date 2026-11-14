/* Kart düzeyinde hata sınırı: bir kartın render hatası tüm ekranı düşürmesin; yerine küçük "veri yok" kutusu gösterir. */
import { Component, type ReactNode } from 'react';
import { Text, View } from 'react-native';
import { C } from '@/ui/theme';

interface Props { children: ReactNode; label?: string }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: unknown) { console.warn('[ErrorBoundary]', this.props.label ?? '', error); }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <View style={{ borderRadius: 12, borderWidth: 0.5, borderColor: C.border, padding: 10 }}>
        <Text style={{ color: C.muted, fontSize: 12 }}>{this.props.label ? `${this.props.label}: veri yok` : 'veri yok'}</Text>
      </View>
    );
  }
}
