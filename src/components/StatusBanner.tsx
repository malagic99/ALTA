import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

type Props = { message: string; busy?: boolean; tone?: 'info' | 'error' };

export function StatusBanner({ message, busy, tone = 'info' }: Props) {
  return (
    <View style={[styles.banner, tone === 'error' && styles.error]}>
      {busy ? <ActivityIndicator color="#F1F5FF" /> : null}
      <Text style={styles.text}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    top: 12,
    left: 12,
    right: 12,
    backgroundColor: 'rgba(18, 26, 51, 0.92)',
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  error: { backgroundColor: 'rgba(120, 30, 30, 0.92)' },
  text: { color: '#F1F5FF', fontSize: 13, flex: 1 },
});
