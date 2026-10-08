import { runtime } from '@/config/runtime';
import { EnrollmentListScreen } from '@/features/enrollment/AgentLists';
import { EnrollmentDraftList } from '@/features/enrollment/LiveDraftScreens';
export default function Enrollments(){return runtime.isDemo?<EnrollmentListScreen/>:<EnrollmentDraftList embedded/>;}
