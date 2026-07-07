#!/usr/bin/env python3
"""
Second-pass design-token codemod (docs/UI_UX_ASSESSMENT.md §8 follow-up).

Unlike token-codemod.py (which only matched exact, literally-adjacent
"light-token dark:token" substrings), this pass tokenizes each Tailwind
class-list string literal and reasons about same-property light/dark pairs
regardless of where else in the string they sit, and regardless of whether
the light side is spelled as a zinc-* shade or a plain Tailwind color name
(white/black) that the raw-color guard doesn't even flag on its own.

IMPORTANT: string literals are located ONLY inside `className=` attributes/
props — never by scanning for quote characters file-wide. An apostrophe
inside a comment or JSX text ("don't", "it's") is not a string delimiter,
but a naive whole-file quote-to-quote regex will treat it as one, matching
everything up to the next unrelated quote and corrupting whatever lies
between (this bit us once — see git history). Restricting to `className=`
spans, and refusing to match a raw newline inside a plain '...'/"..." pair
(a real JS string literal can't contain one unescaped), keeps every match
bounded to an actual class-list string.

Scope, deliberately bounded:
  - Only text-/bg-/border-/divide- utilities (no ring-/placeholder-/indigo,
    those are handled separately or left as intentional brand color).
  - Only tokens with no opacity suffix (`/50` etc.) — left untouched.
  - Background rules only fire when BOTH a light and a dark utility are
    present in the same string (a real pair, just spelled with `white` or
    non-adjacent) — a background utility present in only one theme is
    deliberately left alone (it may be an intentionally theme-invariant
    dark chip/badge, and guessing wrong here is a real visual regression
    a codemod can't self-check).
  - Text/border rules also fire for a utility present in only ONE theme
    (no companion opposite-theme color at all): every themed element needs
    *some* visible text/border color in both modes, so a single-theme-only
    zinc shade is a real bug (same raw color in both themes, or literally
    unset for one of them), not a deliberate design choice — converting it
    to the semantic token fixes exactly that gap. Backgrounds don't get
    this same-theme-only treatment (see above).

Run: python3 scripts/token-codemod-batch2.py [--dry-run]
"""
import argparse
import pathlib
import re

ROOTS = ["src/components", "src/app"]

# A plain '...'/"..." class-list string literal cannot legally contain a raw
# newline (that would be a syntax error in real JS/TS), so excluding \n from
# the body class also protects against ever matching past the intended
# closing quote.
PLAIN_STRING = r"'[^'\n]*'|\"[^\"\n]*\""
TEMPLATE_STRING = r"`[^`]*`"

CLASSNAME_ATTR_RE = re.compile(
    r"className=(?:"
    rf"(?P<simple>{PLAIN_STRING})"
    rf"|\{{(?P<template>{TEMPLATE_STRING})\}}"
    r"|\{(?P<cn>cn\()"
    r")"
)

QUOTED_RE = re.compile(rf"({PLAIN_STRING}|{TEMPLATE_STRING})")

TOKEN_RE = re.compile(
    r"^(?P<variants>(?:[a-z-]+:)*)(?P<prop>text|bg|border|divide)-(?P<hue>zinc|white|black)(?:-(?P<shade>\d{2,3}))?$"
)


def find_balanced_paren_end(text, open_paren_idx):
    """`text[open_paren_idx]` must be '('. Returns index just past the matching ')'."""
    depth = 0
    i = open_paren_idx
    while i < len(text):
        if text[i] == "(":
            depth += 1
        elif text[i] == ")":
            depth -= 1
            if depth == 0:
                return i + 1
        i += 1
    return len(text)  # unbalanced — treat as "rest of file", caller should sanity-check


def parse_token(tok):
    m = TOKEN_RE.match(tok)
    if not m:
        return None
    variants = [v for v in m.group("variants").split(":") if v]
    is_dark = "dark" in variants
    other_variants = tuple(v for v in variants if v != "dark")
    return {
        "prop": m.group("prop"),
        "hue": m.group("hue"),
        "shade": m.group("shade"),
        "is_dark": is_dark,
        "variants": other_variants,
    }


def make_target(prop, variants, name):
    prefix = "".join(f"{v}:" for v in variants)
    return f"{prefix}{prop}-{name}"


