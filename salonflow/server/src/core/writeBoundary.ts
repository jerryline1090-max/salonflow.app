import { z } from "zod";

// Runtime validation rejects Prisma operators and relation objects, not just
// unknown field names. Error text deliberately contains no submitted values.
export function parseWrite<T extends z.ZodTypeAny>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error("Invalid editable fields");
  return result.data;
}

const text = z.string();
const nullableText = text.nullable();
const integer = z.number().int().min(-2147483648).max(2147483647);
export const staffProfileUpdate = z.object({
  name: text, phone: nullableText, photoUrl: nullableText,
  skills: z.array(text), homeServiceEligible: z.boolean(),
  commissionPercent: z.number().finite().nullable(),
}).partial().strict();
export const serviceUpdate = z.object({
  name: text, description: nullableText, category: nullableText, imageUrl: nullableText,
  price: integer, durationMinutes: integer, bufferMinutes: integer,
  availableAtSalon: z.boolean(), availableAtHome: z.boolean(),
  homeTravelBufferMins: integer.nullable(), requiredSkills: z.array(text), isActive: z.boolean(),
}).partial().strict();
export const clientUpdate = z.object({
  name: text, phone: nullableText, email: nullableText, address: nullableText, notes: nullableText,
}).partial().strict();
export const knowledgeUpdate = z.object({ topic: text, question: nullableText, answer: text }).partial().strict();

const day = z.number().int().min(0).max(6);
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const businessHoursWrite = z.array(z.object({
  dayOfWeek: day, openTime: time, closeTime: time, isClosed: z.boolean(),
}).strict().refine((row) => row.isClosed || row.openTime < row.closeTime))
  .refine((rows) => new Set(rows.map((row) => row.dayOfWeek)).size === rows.length);
export const staffScheduleWrite = z.array(z.object({
  dayOfWeek: day, startTime: time, endTime: time, isOff: z.boolean().optional(),
}).strict());

export const businessSettingsUpdate = z.object({
  name: text, logoUrl: nullableText, description: nullableText, phone: nullableText,
  email: nullableText, address: nullableText, timezone: text,
  mode: z.enum(["SALON_ONLY", "HOME_ONLY", "BOTH"]),
  defaultBufferMinutes: integer, minBookingNoticeMins: integer, maxBookingHorizonDays: integer,
  homeServiceRadiusKm: z.number().finite().nullable(), homeServiceTravelBufferMins: integer,
  reputationEnabled: z.boolean(), reputationRequestDelayHours: integer,
  reputationHappyThreshold: integer, googleReviewUrl: nullableText,
}).partial().strict();
