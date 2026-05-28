#!/bin/sh
set -e

# Apply pending migrations, with a timeout so a hung DB doesn't block boot forever.
# Invoke the local binary directly (not npx) so boot is deterministic and never
# touches the registry/network to resolve the CLI.
echo "Running database migrations..."
timeout 120 ./node_modules/.bin/prisma migrate deploy || {
  echo "ERROR: Database migrations failed or timed out after 120 seconds"
  exit 1
}

# Hand off to the container command (CMD / compose `command`).
exec "$@"
