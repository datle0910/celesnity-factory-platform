#!/bin/bash
# Creates the factory's *production* database alongside the platform database.
#
# From the platform's point of view this is an external system: it is owned by
# the factory, the platform only ever reads from it, and it is reached with a
# dedicated least-privilege role whose password is supplied through an
# environment variable.
set -euo pipefail

PROD_PASSWORD="${PRODUCTION_DB_PASSWORD:-factory_local_dev}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname platform \
  --set=prodpass="$PROD_PASSWORD" <<'EOSQL'
CREATE DATABASE production;
CREATE ROLE factory_reader WITH LOGIN PASSWORD :'prodpass';
EOSQL

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname production \
  -f /docker-entrypoint-initdb.d/sql/production-schema.sql

echo "production database initialised"
