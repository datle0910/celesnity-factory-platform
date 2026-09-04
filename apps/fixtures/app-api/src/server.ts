import express, { type Request, type Response } from 'express';
import { datasets, type DatasetName } from './dataset.js';

const PORT = Number(process.env.PORT ?? 4001);
const DEFAULT_PAGE_SIZE = 3;
const MAX_PAGE_SIZE = 50;

const app = express();

/**
 * The dispatch endpoint fails once per process with a 503 before it starts
 * serving data. A collector that does not retry transient failures will lose
 * the dispatch records entirely and every batch will look unfinished, which
 * makes the retry requirement observable rather than theoretical.
 */
let dispatchFaultArmed = true;

interface PageQuery {
  page: number;
  pageSize: number;
  delayMs: number;
}

function readPageQuery(req: Request): PageQuery | { error: string } {
  const rawPage = req.query.page ?? '1';
  const rawPageSize = req.query.pageSize ?? String(DEFAULT_PAGE_SIZE);
  const rawDelay = req.query.delayMs ?? '0';

  const page = Number(rawPage);
  const pageSize = Number(rawPageSize);
  const delayMs = Number(rawDelay);

  if (!Number.isInteger(page) || page < 1) {
    return { error: `page must be a positive integer, received "${String(rawPage)}"` };
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > MAX_PAGE_SIZE) {
    return { error: `pageSize must be an integer between 1 and ${MAX_PAGE_SIZE}` };
  }
  if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 60_000) {
    return { error: 'delayMs must be between 0 and 60000' };
  }
  return { page, pageSize, delayMs };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function servePage(req: Request, res: Response, dataset: DatasetName): Promise<void> {
  const query = readPageQuery(req);
  if ('error' in query) {
    res.status(400).json({ error: query.error });
    return;
  }

  // Lets a reviewer demonstrate the collector's request timeout by hand:
  //   curl "http://localhost:4001/api/batches?delayMs=30000"
  if (query.delayMs > 0) {
    await sleep(query.delayMs);
  }

  const rows = datasets[dataset];
  const totalItems = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
  const start = (query.page - 1) * query.pageSize;
  const data = rows.slice(start, start + query.pageSize);

  res.json({
    data,
    pagination: {
      page: query.page,
      pageSize: query.pageSize,
      totalItems,
      totalPages,
      hasMore: query.page < totalPages,
    },
  });
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'app-api-fixture', dispatchFaultArmed });
});

app.get('/api/work-orders', (req, res) => {
  void servePage(req, res, 'work-orders');
});

app.get('/api/batches', (req, res) => {
  void servePage(req, res, 'batches');
});

app.get('/api/receiving', (req, res) => {
  void servePage(req, res, 'receiving');
});

app.get('/api/dispatch', (req, res) => {
  if (dispatchFaultArmed) {
    dispatchFaultArmed = false;
    res.setHeader('Retry-After', '1');
    res.status(503).json({
      error: 'dispatch service temporarily unavailable',
      hint: 'this fixture fails the first dispatch request once per process to exercise retry handling',
    });
    return;
  }
  void servePage(req, res, 'dispatch');
});

// Re-arms the transient fault so the retry path can be demonstrated repeatedly.
app.post('/admin/rearm-fault', (_req, res) => {
  dispatchFaultArmed = true;
  res.json({ dispatchFaultArmed });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

app.listen(PORT, () => {
  console.log(`[app-api-fixture] listening on http://localhost:${PORT}`);
});
