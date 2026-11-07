import { z } from "zod";

const raw = z.object({
  APP_MODE: z.enum(["preview", "production"]).default("preview"),
  NEXT_PUBLIC_CHAIN_ID: z.coerce.number().int().positive().default(43113),
  NEXT_PUBLIC_PCP_ADDRESS: z.string().optional(),
  NEXT_PUBLIC_ESCROW_ADDRESS: z.string().optional(),
  SUPABASE_URL: z.string().optional(),
  SUPABASE_ANON_KEY: z.string().optional(),
});
export type AppConfig = z.infer<typeof raw>;

const addr = /^0x[0-9a-fA-F]{40}$/;

/** Production từ chối boot nếu thiếu cấu hình thật; không fallback sang mock. */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const cfg = raw.parse(env);
  if (cfg.APP_MODE === "production") {
    const missing: string[] = [];
    if (!cfg.SUPABASE_URL) missing.push("SUPABASE_URL");
    if (!cfg.SUPABASE_ANON_KEY) missing.push("SUPABASE_ANON_KEY");
    if (!cfg.NEXT_PUBLIC_PCP_ADDRESS || !addr.test(cfg.NEXT_PUBLIC_PCP_ADDRESS)) missing.push("NEXT_PUBLIC_PCP_ADDRESS");
    if (!cfg.NEXT_PUBLIC_ESCROW_ADDRESS || !addr.test(cfg.NEXT_PUBLIC_ESCROW_ADDRESS)) missing.push("NEXT_PUBLIC_ESCROW_ADDRESS");
    if (missing.length) throw new Error(`APP_MODE=production thiếu/sai cấu hình: ${missing.join(", ")}`);
  }
  return cfg;
}
