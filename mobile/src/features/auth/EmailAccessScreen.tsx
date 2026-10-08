import { useState } from 'react';
import { TextInput, View } from 'react-native';
import { Redirect } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { AppHeader, StitchPage, Heading, Copy, Card, Label, Action, Notice, stitchStyles } from '@/components/ui/Stitch';
import { useSession } from './SessionProvider';
import { runtime } from '@/config/runtime';
import { connectedAgentRoute } from '@/features/enrollment/wizard';

export default function EmailAccessScreen() {
  const { t } = useTranslation();
  const { session, profile, loading, error, signInWithEmail, refreshProfile } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (session?.source === 'server') return <Redirect href={connectedAgentRoute(runtime.developmentEmailAuth, profile)} />;
  async function submit() {
    setBusy(true); setFailed(false);
    try { await signInWithEmail(email, password); setPassword(''); }
    catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <View style={{ flex: 1 }}><AppHeader /><StitchPage><Heading>{t('devAuth.title')}</Heading>
    <Notice>{t('devAuth.description')}</Notice>
    <Card><Label>{t('devAuth.email')}</Label>
      <TextInput accessibilityLabel={t('devAuth.email')} style={stitchStyles.input} value={email}
        onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address"
        autoComplete="email" editable={!busy && !loading} />
      <Label>{t('devAuth.password')}</Label>
      <TextInput accessibilityLabel={t('devAuth.password')} style={stitchStyles.input} value={password}
        onChangeText={setPassword} secureTextEntry autoCapitalize="none" autoCorrect={false}
        autoComplete="current-password" editable={!busy && !loading} />
      <Action label={busy || loading ? t('devAuth.working') : t('devAuth.signIn')}
        disabled={busy || loading || !email.trim() || !password} onPress={() => void submit()} />
    </Card>
    {failed && <Notice tone="danger">{t('devAuth.failed')}</Notice>}
    {error && <><Copy>{t('devAuth.profileError')}</Copy><Action secondary label={t('devAuth.retry')} onPress={refreshProfile} /></>}
  </StitchPage></View>;
}
