#!/usr/bin/env python3
"""
One-time codemod: replace the highest-confidence raw zinc/white Tailwind
color pairs with their semantic token equivalents across src/components and
src/app.

Every pattern is matched only at Tailwind class-token boundaries — the
character immediately before a match must be start-of-string or whitespace,
and the character immediately after must be end-of-string, whitespace, or a
closing quote/backtick. This is NOT a plain substring replace: without the
boundary check, a pattern like "border-zinc-300 dark:border-zinc-700" would
also match inside the unrelated token "hover:border-zinc-300 dark:border-
zinc-700", silently dropping the "hover:" pseudo-class prefix and changing
its meaning. Every match is verified against both boundaries before it's
applied.

No guessing at intent for ambiguous or context-dependent combinations —
those are deliberately left out (see docs/UI_UX_ASSESSMENT.md §2 RC1).

Run once: python3 scripts/token-codemod.py
"""
import pathlib

ROOTS = ["src/components", "src/app"]
BOUNDARY_CHARS = set(" \t\n\"'`")

# Ordered: more specific (opacity-suffixed) patterns before their general
# counterpart, so the general pattern can't partially eat a suffixed one.
REPLACEMENTS = [
    # Muted / secondary text
    ("text-zinc-500 dark:text-zinc-400", "text-muted-foreground"),
    ("text-zinc-400 dark:text-zinc-500", "text-muted-foreground"),
    ("text-zinc-600 dark:text-zinc-400", "text-muted-foreground"),
    ("text-zinc-600 dark:text-zinc-300", "text-muted-foreground"),
    ("text-zinc-600 dark:text-zinc-500", "text-muted-foreground"),
    ("text-zinc-400 dark:text-zinc-600", "text-muted-foreground"),
    # Primary/emphasized text
    ("text-zinc-900 dark:text-zinc-100", "text-foreground"),
    ("text-zinc-900 dark:text-zinc-50", "text-foreground"),
    ("text-zinc-800 dark:text-zinc-100", "text-foreground"),
    ("hover:text-zinc-900 dark:hover:text-zinc-100", "hover:text-foreground"),
    # Borders (this also converges the zinc-700 vs zinc-800 dark-border
    # drift the assessment flagged as visible inconsistency)
    ("border-zinc-200 dark:border-zinc-700", "border-border"),
    ("border-zinc-200 dark:border-zinc-800", "border-border"),
    ("border-zinc-100 dark:border-zinc-800", "border-border"),
    ("border-zinc-300 dark:border-zinc-700", "border-border"),
    ("border-zinc-300 dark:border-zinc-600", "border-border"),
    ("divide-zinc-100 dark:divide-zinc-800", "divide-border"),
    # Hover backgrounds (opacity-suffixed variants first)
    ("hover:bg-zinc-50 dark:hover:bg-zinc-800/50", "hover:bg-accent/50"),
    ("hover:bg-zinc-50 dark:hover:bg-zinc-900/50", "hover:bg-accent/50"),
    ("hover:bg-zinc-50 dark:hover:bg-zinc-800", "hover:bg-accent"),
    ("hover:bg-zinc-100 dark:hover:bg-zinc-800", "hover:bg-accent"),
    ("hover:bg-zinc-50 dark:hover:bg-zinc-900", "hover:bg-accent"),
    ("hover:bg-zinc-100 dark:hover:bg-zinc-700", "hover:bg-accent"),
    # Static subtle surfaces (muted/accent/secondary share the same computed
    # value in this token set, so bg-muted is a safe, non-visual-changing pick)
    ("bg-zinc-100 dark:bg-zinc-800", "bg-muted"),
    ("bg-zinc-200 dark:bg-zinc-800", "bg-muted"),
    # Same subtle-surface role (progress-bar tracks, dividers, skeleton
    # loaders — verified by inspecting every call site), just a shade
    # lighter/darker than the pair above.
    #
    # NOTE: "bg-zinc-300 dark:bg-zinc-600" is deliberately NOT a blanket rule
    # here — of its 5 call sites, 4 are the same divider role (fixed by hand)
    # but the 5th is `public-roadmap-view.tsx`'s HEALTH_DOTS "no update"
    # status-dot swatch, sharing a palette with `bg-yellow-400`/`bg-red-500`/
    # `bg-green-500`; `bg-muted` is calibrated for pale backgrounds (oklch
    # 0.97 light / 0.269 dark), not a same-weight solid dot, and would read
    # as nearly invisible next to the other three. Same literal string, two
    # different roles — not safe to codemod without per-site judgment.
    ("bg-zinc-200 dark:bg-zinc-700", "bg-muted"),
    # Whole-page background wrapper (auth layout, admin shell, public
    # roadmap) — `<body>` already renders `--background`, so this is these
    # wrappers catching up to the value they're redundantly re-painting.
    ("bg-zinc-50 dark:bg-zinc-950", "bg-background"),
    # Hand-rolled primary buttons — --primary IS indigo-600 now, so this is a
    # pure token substitution, not a color change. Only the fill; `text-white`
    # is left alone (still visually correct against --primary either way) and
    # full <button> → <Button> JSX adoption is a separate, larger follow-up.
    ("bg-indigo-600 hover:bg-indigo-700", "bg-primary hover:bg-primary/90"),
    # Same pair, but with padding/size/weight utilities between the base and
    # hover fill (the far more common layout) — safe as independent single
    # tokens since bg-indigo-600/hover:bg-indigo-700 only ever co-occur here
    # (verified: every file with one has the other) and --primary IS indigo-600.
    ("bg-indigo-600", "bg-primary"),
    ("hover:bg-indigo-700", "hover:bg-primary/90"),
]


