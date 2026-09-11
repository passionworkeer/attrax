#!/usr/bin/env python3
"""
schema_validator.py — Validate the regulation library against regulation.schema.json.

Spec: docs/plans/2026-09-11-de-rag-evidence-spec.md §7.2 (Phase 3).

Usage:
  rag_service/.venv/bin/python3 scripts/schema_validator.py validate-regulations
      # Walk data/regulations/{region}/*.yaml and validate each against
      # data/regulations/schema/regulation.schema.json.

Exit codes:
  0 — all regulations pass validation
  1 — at least one regulation fails (errors printed to stderr)
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

import yaml  # noqa: E402


REGULATIONS_ROOT = REPO / "data" / "regulations"
SCHEMA_PATH = REGULATIONS_ROOT / "schema" / "regulation.schema.json"


def _validate_jsonschema(payload: dict, schema: dict) -> list[str]:
    """Validate `payload` against `schema` (JSON Schema draft-07 subset).

    We deliberately do NOT install `jsonschema` — the schema is small and
    the validation rules it exercises (required, enum, type, conditional,
    regex, $ref to internal definitions) are straightforward to implement
    in ~100 lines. This keeps `requirements-prod.txt` lean.

    Returns a list of failure messages; empty list means valid.
    """
    failures: list[str] = []

    # 1. Resolve $ref within schema (we only support internal refs)
    defs = schema.get("definitions", {})
    resolver = {"#": schema}

    def resolve(ref: str) -> dict:
        if ref.startswith("#/definitions/"):
            name = ref.split("/")[-1]
            return defs.get(name, {})
        return {}

    # 2. Type check
    expected_type = schema.get("type")
    if expected_type:
        if expected_type == "object" and not isinstance(payload, dict):
            failures.append(f"Expected object, got {type(payload).__name__}")
            return failures
        if expected_type == "array" and not isinstance(payload, list):
            failures.append(f"Expected array, got {type(payload).__name__}")
            return failures

    # 3. additionalProperties
    if expected_type == "object" and schema.get("additionalProperties") is False:
        allowed = set(schema.get("properties", {}).keys())
        extra = set(payload.keys()) - allowed
        if extra:
            failures.append(
                f"Unknown properties: {sorted(extra)} (allowed: {sorted(allowed)})"
            )

    # 4. required
    if expected_type == "object":
        required = list(schema.get("required", []))
        # Conditional: if/then/else — for the regulation schema, the
        # condition is on license==public|private
        if "if" in schema and "then" in schema and "else" in schema:
            if_clause = schema["if"]
            then_clause = schema["then"]
            else_clause = schema["else"]
            license_val = payload.get("license")
            branch = None
            if license_val == if_clause.get("properties", {}).get("license", {}).get("const"):
                branch = then_clause
            else:
                branch = else_clause
            if branch:
                required.extend(branch.get("required", []))
        missing = [k for k in required if k not in payload]
        if missing:
            failures.append(f"Missing required fields: {missing}")

    # 5. Property-by-property validation
    for key, value in payload.items():
        prop_schema = schema.get("properties", {}).get(key, {})
        if not prop_schema:
            continue
        # enum
        if "enum" in prop_schema and value not in prop_schema["enum"]:
            failures.append(
                f"Field `{key}`={value!r} not in enum {prop_schema['enum']!r}"
            )
        # const
        if "const" in prop_schema and value != prop_schema["const"]:
            failures.append(
                f"Field `{key}`={value!r} != const {prop_schema['const']!r}"
            )
        # type
        if "type" in prop_schema:
            expected = prop_schema["type"]
            if isinstance(expected, list):
                if not any(_matches_type(value, t) for t in expected):
                    failures.append(
                        f"Field `{key}` type mismatch: "
                        f"got {type(value).__name__}, expected one of {expected}"
                    )
            elif not _matches_type(value, expected):
                failures.append(
                    f"Field `{key}` type mismatch: "
                    f"got {type(value).__name__}, expected {expected}"
                )
        # minLength (string)
        if "minLength" in prop_schema and isinstance(value, str):
            if len(value) < prop_schema["minLength"]:
                failures.append(
                    f"Field `{key}` shorter than minLength "
                    f"({len(value)} < {prop_schema['minLength']})"
                )
        # pattern (string)
        if "pattern" in prop_schema and isinstance(value, str):
            import re
            if not re.search(prop_schema["pattern"], value):
                failures.append(
                    f"Field `{key}`={value!r} does not match pattern "
                    f"{prop_schema['pattern']!r}"
                )

    # 6. Articles array: validate each entry against article def
    if "articles" in payload and isinstance(payload["articles"], list):
        article_schema = defs.get("article", {})
        for i, article in enumerate(payload["articles"]):
            article_failures = _validate_jsonschema(article, article_schema)
            for f in article_failures:
                failures.append(f"articles[{i}].{f}")

    return failures


def _matches_type(value, expected: str) -> bool:
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "array":
        return isinstance(value, list)
    if expected == "object":
        return isinstance(value, dict)
    if expected == "null":
        return value is None
    return True


def validate_regulations() -> int:
    schema = json.loads(SCHEMA_PATH.read_text())
    yaml_paths = sorted(REGULATIONS_ROOT.glob("*/*.yaml"))
    if not yaml_paths:
        sys.stderr.write(f"No regulation YAMLs found under {REGULATIONS_ROOT}\n")
        return 1

    total_failures = 0
    for path in yaml_paths:
        try:
            data = yaml.safe_load(path.read_text())
        except Exception as exc:
            sys.stderr.write(f"{path}: YAML parse error: {exc!r}\n")
            total_failures += 1
            continue
        if not isinstance(data, dict):
            sys.stderr.write(f"{path}: top-level is not a dict\n")
            total_failures += 1
            continue
        failures = _validate_jsonschema(data, schema)
        if failures:
            sys.stderr.write(f"{path} ({len(failures)} issues):\n")
            for f in failures:
                sys.stderr.write(f"  - {f}\n")
            total_failures += 1

    if total_failures:
        sys.stderr.write(f"\n{total_failures} regulation(s) failed validation\n")
        return 1
    print(f"All {len(yaml_paths)} regulations pass schema validation.")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate regulation library.")
    parser.add_argument(
        "command",
        choices=["validate-regulations"],
        help="What to validate",
    )
    args = parser.parse_args()
    if args.command == "validate-regulations":
        return validate_regulations()
    return 1


if __name__ == "__main__":
    raise SystemExit(main())