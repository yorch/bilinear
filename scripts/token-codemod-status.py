#!/usr/bin/env python3
"""Migrate raw semantic Tailwind colours onto the status token family.

The pre-existing `yarn lint:tokens` guard only ever banned `zinc-*`, `indigo-*`
and hex literals, so a second population of raw colours — red/amber/green/blue
status usage — accumulated unchecked (330 occurrences across 49 files). They
collapse cleanly into four semantic roles plus GitHub's "merged" purple.

Why a light/dark pair becomes ONE class: `--danger` and friends are already
redefined under `.dark` in globals.css, so `text-danger-subtle-foreground`
resolves correctly in both themes. Any `dark:` variant that lands on the same
token as its bare counterpart is therefore dead weight and gets dropped — the
same dedup the 2026-07-10 simplify pass applied to the brand tokens.

Run:  python3 scripts/token-codemod-status.py [--check]
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOTS = ['src/components', 'src/app', 'src/lib', 'src/hooks']
SUFFIXES = {'.ts', '.tsx'}

FAMILY_ROLE = {
    'red': 'danger',
    'rose': 'danger',
    'amber': 'warning',
    'yellow': 'warning',
    'orange': 'warning',
    'green': 'success',
    'emerald': 'success',
    'blue': 'info',
    'sky': 'info',
    'purple': 'merged',
    'violet': 'merged',
}

# Shades that read as a tint rather than a fill. A background at one of these
# is a subtle surface; anything else is a solid swatch (a status dot, a filled
# badge), which must stay vivid.
TINT_SHADES = {'50', '100', '200', '800', '900', '950'}

PROPS = 'bg|text|border|ring|fill|stroke|divide|from|to|placeholder|decoration|outline|caret|shadow|accent'

UTILITY_RE = re.compile(
    r'(?<![\w-])'
    r'(?P<variants>(?:[a-z][a-z0-9-]*:)*)'
    r'(?P<prop>' + PROPS + r')-'
    r'(?P<family>' + '|'.join(FAMILY_ROLE) + r')-'
    r'(?P<shade>\d{2,3})'
    r'(?P<opacity>/\d{1,3})?'
    r'(?![\w-])'
)


def target(prop: str, family: str, shade: str, opacity: str) -> str:
    role = FAMILY_ROLE[family]

    if prop in ('text', 'placeholder', 'decoration', 'caret'):
        # The on-subtle foreground is the only variant legible against BOTH
        # the page ground and the matching subtle fill, in both themes — which
        # is exactly what text has to survive.
        base = f'{prop}-{role}-subtle-foreground'
    elif prop == 'bg':
        base = f'bg-{role}-subtle' if shade in TINT_SHADES else f'bg-{role}'
    elif prop in ('border', 'divide', 'outline'):
        return f'{prop}-{role}{opacity or "/40"}'
    else:
        base = f'{prop}-{role}'

    return base + (opacity or '')


def convert(text: str) -> tuple[str, int]:
    count = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal count
        count += 1
        return m.group('variants') + target(
            m.group('prop'), m.group('family'), m.group('shade'), m.group('opacity') or ''
        )

    return UTILITY_RE.sub(sub, text), count


STRING_RE = re.compile(r"'[^'\n]*'|\"[^\"\n]*\"|`[^`]*`", re.DOTALL)


def dedupe_dark(text: str) -> tuple[str, int]:
    """Drop `dark:X` when a bare `X` is present in the same class string.

    Only ever removes an exact duplicate of a class already in the string, so
    `bg-danger-subtle/40` can never be collapsed into a distinct
    `dark:bg-danger-subtle`.
    """
    removed = 0

    def sub(m: re.Match[str]) -> str:
        nonlocal removed
        literal = m.group(0)
        quote, body = literal[0], literal[1:-1]
        parts = body.split(' ')
        present = {p for p in parts if p and not p.startswith('dark:')}
        kept = []
        for part in parts:
            if part.startswith('dark:') and part[len('dark:'):] in present:
                removed += 1
                continue
            kept.append(part)
        return quote + ' '.join(kept) + quote

    return STRING_RE.sub(sub, text), removed


STATUS_ROLES = 'danger|success|warning|info|merged'
DARK_STATUS_RE = re.compile(
    r' ?dark:(?P<prop>bg|text|border|ring)-'
    r'(?P<role>' + STATUS_ROLES + r')'
    r'(?P<suffix>-subtle(?:-foreground)?)?'
    r'(?:/\d{1,3})?'
    r'(?![\w-])'
)


def strip_redundant_dark_status(text: str) -> tuple[str, int]:
    """Drop `dark:` variants of status tokens that are already theme-aware.

    `--danger` and friends are redefined under `.dark`, so a `dark:` variant
    only double-applies the adaptation — typically an opacity left over from
    when the dark side needed its own fixed shade, which now renders the fill
    fainter in dark mode than in light.

    Runs per line, and only strips when the same prop+role appears bare on
    that line, so a `dark:`-only usage (which would lose its colour entirely)
    is left alone. That is the case the string-literal dedup above cannot see
    through a surrounding template literal.
    """
    removed = 0
    out_lines = []
    for line in text.split('\n'):
        def sub(m: re.Match[str]) -> str:
            nonlocal removed
            bare = f"{m.group('prop')}-{m.group('role')}{m.group('suffix') or ''}"
            if not re.search(r'(?<![\w:-])' + re.escape(bare) + r'(?![\w-])', line):
                return m.group(0)
            removed += 1
            return ''

        out_lines.append(DARK_STATUS_RE.sub(sub, line))
    return '\n'.join(out_lines), removed


def main() -> int:
    check = '--check' in sys.argv
    files = [
        path
        for root in ROOTS
        for path in Path(root).rglob('*')
        if path.suffix in SUFFIXES and path.is_file()
    ]

    total_converted = total_removed = touched = 0
    for path in sorted(files):
        original = path.read_text(encoding='utf-8')
        converted, n = convert(original)
        converted, removed = dedupe_dark(converted)
        converted, stripped = strip_redundant_dark_status(converted)
        if converted == original:
            continue
        total_converted += n
        total_removed += removed + stripped
        touched += 1
        if not check:
            path.write_text(converted, encoding='utf-8')

    verb = 'would convert' if check else 'converted'
    print(f'{verb} {total_converted} occurrences in {touched} files '
          f'({total_removed} redundant dark: variants dropped)')
    return 1 if (check and total_converted) else 0


if __name__ == '__main__':
    raise SystemExit(main())
