import { runtime } from '@/config/runtime';
import EmailAccessScreen from './EmailAccessScreen';
import PhoneAccessScreen from './PhoneAccessScreen';

export default function AuthEntry() {
  return runtime.developmentEmailAuth ? <EmailAccessScreen /> : <PhoneAccessScreen />;
}
