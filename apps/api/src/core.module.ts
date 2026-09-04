import { Global, Module } from '@nestjs/common';
import { AppConfig } from './config/app-config';
import { SecretsService } from './config/secrets.service';
import { PrismaService } from './prisma/prisma.service';

/** Configuration, secret handling and database access, available everywhere. */
@Global()
@Module({
  providers: [AppConfig, SecretsService, PrismaService],
  exports: [AppConfig, SecretsService, PrismaService],
})
export class CoreModule {}
