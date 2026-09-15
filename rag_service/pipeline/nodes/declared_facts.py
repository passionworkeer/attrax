"""Shared helpers for user-declared product facts (J09, plan 2026-09-14 §4.2).

Both ``findings_builder.py`` and ``generator.py`` need to recognize the same
"absent-like" answer spellings — declaring a product fact absent (e.g. the
user said the product does not have a battery) closes conditionally-
applicable checks in the builder AND suppresses feature detection in the
generator. The two used to carry their own copies of this set (P1-1, 2026-
09-15 adversarial round 4), so a change in one place could silently drift
the other.

The shared helpers live here so that any future fact-key addition has
exactly one source of truth.
"""
from __future__ import annotations


# Answer spellings that count as "the user said this is ABSENT".
# Lower-case canonical form (callers must .strip().lower() before testing).
NEGATIVE_VALUES: frozenset[str] = frozenset(
    {
        "absent",
        "none",
        "no",
        "false",
        "无",
        "否",
        "0",
        "不含",
        "无内置电池",
    }
)


def is_negative_value(value: object) -> bool:
    """True iff ``value`` spells out an "absent" answer.

    Whitespace is stripped and the comparison is case-insensitive; a value
    that is not a string is treated as non-negative (caller may pass dict
    entries of mixed type).
    """
    if not isinstance(value, str):
        return False
    return value.strip().lower() in NEGATIVE_VALUES