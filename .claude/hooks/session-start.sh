#!/bin/bash
# SessionStart bootstrap for Claude Code on the web.
#
# Why this exists: `src/generated/` is gitignored (.gitignore:25) and the
# remote container clones fresh, so a new session starts with no node_modules
# and no Prisma client. Every one of the five CI gates AGENTS.md tells the
# agent to run — lint, lint:tokens, typecheck, test, build — fails on arrival
# without them. CI does the same two steps after checkout
# (.github/workflows/ci.yml), so this just brings a session to parity.
#
# Guarded: it does nothing when the dependencies are already present, so
# resumed sessions pay no startup cost. A cold install is ~50s.
set -euo pipefail

# Local checkouts install via the README's step 1; only the remote container
# starts empty. Drop this block if you want the bootstrap locally too.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

if [ ! -d node_modules ]; then
  echo "[session-start] node_modules missing — installing dependencies"
  # --immutable matches CI and protects the lockfile. If package.json and
  # yarn.lock have genuinely diverged it would abort and leave the session
  # unusable, so fall back to a normal install rather than starting broken.
  yarn install --immutable || {
    echo "[session-start] --immutable failed; retrying without it (this may update yarn.lock)"
    yarn install
  }
elif [ ! -d src/generated/prisma ]; then
  # postinstall runs db:generate, so this only triggers if the client was
  # removed after a successful install.
  echo "[session-start] Prisma client missing — generating"
  yarn db:generate
fi

echo "[session-start] ready: $(node -v), deps $([ -d node_modules ] && echo present || echo MISSING), prisma client $([ -d src/generated/prisma ] && echo present || echo MISSING)"

# Warn, don't fail. CI, the Dockerfile and production all run the version
# .node-version pins; a sandbox may not, and the gap is not always cosmetic —
# see the "Run the gates on the pinned Node" section of .claude/rules/testing.md
# for a case that passes on 22 and throws on 24. Failing here would make an
# otherwise-usable container refuse to start, so this only makes the gap visible.
pinned="$(tr -dc '0-9' < .node-version 2>/dev/null || true)"
actual="$(node -v 2>/dev/null | sed 's/^v//; s/\..*//')"
if [ -n "$pinned" ] && [ -n "$actual" ] && [ "$actual" != "$pinned" ]; then
  echo "[session-start] WARNING: Node $actual, but .node-version pins $pinned (CI, Docker and production all use $pinned)."
  echo "[session-start] A green local gate run is weaker evidence than a green CI run. See .claude/rules/testing.md."
fi
