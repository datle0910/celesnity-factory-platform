import express, { type Request, type Response } from 'express';
import { pages, TOTAL_PAGES, type DeliveryRow } from './dataset.js';

const PORT = Number(process.env.PORT ?? 4002);

const app = express();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const formatForDisplay = (iso: string): string => {
  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())} UTC`;
};

function renderRow(row: DeliveryRow): string {
  return `
        <tr data-record-id="${escapeHtml(row.recordId)}">
          <td class="delivery-number">${escapeHtml(row.deliveryNumber)}</td>
          <td class="supplier">${escapeHtml(row.supplier)}</td>
          <td class="batch">${escapeHtml(row.batchId)}</td>
          <td class="quantity">${escapeHtml(row.quantity)}</td>
          <td class="delivered-at"><time datetime="${escapeHtml(row.deliveredAt)}">${escapeHtml(formatForDisplay(row.deliveredAt))}</time></td>
        </tr>`;
}

/**
 * Page 3 links back to page 1. A crawler that follows "next" without tracking
 * where it has already been will loop here indefinitely.
 */
function nextPageFor(page: number): number {
  return page >= TOTAL_PAGES ? 1 : page + 1;
}

function renderPage(page: number): string {
  const rows = pages[page - 1] ?? [];
  const previous = page > 1 ? `<a class="pagination-previous" href="/deliveries?page=${page - 1}">Previous</a>` : '';
  const next = `<a class="pagination-next" href="/deliveries?page=${nextPageFor(page)}">Next</a>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>Sunrise Supply Portal — Deliveries (page ${page})</title>
    <style>
      body { font-family: system-ui, sans-serif; margin: 2rem; color: #1f2933; }
      table { border-collapse: collapse; width: 100%; max-width: 60rem; }
      th, td { border: 1px solid #cbd2d9; padding: 0.5rem 0.75rem; text-align: left; }
      th { background: #f5f7fa; }
      nav { margin-top: 1rem; display: flex; gap: 1rem; }
    </style>
  </head>
  <body>
    <h1>Delivery notes</h1>
    <p>Showing page ${page} of ${TOTAL_PAGES}.</p>
    <table id="deliveries">
      <thead>
        <tr>
          <th>Delivery number</th>
          <th>Supplier</th>
          <th>Batch</th>
          <th>Quantity</th>
          <th>Delivered at</th>
        </tr>
      </thead>
      <tbody>${rows.map(renderRow).join('')}
      </tbody>
    </table>
    <nav>${previous}${next}</nav>
  </body>
</html>
`;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'supplier-portal-fixture', totalPages: TOTAL_PAGES });
});

app.get('/deliveries', (req: Request, res: Response) => {
  const rawPage = req.query.page ?? '1';
  const page = Number(rawPage);

  if (!Number.isInteger(page) || page < 1 || page > TOTAL_PAGES) {
    res.status(404).send('<!doctype html><html><body><h1>No such page</h1></body></html>');
    return;
  }

  res.type('html').send(renderPage(page));
});

app.get('/', (_req, res) => {
  res.redirect('/deliveries?page=1');
});

app.use((_req, res) => {
  res.status(404).send('<!doctype html><html><body><h1>Not found</h1></body></html>');
});

app.listen(PORT, () => {
  console.log(`[supplier-portal-fixture] listening on http://localhost:${PORT}/deliveries?page=1`);
});
