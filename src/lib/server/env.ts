import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const serverEnv = createEnv({
	server: {
		DATABASE_URL: z.string(),
	},
	emptyStringAsUndefined: true,
	// biome-ignore lint: passing process.env is required for typesafe environment validation
	experimental__runtimeEnv: process.env,
});
