import os

# Host port 5434: a native PostgreSQL service owns 5432 on this machine.
META_DB_URL = os.getenv("META_DB_URL", "postgresql://postgres:dev@localhost:5434/schemasync")
# Falls back to the local single-node replica set from infra/docker-compose.yml.
# Set ATLAS_URI in .env to point at the real Atlas cluster; nothing else changes.
ATLAS_URI = os.getenv("ATLAS_URI") or "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true"
REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379")
MONGO_DB = os.getenv("MONGO_DB", "schemasync")

EMPTY_SCHEMA_JSON = '{"tables":{}}'
