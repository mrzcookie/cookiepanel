import { fileURLToPath } from "node:url";

import { createJiti } from "jiti";
import type { NextConfig } from "next";

const jiti = createJiti(fileURLToPath(import.meta.url));
jiti.esmResolve("./src/lib/server/env.ts");

const nextConfig: NextConfig = {
	reactCompiler: true,
};

export default nextConfig;
