-- ===========================================================================
-- The factory's production database.
--
-- This schema belongs to the factory, not to the platform. The platform
-- discovers it at runtime through information_schema and reads whichever table
-- the operator selects, so the shape below is deliberately *not* the platform's
-- canonical shape: station names are free text, the batch key is `batch_ref`,
-- and there are unrelated tables to discover alongside the interesting one.
--
-- All timestamps are relative to database initialisation so the demo always
-- shows a live production floor rather than a frozen historical snapshot.
-- ===========================================================================

CREATE SCHEMA factory;

-- ---------------------------------------------------------------------------
-- The table an operator is expected to select for collection.
--
-- `recorded_at` is when the factory's own system learned about the event and is
-- distinct from `occurred_at`, when it actually happened on the floor. The gap
-- between the two is what makes late-arriving data observable.
-- ---------------------------------------------------------------------------
CREATE TABLE factory.production_events (
    event_id     text PRIMARY KEY,
    batch_ref    text        NOT NULL,
    station      text        NOT NULL,
    quantity     integer,
    occurred_at  timestamptz NOT NULL,
    recorded_at  timestamptz NOT NULL,
    machine_id   text,
    operator     text,
    notes        text
);

CREATE INDEX production_events_batch_ref_idx ON factory.production_events (batch_ref);

-- Unrelated tables, present so that schema discovery and table selection are a
-- real choice rather than a formality.
CREATE TABLE factory.machines (
    machine_id      text PRIMARY KEY,
    description     text NOT NULL,
    station         text NOT NULL,
    commissioned_on date
);

CREATE TABLE factory.shift_assignments (
    assignment_id serial PRIMARY KEY,
    operator      text NOT NULL,
    line_ref      text NOT NULL,
    shift_start   timestamptz NOT NULL,
    shift_end     timestamptz NOT NULL
);

-- ---------------------------------------------------------------------------
-- Seed data
--
-- Stations covered here: SORTING, WASHING, DRYING, FOLDING, plus a secondary
-- DISPATCH observation that the platform must resolve against the application
-- API, which is authoritative for dispatch.
-- ---------------------------------------------------------------------------
INSERT INTO factory.production_events
    (event_id, batch_ref, station, quantity, occurred_at, recorded_at, machine_id, operator, notes)
