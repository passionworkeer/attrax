"""Stable check-based comparison; removal is not a compliance clearance."""
from __future__ import annotations


def compare_revisions(previous: dict, current: dict) -> dict | None:
    if not previous or int(current.get("revision") or 1) <= 1:
        return None

    def index(result):
        package = result.get("reportPackage") or {}
        grouped = {}
        for finding in package.get("findings") or []:
            key = finding.get("checkId")
            if key:
                grouped.setdefault(key, []).append(tuple(str(finding.get(field) or "") for field in
                    ("assessment", "applicability", "severity", "suggestedAction")))
        return {key: sorted(values) for key, values in grouped.items()}

    old, new = index(previous), index(current)
    comparison = {
        "previousRevision": int(previous.get("revision") or 1),
        "added": sorted(new.keys() - old.keys()),
        "removed": sorted(old.keys() - new.keys()),
        "changed": sorted(key for key in new.keys() & old.keys() if new[key] != old[key]),
        "remaining": len(new),
    }
    def claims(result):
        return {(c.get("market"), c.get("checkId")): c for c in
                (result.get("reportPackage") or {}).get("reviewClaims", [])
                if isinstance(c, dict) and c.get("market") and c.get("checkId")}
    old_claims, new_claims = claims(previous), claims(current)
    if old_claims or new_claims:
        changes = []
        for market, check in sorted(old_claims.keys() | new_claims.keys()):
            before, after = old_claims.get((market, check), {}), new_claims.get((market, check), {})
            fields = ("status", "reason", "applicabilityReason", "citationIds", "documentEvidence", "verificationIssues")
            if any(before.get(field) != after.get(field) for field in fields):
                changes.append({"market": market, "checkId": check,
                    "before": before.get("status", "unknown"), "after": after.get("status", "unknown"),
                    "beforeReason": before.get("reason", ""), "afterReason": after.get("reason", ""),
                    "evidenceChanged": any(before.get(field) != after.get(field) for field in ("citationIds", "documentEvidence"))})
        comparison["marketChanges"] = changes
    return comparison
