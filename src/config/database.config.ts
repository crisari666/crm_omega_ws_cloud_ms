import { registerAs } from '@nestjs/config';

export const databaseConfig = registerAs('database', () => {
  const username: string | undefined = process.env.DATABASE_USER;
  const databaseName: string | undefined = process.env.DATABASE_NAME;
  const password: string | undefined = process.env.DATABASE_PASS;
  const host: string | undefined = process.env.DATABASE_HOST;
  const port: string | undefined = process.env.DATABASE_PORT;

  const uri: string = `mongodb://${username}:${password}@${host}:${port}/${databaseName}`;

  return {
    uri,
  };
});

