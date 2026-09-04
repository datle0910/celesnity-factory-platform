/**
 * The supplier portal's delivery log.
 *
 * This is the authoritative source for the RECEIVING station. It deliberately
 * contains data that a naive crawler would get wrong:
 *
 *   - SPR-000001 is rendered on both page 1 and page 2. Paginated portals often
 *     re-show a row when the underlying list shifts between requests. Both
 *     renderings carry the same stable record id, so the platform must treat
 *     them as one observation and count the quantity once.
 *   - Two rows are malformed. They must be reported without aborting the run.
 *   - Page 3 links "next" back to page 1, so a crawler that simply follows
 *     links forever never terminates.
 */

const STARTED_AT = Date.now();

const minutesAgo = (minutes: number): string =>
  new Date(STARTED_AT - minutes * 60_000).toISOString();

export interface DeliveryRow {
  /** Stable identifier issued by the portal, rendered as a row attribute. */
  recordId: string;
  deliveryNumber: string;
  supplier: string;
  /** Empty string models a row the portal failed to fill in. */
  batchId: string;
  /** Free text so that non-numeric values are representable. */
  quantity: string;
  deliveredAt: string;
}

const rows: DeliveryRow[] = [
  { recordId: 'SPR-000001', deliveryNumber: 'DLV-5001', supplier: 'Sunrise Linen Supply', batchId: 'B-001', quantity: '120', deliveredAt: minutesAgo(120) },
  { recordId: 'SPR-000002', deliveryNumber: 'DLV-5002', supplier: 'Sunrise Linen Supply', batchId: 'B-002', quantity: '90', deliveredAt: minutesAgo(100) },
  { recordId: 'SPR-000003', deliveryNumber: 'DLV-5003', supplier: 'Delta Textiles', batchId: 'B-003', quantity: '150', deliveredAt: minutesAgo(80) },
  { recordId: 'SPR-000004', deliveryNumber: 'DLV-5004', supplier: 'Delta Textiles', batchId: 'B-004', quantity: '75', deliveredAt: minutesAgo(70) },
  { recordId: 'SPR-000005', deliveryNumber: 'DLV-5005', supplier: 'Highland Linen Co.', batchId: 'B-005', quantity: '200', deliveredAt: minutesAgo(40) },
  { recordId: 'SPR-000006', deliveryNumber: 'DLV-5006', supplier: 'Highland Linen Co.', batchId: 'B-006', quantity: '110', deliveredAt: minutesAgo(4) },
  // Malformed: the portal renders a placeholder instead of a number.
  { recordId: 'SPR-000007', deliveryNumber: 'DLV-5007', supplier: 'Delta Textiles', batchId: 'B-003', quantity: 'N/A', deliveredAt: minutesAgo(35) },
  { recordId: 'SPR-000008', deliveryNumber: 'DLV-5008', supplier: 'Sunrise Linen Supply', batchId: 'B-009', quantity: '85', deliveredAt: minutesAgo(60) },
  { recordId: 'SPR-000009', deliveryNumber: 'DLV-5009', supplier: 'Highland Linen Co.', batchId: 'B-010', quantity: '45', deliveredAt: minutesAgo(150) },
  // Malformed: no batch reference, so the row cannot be joined to anything.
  { recordId: 'SPR-000010', deliveryNumber: 'DLV-5010', supplier: 'Delta Textiles', batchId: '', quantity: '30', deliveredAt: minutesAgo(20) },
];

const byRecordId = (recordId: string): DeliveryRow => {
  const row = rows.find((candidate) => candidate.recordId === recordId);
  if (!row) {
    throw new Error(`unknown fixture row ${recordId}`);
  }
  return row;
};

/**
 * Explicit page composition rather than a slice, so the duplicated row can
 * appear on two pages exactly as a shifting real-world list would produce.
 */
export const pages: DeliveryRow[][] = [
  [byRecordId('SPR-000001'), byRecordId('SPR-000002'), byRecordId('SPR-000003'), byRecordId('SPR-000004')],
  [byRecordId('SPR-000001'), byRecordId('SPR-000005'), byRecordId('SPR-000006'), byRecordId('SPR-000007')],
  [byRecordId('SPR-000008'), byRecordId('SPR-000009'), byRecordId('SPR-000010')],
];

export const TOTAL_PAGES = pages.length;
