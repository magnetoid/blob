"""The nightly backups, for whoever runs the server (M3 · B4). Inside the container:

    python -m blob_api.backups list
    python -m blob_api.backups latest [--out blob.dump]

`latest` fetches the newest dump to a file — `scripts/restore-drill.sh` restores it into a
scratch database and checks it, which is the only proof a backup is one. The storage
settings are the server's own, so nothing here needs a second set of credentials.
"""

from __future__ import annotations

import sys

from .config import settings
from .lib import storage


def _backups() -> list[dict[str, object]]:
    items = storage.list_objects(settings.BACKUP_PREFIX, bucket=storage.backup_bucket())
    return sorted(items, key=lambda item: item["LastModified"])


def main(argv: list[str]) -> int:
    command = argv[0] if argv else "list"
    items = _backups()
    if command == "list":
        if not items:
            print("No backups yet.", file=sys.stderr)
            return 1
        for item in items:
            print(f"{item['LastModified']:%Y-%m-%d %H:%M}  {item['Size']:>12,}  {item['Key']}")
        return 0
    if command == "latest":
        if not items:
            print("No backups yet.", file=sys.stderr)
            return 1
        newest = items[-1]
        out = argv[argv.index("--out") + 1] if "--out" in argv else "blob.dump"
        storage.download_to(str(newest["Key"]), out, bucket=storage.backup_bucket())
        print(f"{newest['Key']} → {out}")
        return 0
    print(__doc__, file=sys.stderr)
    return 2


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
