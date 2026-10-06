import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '@/providers/AppProviders';
import { colors } from '@/theme/tokens';
import { useFonts } from 'expo-font';
import { View, Platform } from 'react-native';

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    'PublicSans-Regular': require('../../assets/fonts/PublicSans-Regular.ttf'),
    'PublicSans-SemiBold': require('../../assets/fonts/PublicSans-SemiBold.ttf'),
    'PublicSans-Bold': require('../../assets/fonts/PublicSans-Bold.ttf'),
  });
  if (!fontsLoaded && !fontError) return null;
  return (
    <AppProviders>
      <View style={{flex:1, backgroundColor:colors.surface, alignItems:'center'}}>
      <View style={{flex:1, width:'100%', maxWidth:Platform.OS === 'web' ? 390 : undefined, backgroundColor:colors.background}}>
      <StatusBar style="light" />
      <Stack screenOptions={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.primary }}>
        <Stack.Screen name="index" options={{ headerShown: false }} />
        <Stack.Screen name="(auth)" options={{ headerShown: false }} />
        <Stack.Screen name="(consumer)" options={{ headerShown: false }} />
        <Stack.Screen name="agent" options={{ headerShown: false }} />
        <Stack.Screen name="institutional" options={{ headerShown: false }} />
        <Stack.Screen name="administration" options={{ headerShown: false }} />
        <Stack.Screen name="welcome" options={{ headerShown: false }} />
        <Stack.Screen name="live-account" options={{ headerShown: false }} />
        <Stack.Screen name="live-vehicles" options={{ headerShown: false }} />
        <Stack.Screen name="live-enrollments" options={{ headerShown: false }} />
        <Stack.Screen name="permission-denied" options={{ title: 'AutoGuardian' }} />
      </Stack>
      </View>
      </View>
    </AppProviders>
  );
}
