#!/usr/bin/env python3
"""
Sync omnichat-copy-inventory.xlsx -> Plug-in/content.js + admin/skills.html.

One-way: the spreadsheet is the source of truth for copy text (and, where
unambiguous, the font-role -> CSS class). Source code is the source of truth
for structure/markup/behavior — this script only ever rewrites the text
between an element's data-copy-id tag and its next `<`, or a placeholder="..."
value, or (for a small allowlisted set of roles) a class="..." value.

Usage:
    python3 sync_copy_from_xlsx.py [--dry-run] [--xlsx PATH]

Requires: openpyxl (already a dependency of the xlsx tooling used to build the sheet).
"""
import argparse
import html
import re
import sys
from pathlib import Path

import openpyxl

DEV_ROOT = Path(
    "/Users/user/Library/CloudStorage/GoogleDrive-google@viviankwan.work/"
    "Shared drives/DF/DF 創意家居/VIV WIP/Omnichat/omnichat-analyzer-v2/development"
)
CONTENT_JS = DEV_ROOT / "Plug-in" / "content.js"
SKILLS_HTML = DEV_ROOT / "server" / "public" / "admin" / "skills.html"

# Roles whose CSS class is unambiguous within a given file — safe to re-apply
# if the sheet's Font Role column no longer matches what's in the code.
# Anything not listed here has its TEXT synced but its class left untouched.
PANEL_ROLE_CLASS = {
    "h1": "sanity-h1",
    "h2": "sanity-h2",
    "h3": "sanity-h3",
    "label": "sanity-label",
    "card-title": "sanity-card-title",
    "stat-label": "omni-stat-label",
    "nav-link": "omni-nav-link",
    "badge": "omni-senior-badge",
    "hint": "omni-hint-text",
    "radio-label": "omni-ai-label",
    "mono-caption": "omni-header-id",
}
ADMIN_ROLE_CLASS = {
    "badge": "badge",
    "mono-caption": "skill-hint",
}

DYNAMIC_MARKERS = ("${", "{n}")


def load_rows(xlsx_path):
    """Columns: Type | Tag/Stage | Font Role | Font Spec | Value | New Value. Only Type=="Copy" rows apply here."""
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    ws = wb["Copy & Stage Names"]
    rows = []
    for r in ws.iter_rows(min_row=2, values_only=True):
        row_type, tag, role, _spec, text = r[0], r[1], r[2], r[3], r[4]
        if row_type != "Copy" or not tag:
            continue
        rows.append((str(tag).strip(), (role or "").strip(), "" if text is None else str(text)))
    return rows


def find_tag_span(content, tag):
    """Find the `<... data-copy-id="tag" ...>` opening tag. Returns (start, end) of the whole opening tag, or None."""
    m = re.search(r'<[a-zA-Z0-9]+\b[^>]*\bdata-copy-id="%s"[^>]*>' % re.escape(tag), content)
    if not m:
        return None
    return m.start(), m.end()


