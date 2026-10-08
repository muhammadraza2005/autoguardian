import { z } from 'zod';

export const enrollmentSteps = ['vehicle', 'owner', 'documents', 'seals', 'review'] as const;
export type EnrollmentStep = typeof enrollmentSteps[number];
export function enrollmentRoute(step: EnrollmentStep = 'vehicle', id?: string) {
  if (id !== undefined) z.uuid().parse(id);
  return { pathname: '/agent/new-enrollment' as const, params: { step, id: id ?? 'new' } };
}
export function wizardParams(id: unknown, step: unknown) {
  const validId = id === undefined || id === 'new' ? undefined : z.uuid().safeParse(id);
  const validStep = step === undefined ? undefined : z.enum(enrollmentSteps).safeParse(step);
  return {
    id: validId?.success ? validId.data : undefined,
    step: validStep?.success ? validStep.data : 'vehicle' as EnrollmentStep,
    invalid: Boolean((validId && !validId.success) || (validStep && !validStep.success)),
  };
}
// This opens only the development workflow. It does not grant production agent access.
export function developmentAgentAllowed(development: boolean, profile: { roles: { code: string; organizationId: string | null }[] } | null) {
  return development && Boolean(profile?.roles.some(r => r.code === 'ENROLLMENT_AGENT' && z.uuid().safeParse(r.organizationId).success));
}
export function connectedAgentRoute(development: boolean, profile: Parameters<typeof developmentAgentAllowed>[1], page: 'home' | 'account' = 'home') {
  if (!developmentAgentAllowed(development, profile)) return '/live-account' as const;
  return page === 'account' ? '/agent/account' as const : '/agent' as const;
}
export function savedWizardSteps(checks: { code: string; status: string }[]) {
  const complete = (code: string) => checks.some(c => c.code === code && c.status === 'COMPLETE');
  return {
    vehicle: complete('VEHICLE_DRAFT') && complete('OWNER_SELECTION'),
    owner: complete('OWNER_DETAILS_SAMPLE') && complete('CONSENT_SAMPLE'),
    documents: ['IDENTITY_SAMPLE', 'REGISTRATION_SAMPLE', 'VEHICLE_PHOTO_SAMPLE'].every(complete),
    seals: complete('SEAL_FITTING'),
    // Reviewing the checklist is never a completed registration.
    review: false,
  };
}
