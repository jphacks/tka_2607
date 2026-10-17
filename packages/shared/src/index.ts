import { z } from "zod";

export const healthSchema = z.object({
  status: z.literal("ok"),
});
export type Health = z.infer<typeof healthSchema>;

export * from "./ai";
