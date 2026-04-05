"""
Run a SQL migration against Supabase using the service role key.
Usage: python scripts/run_migration.py supabase/migrations/004_qa_cache.sql
"""
import sys
import os
from pathlib import Path

project_root = Path(__file__).parent.parent
from dotenv import load_dotenv
load_dotenv(project_root / ".env.local")

import httpx

SUPABASE_URL = os.environ["NEXT_PUBLIC_SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]

migration_file = sys.argv[1] if len(sys.argv) > 1 else "supabase/migrations/004_qa_cache.sql"
sql = (project_root / migration_file).read_text()

project_ref = SUPABASE_URL.split("//")[1].split(".")[0]
url = f"https://{project_ref}.supabase.co/rest/v1/rpc/exec_sql"

# Split on semicolons and run each statement separately via PostgREST
# Since PostgREST doesn't support raw SQL, we use the pg-meta endpoint
pg_meta_url = f"https://api.supabase.com/v1/projects/{project_ref}/database/query"

print(f"Project: {project_ref}")
print(f"Running: {migration_file}")

# Try pg-meta with personal access token
import getpass
pat = os.environ.get("SUPABASE_ACCESS_TOKEN") or getpass.getpass("Supabase Personal Access Token (from supabase.com/dashboard/account/tokens): ")

resp = httpx.post(
    pg_meta_url,
    headers={"Authorization": f"Bearer {pat}", "Content-Type": "application/json"},
    json={"query": sql},
    timeout=30,
)

if resp.status_code == 200:
    print("✅ Migration applied successfully")
    print(resp.json())
else:
    print(f"❌ Failed: {resp.status_code}")
    print(resp.text)
