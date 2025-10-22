import { defineConfig } from 'drizzle-kit';

const isLocal = process.env.ENVIRONMENT === 'development';

const prodCredentials = {
  driver: "d1-http",
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: process.env.CLOUDFLARE_DATABASE_ID!,
    token: process.env.CLOUDFLARE_D1_TOKEN!,
  },
};

const devCredentials = {
  dbCredentials: {
    url: process.env.LOCAL_DB_PATH!,  // path to local sqlite for D1-emulation
  },
};

export default defineConfig({
  schema: './src/services/database/schema.ts',
  out: './database/migrations',
  dialect: 'sqlite',
  ...(isLocal ? devCredentials : prodCredentials),
});