# (prop, light (hue, shade), dark (hue, shade)) -> semantic name (used after `text-`/`bg-`/`border-`/`divide-`)
PAIR_RULES = {
    ("text", ("zinc", "500"), ("zinc", "400")): "muted-foreground",
    ("text", ("zinc", "400"), ("zinc", "500")): "muted-foreground",
    ("text", ("zinc", "600"), ("zinc", "400")): "muted-foreground",
    ("text", ("zinc", "600"), ("zinc", "300")): "muted-foreground",
    ("text", ("zinc", "600"), ("zinc", "500")): "muted-foreground",
    ("text", ("zinc", "400"), ("zinc", "600")): "muted-foreground",
    ("text", ("zinc", "900"), ("zinc", "100")): "foreground",
    ("text", ("zinc", "900"), ("zinc", "50")): "foreground",
    ("text", ("zinc", "800"), ("zinc", "100")): "foreground",
    ("bg", ("white", None), ("zinc", "900")): "card",
    ("bg", ("white", None), ("zinc", "800")): "card",
    ("bg", ("zinc", "50"), ("zinc", "900")): "card",
    ("bg", ("zinc", "50"), ("zinc", "800")): "card",
    ("bg", ("zinc", "100"), ("zinc", "800")): "muted",
    ("bg", ("zinc", "200"), ("zinc", "800")): "muted",
    ("bg", ("zinc", "200"), ("zinc", "700")): "muted",
    ("bg", ("zinc", "50"), ("zinc", "950")): "background",
    ("border", ("zinc", "200"), ("zinc", "700")): "border",
    ("border", ("zinc", "200"), ("zinc", "800")): "border",
    ("border", ("zinc", "100"), ("zinc", "800")): "border",
    ("border", ("zinc", "300"), ("zinc", "700")): "border",
    ("border", ("zinc", "300"), ("zinc", "600")): "border",
    ("divide", ("zinc", "100"), ("zinc", "800")): "border",
}

# Single-theme-only rules — text/border ONLY (see module docstring for why
# backgrounds are excluded). Applies when a shade shows up in just one theme
# with no opposite-theme companion at all in the same string.
SOLO_RULES = {
    ("text", "400"): "muted-foreground",
    ("text", "500"): "muted-foreground",
    ("text", "600"): "muted-foreground",
    ("text", "300"): "muted-foreground",
    ("text", "700"): "foreground",
    ("text", "800"): "foreground",
    ("text", "900"): "foreground",
    ("text", "100"): "foreground",
    ("text", "50"): "foreground",
    ("border", "200"): "border",
    ("border", "300"): "border",
    ("border", "100"): "border",
    ("border", "700"): "border",
    ("border", "800"): "border",
    ("border", "600"): "border",
}


def rewrite_class_string(s):
    """s is the class-list text WITHOUT surrounding quotes. Returns (new, applied_count)."""
    if "-zinc-" not in s and "bg-white" not in s and "text-white" not in s:
        return s, 0

    tokens = s.split(" ")
    parsed = [parse_token(t) if t else None for t in tokens]

    groups = {}
    for i, p in enumerate(parsed):
        if p is None:
            continue
        key = (p["prop"], p["variants"])
        groups.setdefault(key, []).append(i)

    # Phase 1: propose a target name per (prop, variants) group WITHOUT
    # committing anything yet — a base group and its hover:/focus: sibling
    # are resolved independently here, and a base color that's merely
    # "muted" and a hover color that's merely "less muted" can each, on
    # their own, land on the same semantic name (e.g. both -> muted-
    # foreground). Applying both would make the hover state visually
    # identical to the resting state and silently erase the hover feedback
    # — this is exactly the kind of thing the *pair* being spelled with two
    # different raw shades was there to produce. Phase 2 below detects that
    # and keeps only the base group's conversion, leaving the hover/focus
    # group's tokens raw.
    proposals = {}  # (prop, variants) -> {"name": str, "li": idx|None, "di": idx|None}

    for (prop, variants), idxs in groups.items():
        light_idxs = [i for i in idxs if not parsed[i]["is_dark"]]
        dark_idxs = [i for i in idxs if parsed[i]["is_dark"]]
        if len(light_idxs) > 1 or len(dark_idxs) > 1:
            continue

        if light_idxs and dark_idxs:
            li, di = light_idxs[0], dark_idxs[0]
            lp, dp = parsed[li], parsed[di]
            key = (prop, (lp["hue"], lp["shade"]), (dp["hue"], dp["shade"]))
            name = PAIR_RULES.get(key)
            if name is None:
                continue
            # "card" represents an element's own resting surface — applying
            # it under a hover:/focus: variant would make the hover state
            # visually equal to (or, in dark mode, lighter/darker in the
            # wrong direction from) the base state instead of standing out
            # from it, silently killing the hover feedback. Leave those raw.
            if name == "card" and variants != ():
                continue
            proposals[(prop, variants)] = {"name": name, "li": li, "di": di}
        elif light_idxs and prop in ("text", "border"):
            li = light_idxs[0]
            lp = parsed[li]
            if lp["hue"] != "zinc":
                continue
            name = SOLO_RULES.get((prop, lp["shade"]))
            if name is None:
                continue
            proposals[(prop, variants)] = {"name": name, "li": li, "di": None}
        elif dark_idxs and prop in ("text", "border"):
            di = dark_idxs[0]
            dp = parsed[di]
            if dp["hue"] != "zinc":
                continue
            name = SOLO_RULES.get((prop, dp["shade"]))
            if name is None:
                continue
            proposals[(prop, variants)] = {"name": name, "li": None, "di": di}

    # Phase 2: drop a non-base (hover:/focus:/...) proposal whose target
    # name collides with its prop's base (variants == ()) proposal.
    props_with_collision = set()
    for (prop, variants), proposal in proposals.items():
        if variants == ():
            continue
        base = proposals.get((prop, ()))
        if base is not None and base["name"] == proposal["name"]:
            props_with_collision.add((prop, variants))
    for key in props_with_collision:
        del proposals[key]

    if not proposals:
        return s, 0

    applied = 0
    to_delete = set()
    replacements = {}
    for (prop, variants), proposal in proposals.items():
        replacements[proposal["li"] if proposal["li"] is not None else proposal["di"]] = (
            make_target(prop, variants, proposal["name"])
        )
        if proposal["li"] is not None and proposal["di"] is not None:
            to_delete.add(proposal["di"])
        applied += 1

    out = []
    for i, tok in enumerate(tokens):
        if i in to_delete:
            continue
        out.append(replacements.get(i, tok))
    new_s = " ".join(t for t in out if t != "")
    return new_s, applied


