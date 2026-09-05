#!/usr/bin/env python3
"""Back up a running PostgreSQL database and rehearse migrations on a clone.

Only the generated clone is migrated or dropped. Diagnostics and the consistent
pg_dump snapshot remain in a root-only directory on the production host.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import uuid


def verify_history(applied, files):
    for row in applied:
        version = row["version"]
        if not row["success"] or version not in files:
            raise RuntimeError(f"Unknown or failed applied migration: {version}")
        if hashlib.sha384(files[version].read_bytes()).hexdigest() != row["checksum"]:
            raise RuntimeError(f"Applied migration checksum differs: {version}")
    versions = {row["version"] for row in applied}
    return [(version, path) for version, path in sorted(files.items()) if version not in versions]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--migrations", type=Path, required=True)
    parser.add_argument("--backup-dir", type=Path, required=True)
    parser.add_argument("--container", default="gmed-postgres")
    args = parser.parse_args()
    os.umask(0o077)
    args.backup_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    args.backup_dir.chmod(0o700)
    database = os.environ.get("POSTGRES_DB", "gmed")
    user = os.environ["POSTGRES_USER"]
    environment = {**os.environ, "PGPASSWORD": os.environ["POSTGRES_PASSWORD"]}
    clone = "gmed_preflight_" + uuid.uuid4().hex[:20]
    if database == clone:
        raise RuntimeError("Preflight database must differ from the live database")
    docker = ["docker", "exec", "-i", "-e", "PGPASSWORD", args.container]
    dump = args.backup_dir / "database-before-upgrade.dump"
    created = False

    with (args.backup_dir / "migration-preflight.log").open("ab") as log:
        def run(command, **kwargs):
            result = subprocess.run(docker + command, env=environment, stderr=log, **kwargs)
            if result.returncode:
                raise RuntimeError(f"Preflight command failed; see {args.backup_dir}/migration-preflight.log")
            return result

        def query(sql):
            return run(["psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", user, "-d", clone],
                       input=sql.encode("utf-8"), stdout=subprocess.PIPE).stdout.decode("utf-8").strip()

        with dump.open("xb") as output:
            run(["pg_dump", "-U", user, "-d", database, "-Fc"], stdout=output)
        with dump.open("rb") as source, (args.backup_dir / "database-contents.list").open("xb") as output:
            run(["pg_restore", "--list"], stdin=source, stdout=output)
        try:
            run(["createdb", "-U", user, "-T", "template0", clone], stdout=log)
            created = True
            with dump.open("rb") as source:
                run(["pg_restore", "--exit-on-error", "-U", user, "-d", clone], stdin=source, stdout=log)
            applied = json.loads(query("SELECT COALESCE(json_agg(json_build_object("
                "'version',version,'checksum',encode(checksum,'hex'),'success',success)), '[]') "
                "FROM _sqlx_migrations"))
            files = {int(p.name.split("_")[0]): p for p in args.migrations.glob("*.sql")}
            pending = verify_history(applied, files)
            for version, path in pending:
                body = path.read_text(encoding="utf-8")
                if body.startswith("-- no-transaction"):
                    raise RuntimeError(f"Nontransactional migration needs a dedicated rehearsal: {version}")
                description = path.stem.split("_", 1)[1].replace("_", " ").replace("'", "''")
                checksum = hashlib.sha384(path.read_bytes()).hexdigest()
                marker = ("INSERT INTO _sqlx_migrations(version,description,success,checksum,execution_time) "
                          f"VALUES ({version},'{description}',true,decode('{checksum}','hex'),0);")
                query("BEGIN;\n" + body + "\n" + marker + "\nCOMMIT;")
                print(f"Migration rehearsal passed: {version}", flush=True)
            report = {"existing_migrations": len(applied), "pending_migrations": [v for v, _ in pending]}
            (args.backup_dir / "preflight-passed.json").write_text(json.dumps(report), encoding="utf-8")
            print(f"Backup and migration rehearsal passed: {len(applied)} existing, {len(pending)} pending; {args.backup_dir}", flush=True)
        finally:
            if created:
                run(["dropdb", "-U", user, "--force", clone], stdout=log)


if __name__ == "__main__":
    main()
