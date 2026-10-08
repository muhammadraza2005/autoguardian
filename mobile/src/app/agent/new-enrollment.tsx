import { runtime } from '@/config/runtime';
import EnrollmentScreen from '@/features/enrollment/EnrollmentScreen';
import EnrollmentWizardScreen from '@/features/enrollment/EnrollmentWizardScreen';
export default function NewEnrollment(){return runtime.isDemo?<EnrollmentScreen/>:<EnrollmentWizardScreen/>;}
