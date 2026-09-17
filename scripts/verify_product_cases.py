"""Live acceptance run against the local upload API using public sample files.

Runs the actual configured models. Never saves session credentials.
"""
from contextlib import ExitStack
from pathlib import Path
import json
import mimetypes
import time
import requests

ROOT = Path(__file__).resolve().parents[1]
CASES = [
    ("xiaomi-kettle", "appliance", "EU", ["declaration.pdf"]),
    ("anker-a2332", "electronics", "EU", []),
    ("lego-76429", "toy", "US", ["product-certificate.pdf", "official-instructions-battery-pages.pdf"]),
]


def run_case(case):
    name, category, market, documents = case
    folder = ROOT / "public/product-samples" / name
    session = requests.Session()
    session.trust_env = False
    with ExitStack() as stack:
        paths = [("images", folder / f"0{i}.jpg") for i in range(1, 4)]
        paths.append(("documents", folder / "spec.txt"))
        for document in documents:
            paths.append(("documents", folder / document))
        files = [(field, (f"{name}-{p.name}", stack.enter_context(p.open("rb")), mimetypes.guess_type(p.name)[0])) for field, p in paths]
        response = session.post("http://127.0.0.1:3000/api/scan", files=files,
            data={"category": category, "markets": market, "locale": "zh"}, timeout=90)
    response.raise_for_status()
    payload = response.json()
    created = payload.get("data", payload)
    print(name, "submitted", created["sessionId"], flush=True)
    deadline = time.monotonic() + 360
    while time.monotonic() < deadline:
        response = session.get("http://127.0.0.1:3000" + created["pollUrl"], timeout=30)
        response.raise_for_status()
        payload = response.json()
        status = payload.get("data", payload)
        if status.get("status") in {"ready", "degraded", "failed"}:
            # Backend persists the complete report. Keep only acceptance metrics.
            stored = json.loads((ROOT / "data/backend/sessions" / (created["sessionId"] + ".json")).read_text(encoding="utf-8"))
            result = stored.get("result") or {}
            package = result.get("reportPackage") or {}
            claims = package.get("reviewClaims") or []
            citations = package.get("citations") or []
            return {"case": name, "sessionId": created["sessionId"], "status": status["status"],
                "product": result.get("productName"), "source": result.get("source"),
                "documents": [{"name": d.get("name"), "characters": d.get("includedCharacters")} for d in (package.get("productEvidence") or {}).get("documents", [])],
                "claims": len(claims), "claimsWithDocuments": sum(bool(c.get("documentEvidence")) for c in claims),
                "linkedLegalClaims": sum(bool(c.get("citationIds")) for c in claims),
                "verifiedCitations": sum(c.get("match_status") == "matched" for c in citations), "citations": len(citations)}
        time.sleep(3)
    raise TimeoutError(name)


if __name__ == "__main__":
    output = ROOT / ".local-dev/product-case-acceptance.json"
    results = []
    for case in CASES:
        result = run_case(case)
        results.append(result)
        output.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(json.dumps(result, ensure_ascii=False), flush=True)
