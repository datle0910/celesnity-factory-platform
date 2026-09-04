import mqtt from 'mqtt';

/**
 * Optional telemetry publisher for the washing and drying machines.
 *
 * MQTT is an optional source, so nothing in the platform depends on this
 * process running. It publishes retained messages so that a collector which
 * subscribes later still receives the most recent reading per machine, and then
 * keeps emitting fresh readings on an interval.
 */

const BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const PUBLISH_INTERVAL_MS = Number(process.env.PUBLISH_INTERVAL_MS ?? 10_000);

interface MachineProfile {
  machineId: string;
  lineId: string;
  station: 'washing' | 'drying';
  batchId: string;
  quantity: number;
}

/**
 * Telemetry mirrors batches that the production database already reports, so
 * enabling MQTT adds machine-level detail to batches the platform already
 * knows about rather than inventing a parallel universe of data.
 */
const machines: MachineProfile[] = [
  { machineId: 'M-W02', lineId: 'LINE-A', station: 'washing', batchId: 'B-004', quantity: 75 },
  { machineId: 'M-W02', lineId: 'LINE-B', station: 'washing', batchId: 'B-007', quantity: 60 },
  { machineId: 'M-D02', lineId: 'LINE-A', station: 'drying', batchId: 'B-003', quantity: 120 },
  { machineId: 'M-D01', lineId: 'LINE-B', station: 'drying', batchId: 'B-009', quantity: 84 },
];

let sequence = 0;

function buildPayload(machine: MachineProfile): string {
  sequence += 1;
  const jitter = (spread: number) => Math.round((Math.random() - 0.5) * spread * 10) / 10;

  return JSON.stringify({
    // A stable identifier per reading, so repeated deliveries of the same
    // message collapse to a single observation on the platform side.
    readingId: `MQTT-${machine.machineId}-${machine.batchId}-${sequence}`,
    batchId: machine.batchId,
    lineId: machine.lineId,
    station: machine.station,
    machineId: machine.machineId,
    quantity: machine.quantity,
    temperatureC: machine.station === 'washing' ? 60 + jitter(4) : 85 + jitter(6),
    drumRpm: machine.station === 'washing' ? 45 + Math.round(jitter(6)) : 30 + Math.round(jitter(4)),
    occurredAt: new Date().toISOString(),
  });
}

const client = mqtt.connect(BROKER_URL, {
  clientId: `celesnity-simulator-${process.pid}`,
  reconnectPeriod: 2_000,
});

client.on('connect', () => {
  console.log(`[mqtt-simulator] connected to ${BROKER_URL}`);
  publishAll();
  setInterval(publishAll, PUBLISH_INTERVAL_MS);
});

client.on('error', (error) => {
  console.error('[mqtt-simulator] connection error:', error.message);
});

function publishAll(): void {
  for (const machine of machines) {
    const topic = `factory/${machine.lineId.toLowerCase()}/${machine.station}/${machine.machineId}/telemetry`;
    client.publish(topic, buildPayload(machine), { qos: 1, retain: true });
  }
  console.log(`[mqtt-simulator] published ${machines.length} readings`);
}

const shutdown = () => {
  client.end(true, () => process.exit(0));
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
