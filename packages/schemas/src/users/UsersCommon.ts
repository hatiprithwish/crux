import { z } from "zod";

export enum UserRoleEnum {
  User = "user",
  Admin = "admin",
}

export const ZUserRoleEnum = z.enum(UserRoleEnum);

export interface UserBase {
  clerkId: string;
  email: string;
  role: UserRoleEnum;
}

export interface User extends UserBase {
  publicId: string;
  // DEV_NOTE: decides WHEN a reminder fires, never WHICH day's data a read/write lands on — see
  // DateTime.ts and architecture.md §4 invariant 4. IANA zone name, e.g. "Asia/Kolkata".
  tz: string;
  homeCurrency: string;
  createdAt: Date;
  updatedAt?: Date | null;
}
