import { z } from 'zod';
import type { SessionView } from './access';

export const profileSchema = z.object({
  id: z.uuid(), tenantId: z.uuid(), preferredLanguage: z.enum(['en', 'fr']),
  roles: z.array(z.object({ code: z.string(), organizationId: z.uuid().nullable() })),
});
export type AccountProfile = z.infer<typeof profileSchema>;

export function profileSession(profile: AccountProfile): SessionView {
  // Privileged sections require their own workflows and step-up checks later.
  const consumer = profile.roles.some(role => ['VERIFIER', 'OWNER', 'PRO_VERIFIER'].includes(role.code));
  return { source: 'server', subject: profile.id, sectionGrants: consumer ? ['consumer'] : [] };
}
