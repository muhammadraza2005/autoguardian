import PhoneAccessScreen from '@/features/auth/PhoneAccessScreen';
import LivePhoneScreen from '@/features/auth/LivePhoneScreen';
import {runtime} from '@/config/runtime';
export default function VerifyOtpScreen() { return runtime.isDemo?<PhoneAccessScreen initialStep={2}/>:<LivePhoneScreen/>; }
