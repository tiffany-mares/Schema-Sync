import os
from pathlib import Path

from dotenv import load_dotenv

# Repo-root .env: ATLAS_URI and sponsor keys live there, gitignored.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

META_DB_URL = os.getenv("META_DB_URL", "postgresql://postgres:dev@localhost:5434/schemasync")
ATLAS_URI = os.getenv("ATLAS_URI") or "mongodb://localhost:27017/?replicaSet=rs0&directConnection=true"
MONGO_DB = os.getenv("MONGO_DB", "schemasync")
VCS_URL = os.getenv("VCS_URL", "http://127.0.0.1:8000")
MIGRATOR_URL = os.getenv("MIGRATOR_URL", "http://127.0.0.1:8081")
REPO = os.getenv("REPO", "demo")
