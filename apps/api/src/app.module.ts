import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { HealthController } from './health.controller';
import { NormalizationModule } from './normalization/normalization.module';
import { ProductionModule } from './production/production.module';
import { SourcesModule } from './sources/sources.module';

@Module({
  imports: [CoreModule, NormalizationModule, SourcesModule, ProductionModule],
  controllers: [HealthController],
})
export class AppModule {}
