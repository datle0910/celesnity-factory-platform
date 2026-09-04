import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'node:fs';
import { AppModule } from './app.module';
import { AppConfig } from './config/app-config';

/**
 * Environment is loaded explicitly before Nest builds the container, so that
 * configuration validation in AppConfig runs against the final environment
 * rather than a partially populated one. Inside Docker the variables are
 * already present and no .env file exists.
 */
function loadEnvironment(): void {
  for (const candidate of ['.env', '../../.env']) {
    if (existsSync(candidate)) {
      process.loadEnvFile(candidate);
      return;
    }
  }
}

async function bootstrap(): Promise<void> {
  loadEnvironment();

  const app = await NestFactory.create(AppModule);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // The operator interface is served from a different origin in every
  // deployment shape here, so it is allowed explicitly rather than by wildcard.
  app.enableCors({
    origin: [process.env.NEXT_PUBLIC_API_BASE_URL ?? '', 'http://localhost:3000'].filter(Boolean),
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Celesnity factory data platform')
      .setDescription(
        'Collection from factory data sources, normalisation into one traceable dataset, and production-line visibility.',
      )
      .setVersion('1.0')
      .build(),
  );
  SwaggerModule.setup('docs', app, document);

  const config = app.get(AppConfig);
  await app.listen(config.port, '0.0.0.0');

  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${config.port} (docs at /docs)`);
}

void bootstrap();
