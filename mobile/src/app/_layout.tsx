import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '@/providers/AppProviders';
import { colors } from '@/theme/tokens';
import { useFonts } from 'expo-font';
import { View, Platform, NativeModules } from 'react-native';

// Defensive stub: Ensure NativeModules.DevSettings is safely handled in standalone release builds
if (NativeModules && !NativeModules.DevSettings) {
  (NativeModules as Record<string, unknown>).DevSettings = {
    reload: () => {},
    addMenuItem: () => {},
  };
}

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
        <Stack.Screen name="billing" options={{headerShown:false}}/>
        <Stack.Screen name="pilot-administration" options={{headerShown:false}}/>
        <Stack.Screen name="registration-reviews" options={{headerShown:false}}/>
        <Stack.Screen name="staff-security" options={{ headerShown: false }} />
        <Stack.Screen name="registration-consents" options={{ headerShown: false }} />
        <Stack.Screen name="live-vehicles" options={{ headerShown: false }} />
        <Stack.Screen name="live-checks" options={{headerShown:false}}/>
        <Stack.Screen name="staff-sign-in" options={{headerShown:false}}/>
        <Stack.Screen name="live-enrollments" options={{ headerShown: false }} />
        <Stack.Screen name="permission-denied" options={{ title: 'AutoGuardian' }} />
      </Stack>
      </View>
      </View>
    </AppProviders>
  );
}
