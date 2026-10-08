import AccountScreen from '@/features/auth/AccountScreen';
import LiveAccount from '@/features/auth/LiveAccountScreen';
import { runtime } from '@/config/runtime';
export default function SectionAccountScreen() { return runtime.isDemo?<AccountScreen section='agent' />:<LiveAccount embedded/>; }
