import { existsSync } from 'node:fs';
import { defineConfig, env } from 'prisma/config';

/**
 * Prisma 7 no longer reads .env implicitly, so load it here before the
 * datasource URL is resolved. Inside Docker the variables are already present
 * in the process environment and no .env file exists, which is why a missing
 * file is not an error.
 *
 * Paths are relative to the working directory the CLI runs in, which is this
 * package; the repository root holds the single shared .env.
 */
for (const candidate of ['.env', '../../.env']) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
