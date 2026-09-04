import { Injectable, NotFoundException } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import { AppApiCollector } from './collectors/app-api.collector';
import type { Collector } from './collectors/collector.types';
import { CrawlerCollector } from './collectors/crawler.collector';
import { DatabaseCollector } from './collectors/database.collector';
import { MqttCollector } from './collectors/mqtt.collector';

/**
 * Resolves a source type to its adapter.
 *
 * MQTT is registered like any other collector even though the broker is
 * optional: asking for it when no broker is running produces a clear failure
 * from the collector itself rather than an unregistered-type error, and nothing
 * else in the platform changes shape depending on whether MQTT is enabled.
 */
@Injectable()
export class CollectorRegistry {
  private readonly collectors: ReadonlyMap<SourceType, Collector>;

  constructor(
    appApi: AppApiCollector,
    crawler: CrawlerCollector,
    database: DatabaseCollector,
    mqtt: MqttCollector,
  ) {
    this.collectors = new Map<SourceType, Collector>([
      [SourceType.APPLICATION_API, appApi],
      [SourceType.CRAWLER, crawler],
      [SourceType.DATABASE, database],
      [SourceType.MQTT, mqtt],
    ]);
  }

  get(type: SourceType): Collector {
    const collector = this.collectors.get(type);
    if (!collector) {
      throw new NotFoundException(`no collector is registered for source type ${type}`);
    }
    return collector;
  }
}
