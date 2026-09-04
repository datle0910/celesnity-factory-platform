import { Injectable } from '@nestjs/common';
import { SourceType } from '@prisma/client';
import mqtt, { type MqttClient } from 'mqtt';
import { parseStation } from '../../domain/stations';
import {
  DEFAULTS,
  type CollectedRecord,
  type Collector,
  type CollectorContext,
  type CollectionError,
  type CollectionOutcome,
  type DiscoveryResult,
  type MqttSourceConfig,
  type TestResult,
} from './collector.types';
import { asDate, asInteger, asString, inferFields } from './parse';

/**
 * Optional collector for machine telemetry.
 *
 * Collection here is manual, like every other source, but MQTT is a stream
 * rather than something that can be requested. Rather than hold a subscription
 * open between runs and buffer indefinitely, a run subscribes, listens for a
 * short window, and disconnects. Retained messages arrive as soon as the
 * subscription is established, so the latest reading per machine is always
 * captured even though the window is brief.
 *
 * The trade-off is that readings published between runs are lost unless the
 * publisher retains them. That is the right trade for telemetry, which is
 * corroborating detail rather than the factory's record of what was completed:
 * the production database remains authoritative for washing and drying, and
 * every required behaviour works with no broker running at all.
 */

const DEFAULT_LISTEN_WINDOW_MS = 3_000;
const CONNECT_TIMEOUT_MS = 4_000;

interface TelemetryMessage {
  topic: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class MqttCollector implements Collector {
  readonly type = SourceType.MQTT;

  async test(context: CollectorContext): Promise<TestResult> {
    const config = readConfig(context);

    try {
      const client = await this.connect(config, context.credential);
      client.end(true);
      return { ok: true, message: `broker reachable at ${config.brokerUrl}` };
    } catch (error) {
      return {
        ok: false,
        message: error instanceof Error ? error.message : 'could not reach the broker',
      };
    }
  }

  async discover(context: CollectorContext): Promise<DiscoveryResult> {
    const config = readConfig(context);
    const messages = await this.listen(config, context.credential, DEFAULT_LISTEN_WINDOW_MS);

    const topics = [...new Set(messages.map((message) => message.topic))].sort();

    return {
      selectionKind: 'TOPICS',
      datasets: topics.map((topic) => ({
        name: topic,
        label: topic,
        recordCount: messages.filter((message) => message.topic === topic).length,
        fields: inferFields(messages.find((message) => message.topic === topic)?.payload),
      })),
      notes:
        topics.length === 0
          ? [`No retained messages arrived on ${config.topicFilter} within the listening window.`]
          : [`Observed over a ${DEFAULT_LISTEN_WINDOW_MS}ms window on ${config.topicFilter}.`],
    };
  }

  async collect(context: CollectorContext): Promise<CollectionOutcome> {
    const config = readConfig(context);
    const errors: CollectionError[] = [];
    const records: CollectedRecord[] = [];

    const messages = await this.listen(config, context.credential, DEFAULT_LISTEN_WINDOW_MS);

    for (const message of messages) {
      records.push(toRecord(message, errors));
    }

    return {
      records,
      errors,
      stats: {
        brokerUrl: config.brokerUrl,
        topicFilter: config.topicFilter,
        listenWindowMs: DEFAULT_LISTEN_WINDOW_MS,
        messagesReceived: messages.length,
        topics: [...new Set(messages.map((message) => message.topic))],
      },
    };
  }

  private connect(config: MqttSourceConfig, credential: string | null): Promise<MqttClient> {
    return new Promise((resolve, reject) => {
      const client = mqtt.connect(config.brokerUrl, {
        username: config.username,
        password: credential ?? undefined,
        connectTimeout: CONNECT_TIMEOUT_MS,
        // A collection run is a one-shot operation; reconnecting would keep the
        // run open long after the broker has been shown to be unreachable.
        reconnectPeriod: 0,
      });

      const fail = (error: Error) => {
        client.end(true);
        reject(new Error(`could not connect to ${config.brokerUrl}: ${error.message}`));
      };

      client.once('connect', () => resolve(client));
      client.once('error', fail);
      client.once('close', () => reject(new Error(`connection to ${config.brokerUrl} closed before it was established`)));
    });
  }

  private async listen(
    config: MqttSourceConfig,
    credential: string | null,
    windowMs: number,
  ): Promise<TelemetryMessage[]> {
    const client = await this.connect(config, credential);
    const limit = config.bufferLimit ?? DEFAULTS.bufferLimit;
    const messages: TelemetryMessage[] = [];

    return new Promise((resolve, reject) => {
      const finish = () => {
        clearTimeout(timer);
        client.end(true);
        resolve(messages);
      };

      const timer = setTimeout(finish, windowMs);

      client.on('message', (topic, payload) => {
        try {
          messages.push({ topic, payload: JSON.parse(payload.toString()) as Record<string, unknown> });
        } catch {
          // Keeps the raw text so an unparseable payload is still auditable.
          messages.push({ topic, payload: { raw: payload.toString() } });
        }

        if (messages.length >= limit) {
          finish();
        }
      });

      client.subscribe(config.topicFilter, { qos: 1 }, (error) => {
        if (error) {
          clearTimeout(timer);
          client.end(true);
          reject(new Error(`could not subscribe to ${config.topicFilter}: ${error.message}`));
        }
      });
    });
  }
}

function toRecord(message: TelemetryMessage, errors: CollectionError[]): CollectedRecord {
  const payload = { ...message.payload, topic: message.topic };
  const readingId = asString(message.payload.readingId);
  const sourceRecordId = readingId ?? `${message.topic}:${String(message.payload.occurredAt ?? '')}`;
  const base = { kind: 'OPERATIONAL_EVENT' as const, dataset: message.topic, sourceRecordId, payload };

  const reject = (reason: string): CollectedRecord => {
    errors.push({ stage: 'parse', message: reason, context: { topic: message.topic, sourceRecordId } });
    return { ...base, parseError: reason };
  };

  const batchId = asString(message.payload.batchId);
  if (!batchId) {
    return reject(`telemetry on ${message.topic} carries no batch reference`);
  }

  const station = parseStation(message.payload.station);
  if (!station) {
    return reject(`telemetry on ${message.topic} has an unrecognised station`);
  }

  const occurredAt = asDate(message.payload.occurredAt);
  if (!occurredAt) {
    return reject(`telemetry on ${message.topic} has an unreadable timestamp`);
  }

  return {
    ...base,
    batchId,
    station,
    quantity: asInteger(message.payload.quantity),
    occurredAt,
  };
}

function readConfig(context: CollectorContext): MqttSourceConfig {
  const config = context.source.config as unknown as MqttSourceConfig;
  if (!config?.brokerUrl || !config?.topicFilter) {
    throw new Error('MQTT source is missing brokerUrl or topicFilter');
  }
  return config;
}
