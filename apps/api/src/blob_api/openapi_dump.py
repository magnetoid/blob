"""Print the OpenAPI schema.

The generated TypeScript in `packages/shared/src/generated/` is produced from this, and
`pnpm check:contract` diffs it against the hand-written types the client still imports.
Generation is a verifier first; it becomes the source of truth only once that diff has
been quiet for a while.
"""

from __future__ import annotations

import json
import sys

from .main import app


def main() -> None:
    json.dump(app.openapi(), sys.stdout, indent=2, sort_keys=True)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