def replace_at_boundaries(text: str, pattern: str, replacement: str) -> tuple[str, int, int]:
    """Replace `pattern` with `replacement` only where it sits at token
    boundaries on both sides. Returns (new_text, applied_count, skipped_count)."""
    out = []
    applied = 0
    skipped = 0
    pos = 0
    while True:
        idx = text.find(pattern, pos)
        if idx == -1:
            out.append(text[pos:])
            break
        before = text[idx - 1] if idx > 0 else None
        after_idx = idx + len(pattern)
        after = text[after_idx] if after_idx < len(text) else None
        ok_before = before is None or before in BOUNDARY_CHARS
        ok_after = after is None or after in BOUNDARY_CHARS
        if ok_before and ok_after:
            out.append(text[pos:idx])
            out.append(replacement)
            applied += 1
        else:
            out.append(text[pos:after_idx])
            skipped += 1
        pos = after_idx
    return "".join(out), applied, skipped


def main():
    changed_files = 0
    total_applied = 0
    total_skipped = 0
    per_pattern_applied = {p: 0 for p, _ in REPLACEMENTS}
    per_pattern_skipped = {p: 0 for p, _ in REPLACEMENTS}

    for root in ROOTS:
        for path in pathlib.Path(root).rglob("*.tsx"):
            text = path.read_text()
            original = text
            for pattern, replacement in REPLACEMENTS:
                text, applied, skipped = replace_at_boundaries(text, pattern, replacement)
                per_pattern_applied[pattern] += applied
                per_pattern_skipped[pattern] += skipped
                total_applied += applied
                total_skipped += skipped
            if text != original:
                path.write_text(text)
                changed_files += 1

    print(f"Changed {changed_files} files, {total_applied} substitutions "
          f"({total_skipped} boundary-ambiguous occurrences skipped).")
    print()
    for pattern, count in sorted(per_pattern_applied.items(), key=lambda kv: -kv[1]):
        skipped = per_pattern_skipped[pattern]
        if count or skipped:
            suffix = f"  (skipped {skipped})" if skipped else ""
            print(f"  {count:4d}  {pattern}{suffix}")


if __name__ == "__main__":
    main()
