import { z } from 'zod';

export const vehicleIdSchema = z.uuid();
export const ownedVehicleSchema = z.object({
  id: vehicleIdSchema,
  chassisIdentifier: z.string().min(1), plate: z.string().nullable(), category: z.string(),
  make: z.string().nullable(), model: z.string().nullable(),
  manufactureYear: z.number().int().nullable(), color: z.string().nullable(),
  saleStatus: z.enum(['NOT_FOR_SALE', 'FOR_SALE', 'AGENT_SALE', 'REPORTED_MISSING']),
  recordStatus: z.enum(['PENDING_REVIEW', 'ACTIVE', 'SUSPENDED_UNPAID', 'BLOCKED', 'ARCHIVED']),
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), ownedSince: z.iso.datetime(),
});
export type OwnedVehicle = z.infer<typeof ownedVehicleSchema>;
const pageSchema = z.object({ items: z.array(ownedVehicleSchema).max(20), nextCursor: vehicleIdSchema.nullable() });
type ReadRequest = (path: string, options: { signal?: AbortSignal }) => Promise<unknown>;

export async function readVehiclePage(request: ReadRequest, cursor?: string, signal?: AbortSignal) {
  const suffix = cursor ? '&cursor=' + vehicleIdSchema.parse(cursor) : '';
  const page = pageSchema.parse(await request('/v1/me/vehicles?limit=20' + suffix, { signal }));
  // A broken cursor must not cause repeated pages or an endless load-more loop.
  if (page.nextCursor && (page.nextCursor === cursor || page.nextCursor !== page.items.at(-1)?.id)) {
    throw new Error('Invalid vehicle page.');
  }
  return page;
}
export async function readVehicleDetail(request: ReadRequest, id: string, signal?: AbortSignal) {
  const safeId = vehicleIdSchema.parse(id).toLowerCase();
  const result = z.object({ vehicle: ownedVehicleSchema }).parse(await request('/v1/me/vehicles/' + safeId, { signal }));
  if (result.vehicle.id.toLowerCase() !== safeId) throw new Error('Unexpected vehicle.');
  return result.vehicle;
}
