import 'reflect-metadata';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { loadConfig } from './config';
import { RedisIoAdapter } from './realtime/redis-io.adapter';

/** Loads the repo-level .env for local runs; containers receive variables directly. */
function loadDotEnv() {
  for (const file of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
    if (existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

async function bootstrap() {
  loadDotEnv();
  const config = loadConfig();
  const app = await NestFactory.create(AppModule.forRoot({ config }), {
    cors: { origin: config.corsOrigins, credentials: true },
  });
  app.setGlobalPrefix('api');
  app.enableShutdownHooks();
  if (config.redisUrl) {
    const adapter = new RedisIoAdapter(app, config.redisUrl);
    await adapter.connect();
    app.useWebSocketAdapter(adapter);
  }
  await app.listen(config.port, '0.0.0.0');
  Logger.log(`API listening on :${config.port} (${config.nodeEnv})`, 'Bootstrap');
}

void bootstrap();