VALUES
    -- SORTING ---------------------------------------------------------------
    ('PE-SRT-001', 'B-001', 'sorting', 120, now() - interval '105 minutes', now() - interval '105 minutes', 'M-S01', 'op.tran', NULL),
    ('PE-SRT-002', 'B-002', 'sorting',  90, now() - interval  '85 minutes', now() - interval  '85 minutes', 'M-S01', 'op.tran', NULL),
    ('PE-SRT-003', 'B-003', 'sorting', 150, now() - interval  '65 minutes', now() - interval  '65 minutes', 'M-S02', 'op.le',   NULL),
    ('PE-SRT-004', 'B-004', 'sorting',  75, now() - interval  '55 minutes', now() - interval  '55 minutes', 'M-S02', 'op.le',   NULL),
    ('PE-SRT-005', 'B-005', 'sorting', 198, now() - interval   '5 minutes', now() - interval   '5 minutes', 'M-S01', 'op.pham', '2 items withdrawn for re-inspection'),
    -- Late arrival: this sorting event happened before B-009 was washed and
    -- dried, but the factory only recorded it minutes ago. It must enrich the
    -- batch history without dragging the batch back to SORTING.
    ('PE-SRT-006', 'B-009', 'sorting',  85, now() - interval  '45 minutes', now() - interval   '2 minutes', 'M-S02', 'op.le',   'entered late after terminal outage'),
    ('PE-SRT-007', 'B-010', 'sorting',  45, now() - interval  '95 minutes', now() - interval  '95 minutes', 'M-S01', 'op.tran', NULL),

    -- WASHING ---------------------------------------------------------------
    ('PE-WSH-001', 'B-001', 'washing', 120, now() - interval  '90 minutes', now() - interval  '90 minutes', 'M-W01', 'op.tran', NULL),
    ('PE-WSH-002', 'B-002', 'washing',  90, now() - interval  '70 minutes', now() - interval  '70 minutes', 'M-W01', 'op.tran', NULL),
    ('PE-WSH-003', 'B-003', 'washing', 150, now() - interval  '45 minutes', now() - interval  '45 minutes', 'M-W02', 'op.le',   NULL),
    ('PE-WSH-004', 'B-004', 'washing',  75, now() - interval  '10 minutes', now() - interval  '10 minutes', 'M-W02', 'op.le',   NULL),
    -- B-009 reaches washing even though its sorting record has not arrived yet.
    ('PE-WSH-005', 'B-009', 'washing',  85, now() - interval  '30 minutes', now() - interval  '30 minutes', 'M-W01', 'op.pham', NULL),
    -- B-007 has no receiving and no sorting record anywhere: the platform must
    -- surface it as in progress *with* a missing-data indicator.
    ('PE-WSH-006', 'B-007', 'washing',  60, now() - interval   '7 minutes', now() - interval   '7 minutes', 'M-W02', 'op.pham', 'urgent re-wash, paperwork to follow'),

    -- DRYING ----------------------------------------------------------------
    ('PE-DRY-001', 'B-001', 'drying',  118, now() - interval  '70 minutes', now() - interval  '70 minutes', 'M-D01', 'op.tran', NULL),
    ('PE-DRY-002', 'B-002', 'drying',   88, now() - interval  '50 minutes', now() - interval  '50 minutes', 'M-D01', 'op.tran', NULL),
    -- 150 received, 120 dried: a 20% shortfall that must raise a quality flag.
    ('PE-DRY-003', 'B-003', 'drying',  120, now() - interval   '6 minutes', now() - interval   '6 minutes', 'M-D02', 'op.le',   'partial load, remainder still wet'),
    ('PE-DRY-004', 'B-009', 'drying',   84, now() - interval   '9 minutes', now() - interval   '9 minutes', 'M-D01', 'op.pham', NULL),

    -- FOLDING ---------------------------------------------------------------
    ('PE-FLD-001', 'B-001', 'folding', 118, now() - interval  '50 minutes', now() - interval  '50 minutes', 'M-F01', 'op.tran', NULL),
    ('PE-FLD-002', 'B-002', 'folding',  88, now() - interval   '8 minutes', now() - interval   '8 minutes', 'M-F01', 'op.vu',   NULL),

    -- DISPATCH --------------------------------------------------------------
    -- A second observation of a dispatch that the application API also reports.
    -- Both agree on the quantity; the platform still has to pick one of them
    -- deterministically and record that the other was superseded.
    ('PE-DSP-001', 'B-001', 'dispatch', 118, now() - interval '40 minutes', now() - interval '40 minutes', NULL, 'op.vu', 'gate 2');

INSERT INTO factory.machines (machine_id, description, station, commissioned_on) VALUES
    ('M-S01', 'Sorting bench 1',      'sorting', DATE '2021-03-14'),
    ('M-S02', 'Sorting bench 2',      'sorting', DATE '2022-07-01'),
    ('M-W01', 'Tunnel washer 60kg',   'washing', DATE '2020-11-02'),
    ('M-W02', 'Tunnel washer 40kg',   'washing', DATE '2023-01-19'),
    ('M-D01', 'Gas dryer 1',          'drying',  DATE '2020-11-02'),
    ('M-D02', 'Gas dryer 2',          'drying',  DATE '2023-01-19'),
    ('M-F01', 'Ironer / folder line', 'folding', DATE '2019-05-30');

INSERT INTO factory.shift_assignments (operator, line_ref, shift_start, shift_end) VALUES
    ('op.tran', 'LINE-A', now() - interval '6 hours', now() + interval '2 hours'),
    ('op.le',   'LINE-A', now() - interval '6 hours', now() + interval '2 hours'),
    ('op.pham', 'LINE-B', now() - interval '6 hours', now() + interval '2 hours'),
    ('op.vu',   'LINE-B', now() - interval '6 hours', now() + interval '2 hours');

-- Least-privilege access for the platform: read-only, and only on this schema.
GRANT CONNECT ON DATABASE production TO factory_reader;
GRANT USAGE ON SCHEMA factory TO factory_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA factory TO factory_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA factory GRANT SELECT ON TABLES TO factory_reader;
