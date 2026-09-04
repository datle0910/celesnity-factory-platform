# Celesnity Factory Data & Production Line Platform

A platform for an industrial laundry that collects factory data from several
fragmented local sources, normalizes it into one traceable operational
dataset, and uses that dataset to show and manage production-line status
across the six fixed processing steps:

```
RECEIVING → SORTING → WASHING → DRYING → FOLDING → DISPATCH
```

The platform **improves visibility and traceability**. It does not
automatically optimize the schedule or control machines — every station and
line summary is derived from collected, deduplicated data, and the only
write path available to an operator is a small set of management actions
(acknowledge, block, resume, add a note).

This README covers how to run the system, the architecture, and — per the
assessment's request — the assumptions, design decisions and trade-offs made
where the brief left implementation choices open.

## Contents

- [Quick start](#quick-start)
- [Architecture](#architecture)
- [Required data sources](#required-data-sources)
- [Deduplication and conflict-handling policy](#deduplication-and-conflict-handling-policy)
- [Batch state, station progress and freshness](#batch-state-station-progress-and-freshness)
- [Management events](#management-events)
- [Sample data and the six-step coverage matrix](#sample-data-and-the-six-step-coverage-matrix)
- [API reference](#api-reference)
- [Testing](#testing)
- [Assumptions, trade-offs and known limitations](#assumptions-trade-offs-and-known-limitations)
- [What's skipped and why](#whats-skipped-and-why)

## Quick start

Requires Docker and Docker Compose. No other local dependency is required to
run the full stack.

```bash
cp .env.example .env
docker compose up --build
```

This starts five services: Postgres (hosting both the platform's own database
and a separate `production` database that stands in for the factory's own
system), the two REST/HTML fixture services, the API, and the web app. The
API container applies pending Prisma migrations and seeds the three required
sources (pre-configured against the bundled fixtures, but not run) on every
start — both operations are idempotent, so restarting is always safe.

Once healthy:

| | |
|---|---|
| Web app | http://localhost:3000 |
| API | http://localhost:4000 |
| API docs (Swagger) | http://localhost:4000/docs |
| Application API fixture | http://localhost:4001 |
| Supplier portal fixture | http://localhost:4002/deliveries?page=1 |

Open **Data Sources**, and for each of the three seeded sources: **Test
connection** → **Discover schema** → (optionally adjust the selection) →
**Run collection**. Then open **Production Lines** to see the board populate.
Collection is a manual, operator-triggered action everywhere in this
platform — nothing collects on a timer.

### Running without Docker

```bash
npm install
docker compose up -d postgres          # only Postgres, for local iteration
cp .env.example .env
npm run prisma:migrate --workspace @celesnity/api
npm run seed --workspace @celesnity/api
npm run start:dev --workspace @celesnity/api      # terminal 1
npm run dev --workspace @celesnity/web            # terminal 2
npx tsx apps/fixtures/app-api/src/server.ts       # terminal 3
npx tsx apps/fixtures/supplier-portal/src/server.ts  # terminal 4
```

### Running the tests

```bash
npm test --workspace @celesnity/api
```

39 unit tests covering the deduplication policy and the batch-state machine,
with no database or network dependency. They pass with no MQTT broker
running, which is the default — see
[What's skipped and why](#whats-skipped-and-why).

## Architecture

```
apps/
  api/        NestJS 11 backend — collectors, normalization, production view,
              management events
  web/        Next.js 16 / React 19 — Data Sources & Production Lines views
  fixtures/
    app-api/            mock internal application, paginated REST
    supplier-portal/    mock supplier portal, paginated HTML
    mqtt-simulator/     optional washing/drying telemetry publisher
  db-init/    SQL seeding the factory's *production* Postgres database
```

One Postgres instance hosts two logically separate databases: `platform`
(this application's own persistence) and `production` (the factory's own
database, an external system the Database Connection source reads from
through a dedicated least-privilege role). They are kept on one container to
keep the Compose file simple, but the platform only ever *reads* from
`production` — see `apps/db-init/sql/production-schema.sql` for its schema
and access grant.

### Data model

Three layers, kept strictly separate so the audit trail and the platform's
interpretation of it can never be conflated:

```
SourceRecord ──normalize+dedup──▶ CanonicalEvent ──derive on read──▶ Batch view
(append-only,                    (one per batch+station,             (state, station
 every observation                chosen deterministically,           progress, WIP,
 ever collected)                   original records still linked)     freshness)

ManagementEvent (append-only manager actions) ──derive on read──▶ Batch view
```

- **`SourceRecord`** — every observation ever collected, exactly as the
  source presented it, plus the platform's normalized reading of it. Never
  modified or deleted. This is the audit trail.
- **`CanonicalEvent`** — the accepted event for one `(batchId, station)`,
  chosen from all matching `SourceRecord`s by the deterministic policy
  below. Links back to every contributing record with a role
  (`WINNER` / `DUPLICATE` / `SUPERSEDED`) and a stated reason.
- **`ManagementEvent`** — append-only manager actions
  (`ACKNOWLEDGE_EXCEPTION` / `BLOCK` / `RESUME` / `NOTE`), each carrying
  `organizationId`, `actor` and `timestamp`.
- **Batch state, current station, work in progress and freshness are
  computed on every read** from `CanonicalEvent` + `ManagementEvent` — see
  `apps/api/src/domain/batch-state.ts`. Nothing is cached or materialized,
  so the production board can never disagree with the data it was built
  from, and a `POST /reconcile` rebuild is always safe to run.

### Collectors

One `Collector` interface (`test` / `discover` / `collect`), four
implementations behind it:

- **`AppApiCollector`** — paginated REST client with a request timeout and
  bounded exponential-backoff retry of transient failures (network errors,
  timeouts, 429/5xx — never a 4xx, which means the request itself is wrong).
  Also the sole source of the `batchId → workOrderId, lineId` mapping every
  other source is joined through.
- **`CrawlerCollector`** — HTML crawler for the supplier portal. Guards
  against pagination loops by remembering every visited URL (the bundled
  fixture's last page links back to its first) independently of a hard page
  ceiling, and validates every row individually so one malformed row never
  costs the run the rest of the page.
- **`DatabaseCollector`** — a generic connector for an operator-selected
  table on an arbitrary Postgres database. Table and column identifiers are
  only ever quoted into SQL after being checked against
  `information_schema`; values are always bound as query parameters, so a
  crafted selection cannot become an injection.
- **`MqttCollector`** (optional) — see
  [What's skipped and why](#whats-skipped-and-why).

## Required data sources

| Source | What it provides | How it's exercised |
|---|---|---|
| **Application API** | work orders, batches, receiving, dispatch (paginated) | Retry: the fixture's dispatch endpoint fails once per process with a 503 before serving data |
| **Data crawler** | supplier delivery notes (paginated HTML) | Loop guard: page 3 links back to page 1. Malformed-row handling: one non-numeric quantity, one missing batch reference |
| **Database connection** | `factory.production_events` in the `production` Postgres database (sorting/washing/drying/folding + a secondary dispatch observation) | Schema discovery lists this table alongside two unrelated ones (`machines`, `shift_assignments`), so table selection is a real choice |

Credentials are supplied either by naming an environment variable (the
seeded database source uses `PRODUCTION_DB_PASSWORD` this way) or by typing
a value into a masked field, which is encrypted (AES-256-GCM) before it
touches the database. Neither path is ever returned by the API, redisplayed
in the interface, written to a log, or committed to source control — see
`apps/api/src/config/secrets.service.ts` and
`SourcesService#toSourceDto` (`apps/api/src/sources/sources.service.ts`),
which builds every API response from an explicit field list rather than by
spreading the database row.

## Deduplication and conflict-handling policy

Implemented in `apps/api/src/domain/dedup.ts`, exercised by 14 unit tests.
The policy is a pure function — same observations in, same accepted event
out, regardless of collection order — which is what "deterministic" means
here in a way that's actually checked, not just claimed.

**1. Exact duplicates** (the same observation collected more than once) are
identified by `(sourceId, sourceRecordId)`. Every raw pull is still stored
as a `SourceRecord` — the provenance requirement doesn't allow discarding
input — but normalization collapses records sharing that key into one
candidate, keeping the earliest sighting. Quantity is read from that one
candidate only; duplicates are never summed.

*Example in the bundled data:* the supplier portal fixture renders delivery
`SPR-000001` on both page 1 and page 2 (a shifting paginated list is
expected to do this in the real world). Both renderings collapse to one
accepted `RECEIVING` event for `B-001`.

**2. Genuine disagreement between sources** (two different sources both
claiming to be *the* observation for a batch and station, with different
values) is resolved by a per-station **source-authority ranking**, derived
directly from the assessment's required-source table:

| Station | Authority order |
|---|---|
| RECEIVING | crawler → application API → database |
| SORTING | database → application API |
| WASHING | database → MQTT → application API |
| DRYING | database → MQTT → application API |
| FOLDING | database → application API |
| DISPATCH | application API → database |

Two judgment calls were needed where the brief allows more than one source:

- **DISPATCH** may come from either the application API or the database.
  The application API is treated as authoritative because it's the system
  that actually closes out a dispatch in this scenario; a matching database
  observation is corroboration, not a competing source of truth.
- **WASHING/DRYING** may also carry MQTT telemetry. Telemetry ranks below
  the production database: it's machine-level evidence that a batch is
  being processed, not the factory's record of what was completed.

If two candidates are still tied after authority (same rank — for instance
two production-database rows), the tie breaks on the earliest `occurredAt`,
and if still tied, the lexicographically lowest `sourceRecordId`. This
tier is a total order with no shared-value case left over, which is what
makes the outcome independent of input order (checked directly by a
property test in `dedup.spec.ts`).

The losing observation is **retained and marked `SUPERSEDED`**, never
discarded, and the batch's `CONFLICTING_SOURCES` indicator surfaces the
disagreement to an operator rather than silently averaging it away.

*Example in the bundled data:* the application API's receiving record for
`B-001` reports 125 units; the supplier portal (authoritative for
RECEIVING) reports 120. The crawler observation wins; the application
API's is marked superseded; `B-001` carries `CONFLICTING_SOURCES`.

## Batch state, station progress and freshness

Implemented in `apps/api/src/domain/batch-state.ts`, exercised by 25 unit
tests, following the assessment's specification directly:

- **State**, evaluated strictly in this order: `COMPLETED` (an accepted
  DISPATCH event exists) → `BLOCKED` (no dispatch, and a manager's block
  has not been resumed) → `IN_PROGRESS` (no block/dispatch, and at least
  one accepted event from RECEIVING through FOLDING) → `PLANNED` (a work
  order exists, nothing operational has arrived yet).
- **Current station** is the furthest station reached by an accepted
  event, in process order. A late event from an earlier station enriches
  the batch's history and can trigger a `MISSING_DATA` indicator, but
  never moves the current station backwards.
- **Work in progress** per station counts non-completed batches whose
  current station is that one; a completed batch that passed through a
  station is not counted there.
- **Completed quantity** per station is the deduplicated event's quantity
  — never a sum across duplicate observations.
- **Freshness**: age since the last accepted event; the default stale
  threshold is 15 minutes (`STALE_THRESHOLD_MINUTES`), overridable per
  request via `?staleThresholdMinutes=`. A completed batch is never
  considered stale — it's finished, not waiting.
- **Quality indicators**: `MISSING_DATA` (a later station reached without
  an earlier one), `QUANTITY_MISMATCH` (a station's quantity deviates from
  the received quantity by more than `QUANTITY_TOLERANCE`, default 5%),
  `CONFLICTING_SOURCES`, `LATE_EVENT`, `STALE`, `BLOCKED`.

## Management events

Managers can acknowledge an exception, block a batch, resume a batch, and
add a note (`POST /batches/:batchId/events`). Every event is append-only and
carries `organizationId`, `actor` and `timestamp` — full authentication and
user management are out of scope per the assessment, so a seeded
organization/actor is used, but the event shape doesn't shortcut on that.
Collected source history is never overwritten by a management action; a
block simply changes what the *next* read of the batch's state derives.

## Sample data and the six-step coverage matrix

| Step | Station | Required source | Covered by |
|---|---|---|---|
| 1 | RECEIVING | Supplier crawler | `supplier-portal` fixture |
| 2 | SORTING | Production database | `production_events` seed |
| 3 | WASHING | Production database; optional MQTT | `production_events` seed (+ MQTT simulator) |
| 4 | DRYING | Production database; optional MQTT | `production_events` seed (+ MQTT simulator) |
| 5 | FOLDING | Production database | `production_events` seed |
| 6 | DISPATCH | Application API or production database | `app-api` fixture + `production_events` seed |

Every operational record carries a `batchId`; the application API fixture
maps each `batchId` to its `workOrderId` and `lineId`
(`apps/fixtures/app-api/src/dataset.ts`), which is what lets the crawler and
database sources — which only ever carry `batchId` — join onto a line.

Deliberately-designed scenarios in the fixtures, so the policies above are
demonstrated rather than just implemented:

- **Duplicate source observation** — delivery `SPR-000001` rendered on two
  pages of the supplier portal.
- **Late event from an earlier station** — the production database's
  `PE-SRT-006` (batch `B-009`, SORTING) is timestamped as having happened
  before washing/drying, but is only *recorded* by the factory system after
  both. `B-009` shows `LATE_EVENT` and stays at DRYING rather than jumping
  back to SORTING.
- **Cross-source conflict** — `B-001`'s receiving quantity (application API
  says 125, supplier portal says 120) and a corroborating-but-superseded
  dispatch observation in the production database.
- **Missing-data batch** — `B-007` reaches WASHING with no RECEIVING or
  SORTING record anywhere in the fixtures.
- **Quantity shortfall** — `B-003` receives 150 units and dries only 120
  (a 20% shortfall, over the 5% default tolerance).
- **Malformed rows** — the supplier portal has one row with a non-numeric
  quantity and one with no batch reference; both are rejected individually
  without failing the collection run.

## API reference

Full interactive reference at `/docs` (Swagger) once the API is running.
Summary:

**Sources** — `POST /sources`, `GET /sources`, `GET /sources/:id`,
`DELETE /sources/:id`, `POST /sources/:id/test`,
`GET /sources/:id/schema`, `PATCH /sources/:id/selection`,
`POST /sources/:id/collect`, `GET /sources/:id/runs`

**Collection** — `GET /runs/:runId`, `GET /records` (normalized-record
preview with source/run/dedup provenance), `POST /reconcile`

**Production** — `GET /lines`, `GET /batches`, `GET /batches/:batchId`
(full timeline with per-event provenance), `GET /batches/:batchId/events`,
`POST /batches/:batchId/events`, `GET /stations`

## Testing

```bash
npm test --workspace @celesnity/api
```

39 tests over the two pure domain modules — no database, no network, no
Docker required:

- `domain/dedup.spec.ts` (14 tests) — duplicate collapsing, cross-source
  conflict resolution including both DISPATCH and WASHING/DRYING authority
  rules, every tie-break tier, and an explicit order-independence check
  that runs the same observations through four different orderings and
  asserts an identical outcome.
- `domain/batch-state.spec.ts` (25 tests) — all four states and their
  precedence, late-event handling (including that it closes a
  `MISSING_DATA` gap without moving the batch backwards), freshness at and
  around the threshold, quality indicators, and line/WIP aggregation.

The rest of the system (collectors, the HTTP layer, the frontend) was
verified manually against the real fixtures and containers rather than with
integration tests, given the assessment's time window — see
[Assumptions, trade-offs and known limitations](#assumptions-trade-offs-and-known-limitations).

## Assumptions, trade-offs and known limitations

- **Batch state/station/WIP/freshness are computed on every read, not
  cached.** For the data volumes here that's free; at real factory scale
  it would eventually need caching or a read model, at the cost of a
  reconciliation step. Given the choice between "always correct, doesn't
  scale yet" and "scales, can drift," the former is the safer default for
  a visibility tool a manager needs to trust.
- **`GET /lines` and `GET /batches` load every `CanonicalEvent` and
  `ManagementEvent` per request** rather than paginating server-side —
  reasonable at the fixture data's scale, not at a real factory's.
- **The seed script registers sources but never runs collection.** The
  assessment specifically asks for a manual collection workflow; automating
  the first run would undercut the requirement it's testing, so the seed
  only removes the tedium of retyping three sets of connection settings.
- **No automated integration or end-to-end tests.** The domain logic — the
  part with real risk of getting the *rules* wrong — has unit coverage;
  the collectors, HTTP layer and UI were verified by hand against the real
  fixtures and a from-scratch `docker compose build && up`, documented in
  this session's commit history. With more time this would be the first
  thing added: a Testcontainers-backed integration test per collector, and
  a Playwright smoke test over the two views.
- **Single seeded organization/actor**, per the assessment's explicit
  allowance — there's no login, and every management event's `actor`
  field is either the default or whatever string a caller supplies.
- **The web app's `NEXT_PUBLIC_API_BASE_URL` is fixed at Docker build
  time.** It has to be, since it's read by code that runs in the browser
  and a Compose-internal service name (`http://api:4000`) would never
  resolve there. Fine for a local/demo deployment; a real deployment
  would need this to vary per environment without a rebuild.
- **The `DatabaseCollector` supports one table per source.** Multiple
  tables from the same database would need either multiple registered
  sources (works today, just less convenient) or a config-shape change to
  support several table+mapping pairs per source.

## What's skipped and why

**MQTT is not enabled by default.** It's explicitly optional in the
assessment ("All required functionality and tests must pass when MQTT is
not implemented or enabled"), and the required three sources plus the
production-line logic they feed represent a complete, reliable vertical
slice on their own — which the assessment says to value over additional
features attempted under time pressure.

What *is* built, so enabling it is mechanical rather than a redesign:

- `MqttCollector` (`apps/api/src/sources/collectors/mqtt.collector.ts`) —
  a full `test`/`discover`/`collect` implementation. A collection run
  subscribes for a short window and disconnects rather than holding a
  connection open between runs, so a missing broker never blocks a
  required workflow.
- `apps/fixtures/mqtt-simulator` — publishes retained washing/drying
  telemetry for batches the production database already reports on, so
  enabling it adds detail to known batches rather than a parallel set of
  data.
- The dedup policy already ranks MQTT telemetry below the production
  database for WASHING/DRYING (see
  [Deduplication and conflict-handling policy](#deduplication-and-conflict-handling-policy)).
- A Mosquitto service and the simulator are defined in
  `docker-compose.yml` behind the `mqtt` Compose profile.

To try it:

```bash
docker compose --profile mqtt up --build
```

Then register a source with `type: "MQTT"` and
`config: { "brokerUrl": "mqtt://mosquitto:1883", "topicFilter": "factory/#" }`
from the Data Sources view.