def rewrite_quoted_literal(quoted):
    """`quoted` includes its surrounding quote/backtick characters."""
    quote = quoted[0]
    inner = quoted[1:-1]
    new_inner, applied = rewrite_class_string(inner)
    if applied == 0:
        return quoted, 0
    return f"{quote}{new_inner}{quote}", applied


def process_file(path, dry_run):
    text = path.read_text()
    total_applied = 0
    out = []
    pos = 0

    for m in CLASSNAME_ATTR_RE.finditer(text):
        out.append(text[pos:m.start()])

        if m.group("simple") is not None:
            new_lit, applied = rewrite_quoted_literal(m.group("simple"))
            out.append(f"className={new_lit}")
            total_applied += applied
            pos = m.end()
        elif m.group("template") is not None:
            new_lit, applied = rewrite_quoted_literal(m.group("template"))
            out.append(f"className={{{new_lit}}}")
            total_applied += applied
            pos = m.end()
        else:
            # cn( ... ) — find the balanced close, rewrite every quoted
            # literal argument inside, leave everything else (JS
            # expressions, commas, ternaries) untouched.
            open_paren_idx = m.end() - 1  # index of '(' in "cn("
            close_idx = find_balanced_paren_end(text, open_paren_idx)
            block = text[m.end():close_idx - 1]  # content between "cn(" and its ")"
            # The "}" closing the outer className={...} — found by scanning
            # forward rather than assumed-adjacent, so any incidental
            # whitespace between ")" and "}" round-trips unchanged.
            brace_idx = text.index("}", close_idx)

            block_out = []
            block_pos = 0
            for qm in QUOTED_RE.finditer(block):
                block_out.append(block[block_pos:qm.start()])
                new_lit, applied = rewrite_quoted_literal(qm.group(0))
                block_out.append(new_lit)
                total_applied += applied
                block_pos = qm.end()
            block_out.append(block[block_pos:])

            out.append(f"className={{cn({''.join(block_out)}){text[close_idx:brace_idx]}}}")
            pos = brace_idx + 1

    out.append(text[pos:])
    new_text = "".join(out)

    if new_text != text and not dry_run:
        path.write_text(new_text)
    return total_applied, new_text != text


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    changed_files = 0
    total_applied = 0
    for root in ROOTS:
        for path in pathlib.Path(root).rglob("*.tsx"):
            applied, changed = process_file(path, args.dry_run)
            if changed:
                changed_files += 1
                print(f"  {applied:3d}  {path}")
            total_applied += applied

    verb = "Would change" if args.dry_run else "Changed"
    print(f"{verb} {changed_files} files, {total_applied} substitutions.")


if __name__ == "__main__":
    main()