def sync_file(path, rows, role_class_map, dry_run):
    content = path.read_text(encoding="utf-8")
    original = content
    changed_text, changed_class, skipped_dynamic, skipped_rich, not_found, ambiguous_role = [], [], [], [], [], []

    for tag, role, text in rows:
        span = find_tag_span(content, tag)
        if not span:
            not_found.append(tag)
            continue
        tag_start, tag_end = span
        opening_tag = content[tag_start:tag_end]

        # --- class sync (only for allowlisted, unambiguous roles) ---
        target_class = role_class_map.get(role)
        if target_class:
            class_m = re.search(r'class="([^"]*)"', opening_tag)
            if class_m and target_class not in class_m.group(1).split():
                new_opening = opening_tag[:class_m.start(1)] + target_class + opening_tag[class_m.end(1):]
                if new_opening != opening_tag:
                    content = content[:tag_start] + new_opening + content[tag_end:]
                    changed_class.append((tag, class_m.group(1), target_class))
                    tag_end = tag_start + len(new_opening)
                    opening_tag = new_opening
        elif role and role not in ("placeholder", "icon") and role not in role_class_map:
            ambiguous_role.append((tag, role))

        # --- placeholder attribute sync ---
        if 'placeholder="' in opening_tag and 'data-copy-id="%s"' % tag in opening_tag:
            ph_m = re.search(r'placeholder="([^"]*)"', opening_tag)
            if ph_m:
                current = html.unescape(ph_m.group(1))
                if current.strip() != text.strip():
                    new_val = html.escape(text, quote=True)
                    new_opening = opening_tag[:ph_m.start(1)] + new_val + opening_tag[ph_m.end(1):]
                    content = content[:tag_start] + new_opening + content[tag_end:]
                    changed_text.append((tag, current, text))
            continue

        # --- inner-text sync: text runs from end of opening tag to the next '<' ---
        rest = content[tag_end:]
        next_lt = rest.find("<")
        raw_current = rest[:next_lt] if next_lt != -1 else rest

        if raw_current.strip() == "":
            # Nested markup starts immediately (e.g. <strong>/<span> right after
            # the tag) — this row's "copy text" is a flattened view of richer
            # content. Rewriting it verbatim would destroy that markup.
            skipped_rich.append(tag)
            continue

        current_text = html.unescape(raw_current)
        if any(m in current_text for m in DYNAMIC_MARKERS):
            skipped_dynamic.append(tag)
            continue

        if current_text.strip() != text.strip():
            leading_ws = raw_current[:len(raw_current) - len(raw_current.lstrip())]
            trailing_ws = raw_current[len(raw_current.rstrip()):]
            new_text = leading_ws + html.escape(text.strip(), quote=False) + trailing_ws
            content = content[:tag_end] + new_text + content[tag_end + len(raw_current):]
            changed_text.append((tag, current_text.strip(), text.strip()))

    if content != original and not dry_run:
        path.write_text(content, encoding="utf-8")

    return {
        "file": str(path),
        "changed_text": changed_text,
        "changed_class": changed_class,
        "skipped_dynamic": skipped_dynamic,
        "skipped_rich": skipped_rich,
        "not_found": not_found,
        "ambiguous_role": ambiguous_role,
        "wrote": content != original and not dry_run,
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="Report what would change without writing files.")
    ap.add_argument("--xlsx", default=str(Path(__file__).parent / "omnichat-copy-inventory.xlsx"))
    args = ap.parse_args()

    rows = load_rows(args.xlsx)
    panel_rows = [r for r in rows if r[0].startswith("panel.")]
    admin_rows = [r for r in rows if r[0].startswith("admin.")]

    results = [
        sync_file(CONTENT_JS, panel_rows, PANEL_ROLE_CLASS, args.dry_run),
        sync_file(SKILLS_HTML, admin_rows, ADMIN_ROLE_CLASS, args.dry_run),
    ]

    for res in results:
        print(f"\n=== {res['file']} ===")
        print(f"  text changed:  {len(res['changed_text'])}")
        for tag, old, new in res["changed_text"]:
            print(f"    - {tag}: {old!r} -> {new!r}")
        print(f"  class changed: {len(res['changed_class'])}")
        for tag, old, new in res["changed_class"]:
            print(f"    - {tag}: class {old!r} -> {new!r}")
        if res["skipped_dynamic"]:
            print(f"  skipped (dynamic content, edit code directly): {res['skipped_dynamic']}")
        if res["skipped_rich"]:
            print(f"  skipped (nested/rich markup, edit code directly): {res['skipped_rich']}")
        if res["ambiguous_role"]:
            print(f"  role changed but ambiguous class, left as-is: {res['ambiguous_role']}")
        if res["not_found"]:
            print(f"  ⚠ tags in spreadsheet but not found in file: {res['not_found']}")
        print(f"  {'DRY RUN — nothing written' if args.dry_run else ('file updated' if res['wrote'] else 'no changes needed')}")

    print()


if __name__ == "__main__":
    main()
