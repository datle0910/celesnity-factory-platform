import { Module } from '@nestjs/common';
import { NormalizationModule } from '../normalization/normalization.module';
import { CollectorRegistry } from './collector.registry';
import { AppApiCollector } from './collectors/app-api.collector';
import { CrawlerCollector } from './collectors/crawler.collector';
import { DatabaseCollector } from './collectors/database.collector';
import { MqttCollector } from './collectors/mqtt.collector';
import { CollectionController, SourcesController } from './sources.controller';
import { SourcesService } from './sources.service';

@Module({
  imports: [NormalizationModule],
  controllers: [SourcesController, CollectionController],
  providers: [
    SourcesService,
    CollectorRegistry,
    AppApiCollector,
    CrawlerCollector,
    DatabaseCollector,
    MqttCollector,
  ],
  exports: [SourcesService],
})
export class SourcesModule {}
