import { runtime } from '@/config/runtime';
import { SealStockScreen } from '@/features/enrollment/AgentLists';
import { DevelopmentSealStock } from '@/features/enrollment/LiveSealScreens';
export default function SealStock(){return runtime.isDemo?<SealStockScreen/>:<DevelopmentSealStock embedded/>;}
