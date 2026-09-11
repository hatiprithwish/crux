import { z } from "zod";
import type { UserBase } from "./UsersCommon";

export type SyncClerkUserApiRequest = UserBase;

// DEV_NOTE: tz validity (a real IANA zone) is checked in UsersRepo via DateTime.isValidTimeZone,
// not here — the schemas package can't reach the backend's Intl-backed utils, and the picker only
// ever sends a value it read from that same Intl list, so this only guards against an empty string.
export const ZUpdateUserApiRequest = z
  .object({
    tz: z.string().min(1, "Timezone is required"),
    homeCurrency: z.string().min(1, "Currency is required"),
  })
  .partial()
  .strict()
  .refine((user) => Object.keys(user).length > 0, {
    message: "Provide at least one field to update",
  });
export type UpdateUserApiRequest = z.infer<typeof ZUpdateUserApiRequest>;
