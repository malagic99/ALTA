import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function RootLayout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: '#0B1020' },
          headerTintColor: '#F1F5FF',
          contentStyle: { backgroundColor: '#0B1020' },
        }}
      >
        <Stack.Screen name="index" options={{ title: 'Marko · Dark Skies' }} />
      </Stack>
    </GestureHandlerRootView>
  );
}
