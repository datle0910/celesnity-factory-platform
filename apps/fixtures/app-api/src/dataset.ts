/**
 * The internal application's view of the laundry.
 *
 * This fixture is the only source that knows how a batch maps onto a work order
 * and a production line, so every other source can be joined back to a line
 * through `batchId` alone.
 *
 * Timestamps are relative to process start so the demo always shows a live
 * floor. The offsets are shared with the supplier portal fixture and the
 * production database seed; see README "Sample data" for the full matrix.
 */

const STARTED_AT = Date.now();

const minutesAgo = (minutes: number): string =>
  new Date(STARTED_AT - minutes * 60_000).toISOString();

const hoursFromNow = (hours: number): string =>
  new Date(STARTED_AT + hours * 3_600_000).toISOString();

export interface WorkOrder {
  workOrderId: string;
  lineId: string;
  customer: string;
  dueAt: string;
  status: string;
}

export interface Batch {
  batchId: string;
  workOrderId: string;
  lineId: string;
  plannedQuantity: number;
  linenType: string;
}

export interface ReceivingRecord {
  receivingId: string;
  batchId: string;
  quantity: number;
  receivedAt: string;
  dockDoor: string;
}

export interface DispatchRecord {
  dispatchId: string;
  batchId: string;
  quantity: number;
  dispatchedAt: string;
  vehicle: string;
  signedBy: string;
}

export const workOrders: WorkOrder[] = [
  { workOrderId: 'WO-1001', lineId: 'LINE-A', customer: 'Grand Hotel Saigon', dueAt: hoursFromNow(6), status: 'RELEASED' },
  { workOrderId: 'WO-1002', lineId: 'LINE-A', customer: 'Riverside Resort', dueAt: hoursFromNow(8), status: 'RELEASED' },
  { workOrderId: 'WO-1003', lineId: 'LINE-B', customer: 'Metropole Hanoi', dueAt: hoursFromNow(5), status: 'RELEASED' },
  { workOrderId: 'WO-1004', lineId: 'LINE-B', customer: 'Bayview Suites', dueAt: hoursFromNow(10), status: 'RELEASED' },
  { workOrderId: 'WO-1005', lineId: 'LINE-B', customer: 'Lotus Boutique', dueAt: hoursFromNow(12), status: 'RELEASED' },
];

export const batches: Batch[] = [
  { batchId: 'B-001', workOrderId: 'WO-1001', lineId: 'LINE-A', plannedQuantity: 120, linenType: 'BED_SHEET' },
  { batchId: 'B-002', workOrderId: 'WO-1001', lineId: 'LINE-A', plannedQuantity: 90, linenType: 'PILLOW_CASE' },
  { batchId: 'B-003', workOrderId: 'WO-1002', lineId: 'LINE-A', plannedQuantity: 150, linenType: 'TOWEL' },
  { batchId: 'B-004', workOrderId: 'WO-1002', lineId: 'LINE-A', plannedQuantity: 75, linenType: 'BATH_ROBE' },
  { batchId: 'B-005', workOrderId: 'WO-1003', lineId: 'LINE-B', plannedQuantity: 200, linenType: 'BED_SHEET' },
  { batchId: 'B-006', workOrderId: 'WO-1003', lineId: 'LINE-B', plannedQuantity: 110, linenType: 'TABLE_LINEN' },
  { batchId: 'B-007', workOrderId: 'WO-1004', lineId: 'LINE-B', plannedQuantity: 60, linenType: 'TOWEL' },
  { batchId: 'B-008', workOrderId: 'WO-1005', lineId: 'LINE-B', plannedQuantity: 130, linenType: 'BED_SHEET' },
  { batchId: 'B-009', workOrderId: 'WO-1004', lineId: 'LINE-B', plannedQuantity: 85, linenType: 'PILLOW_CASE' },
  { batchId: 'B-010', workOrderId: 'WO-1001', lineId: 'LINE-A', plannedQuantity: 45, linenType: 'TABLE_LINEN' },
];

/**
 * The internal application also keeps its own receiving log, which overlaps
 * with the supplier portal. B-001 is recorded here as 125 while the supplier
 * portal reports 120 for the same delivery: a genuine cross-source conflict
 * that the platform has to resolve deterministically and flag.
 */
export const receivingRecords: ReceivingRecord[] = [
  { receivingId: 'AR-001', batchId: 'B-001', quantity: 125, receivedAt: minutesAgo(120), dockDoor: 'D1' },
  { receivingId: 'AR-002', batchId: 'B-002', quantity: 90, receivedAt: minutesAgo(100), dockDoor: 'D1' },
  { receivingId: 'AR-003', batchId: 'B-003', quantity: 150, receivedAt: minutesAgo(80), dockDoor: 'D2' },
];

export const dispatchRecords: DispatchRecord[] = [
  { dispatchId: 'AD-001', batchId: 'B-001', quantity: 118, dispatchedAt: minutesAgo(40), vehicle: 'VN-51F-238.19', signedBy: 'op.vu' },
];

export const datasets = {
  'work-orders': workOrders,
  batches,
  receiving: receivingRecords,
  dispatch: dispatchRecords,
} as const;

export type DatasetName = keyof typeof datasets;
