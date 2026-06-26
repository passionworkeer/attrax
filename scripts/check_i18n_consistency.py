#!/usr/bin/env python3
"""i18n key consistency checker.

Scans every `t("a.b.c")` call in components/, app/, lib/ and verifies that
the key exists in both `translations.zh` and `translations.en` blocks of
lib/i18n/translations.ts.

Reports:
  - Missing in zh / missing in en (developer forgot one side)
  - Unused translations (defined but never referenced — dead code)
  - All counts per top-level key namespace

Exits non-zero when there are missing translations, so it can gate CI.

Usage: python scripts/check_i18n_consistency.py [--strict]
"""
from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

# Ensure UTF-8 output on Windows consoles.
if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
        sys.stderr.reconfigure(encoding="utf-8")
    except (AttributeError, OSError):
        pass

REPO_ROOT = Path(__file__).resolve().parent.parent
TRANSLATIONS_FILE = REPO_ROOT / "lib" / "i18n" / "translations.ts"
SOURCE_GLOBS = ("components", "app", "lib")

# Files that define their own local `t = (key) => translate("prefix." + key)` wrappers.
# Their t("xxx") calls actually resolve to "prefix.xxx" — the global regex can't
# see that prefix, so they'd be reported as false positives. Exclude them.
EXCLUDE_FILES = ("app/[locale]/page.tsx",)

# Match t("foo.bar") / t('foo.bar') / t(`foo.bar`) — both quote styles.
# Require at least one char after the dot to skip dynamic-key patterns like
# t("trace." + type) where "trace." alone isn't a real key.
KEY_PATTERN = re.compile(r'\bt\(\s*["\']([a-zA-Z][\w]*\.[\w]+)["\']')


def collect_used_keys() -> set[str]:
    used: set[str] = set()
    for folder in SOURCE_GLOBS:
        base = REPO_ROOT / folder
        if not base.exists():
            continue
        for f in base.rglob("*.tsx"):
            # Skip files with local t() wrappers (see EXCLUDE_FILES).
            rel = str(f.relative_to(REPO_ROOT)).replace("\\", "/")
            if rel in EXCLUDE_FILES:
                continue
            try:
                content = f.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                continue
            for m in KEY_PATTERN.finditer(content):
                used.add(m.group(1))
    return used


def collect_defined_keys(translations: dict, locale: str) -> set[str]:
    defined: set[str] = set()
    block = translations.get(locale, {})

    def walk(obj, prefix=""):
        for k, v in obj.items():
            key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, dict):
                walk(v, key)
            else:
                defined.add(key)
    walk(block)
    return defined


def parse_translations_file(path: Path) -> dict:
    """Naive parse: extract 'zh: { ... }' and 'en: { ... }' as JSON-ish blobs.

    translations.ts is TypeScript, but the data shape is JSON-compatible for
    the purpose of key extraction (no JS functions, just string leaves).
    We use a bracket-counter to isolate each locale's top-level block, then
    json.loads after stripping TypeScript-only bits.
    """
    text = path.read_text(encoding="utf-8")
    # Locate "zh: {" and "en: {" markers.
    result: dict = {}
    for locale in ("zh", "en"):
        marker = f"  {locale}: {{"
        start = text.find(marker)
        if start == -1:
            continue
        # Find matching closing brace from end.
        i = start + len(marker) - 1  # position of '{'
        depth = 0
        for j in range(i, len(text)):
            ch = text[j]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    # Extract from opening { through closing } inclusive
                    # so the blob is itself a valid JSON object.
                    blob = text[i : j + 1]
                    # Strip TS-only bits: trailing commas before }/].
                    blob = re.sub(r",\s*([}\]])", r"\1", blob)
                    # Strip single-line comments.
                    blob = re.sub(r"//.*?$", "", blob, flags=re.MULTILINE)
                    # Quote unquoted identifier-style keys (JSON requires double quotes,
                    # JS allows bare identifiers — TS objects in this file use the latter).
                    blob = re.sub(
                        r"([{,]\s*)([a-zA-Z_][\w]*)\s*:",
                        r'\1"\2":',
                        blob,
                    )
                    try:
                        result[locale] = json.loads(blob)
                    except json.JSONDecodeError as exc:
                        print(f"WARN: failed to parse {locale} block: {exc}", file=sys.stderr)
                    break
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="Exit non-zero on unused translations too.")
    args = parser.parse_args()

    translations = parse_translations_file(TRANSLATIONS_FILE)
    if not translations:
        print(f"ERROR: no locale blocks parsed from {TRANSLATIONS_FILE}", file=sys.stderr)
        return 2

    used = collect_used_keys()
    zh_defined = collect_defined_keys(translations, "zh")
    en_defined = collect_defined_keys(translations, "en")

    missing_in_zh = sorted(used - zh_defined)
    missing_in_en = sorted(used - en_defined)
    unused_zh = sorted(zh_defined - used)
    unused_en = sorted(en_defined - used)

    print(f"Used keys (referenced by t()):     {len(used)}")
    print(f"Defined keys in zh:                {len(zh_defined)}")
    print(f"Defined keys in en:                {len(en_defined)}")
    print()

    by_namespace: dict[str, dict[str, int]] = {}
    for k in used:
        ns = k.split(".", 1)[0]
        by_namespace.setdefault(ns, {"used": 0, "missing_zh": 0, "missing_en": 0})
        by_namespace[ns]["used"] += 1
    for k in missing_in_zh:
        by_namespace.setdefault(k.split(".", 1)[0], {"used": 0, "missing_zh": 0, "missing_en": 0})
        by_namespace[k.split(".", 1)[0]]["missing_zh"] += 1
    for k in missing_in_en:
        by_namespace.setdefault(k.split(".", 1)[0], {"used": 0, "missing_zh": 0, "missing_en": 0})
        by_namespace[k.split(".", 1)[0]]["missing_en"] += 1

    print("By top-level namespace:")
    print(f"  {'namespace':<20} {'used':>5} {'missing_zh':>11} {'missing_en':>11}")
    for ns in sorted(by_namespace):
        c = by_namespace[ns]
        print(f"  {ns:<20} {c['used']:>5} {c['missing_zh']:>11} {c['missing_en']:>11}")
    print()

    failed = False

    if missing_in_zh:
        print(f"❌ Missing in zh ({len(missing_in_zh)}):")
        for k in missing_in_zh[:20]:
            print(f"   {k}")
        if len(missing_in_zh) > 20:
            print(f"   ... and {len(missing_in_zh) - 20} more")
        failed = True
    else:
        print("✓ All used keys present in zh")

    if missing_in_en:
        print(f"❌ Missing in en ({len(missing_in_en)}):")
        for k in missing_in_en[:20]:
            print(f"   {k}")
        if len(missing_in_en) > 20:
            print(f"   ... and {len(missing_in_en) - 20} more")
        failed = True
    else:
        print("✓ All used keys present in en")

    if unused_zh or unused_en:
        unused_count = max(len(unused_zh), len(unused_en))
        print(f"\n⚠ Unused translations (defined but never referenced): {unused_count}")
        if args.strict:
            failed = True
            for k in unused_zh[:10]:
                print(f"   zh unused: {k}")
            for k in unused_en[:10]:
                print(f"   en unused: {k}")

    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())