#!/usr/bin/env python3
"""
citation_verifier.py - NLI-based claim verification with hard gate

Implements the CRAG (Corrective RAG) verification pattern:
1. Extract citation markers from generated report
2. Check each cited passage exists in retrieved chunks
3. NLI entailment check for each claim
4. Hard gate: BLOCK / WARN / PASS with attribution score
"""
import re
import logging
from dataclasses import dataclass
from functools import lru_cache
from typing import Optional

logger = logging.getLogger(__name__)


@dataclass
class ClaimResult:
    claim: str
    status: str  # "ENTAILED" | "CONTRADICTED" | "NEUTRAL" | "UNVERIFIED"
    evidence: Optional[str]
    citation_marker: Optional[str]


@dataclass
class VerificationResult:
    total_claims: int
    entailed: int
    contradicted: int
    neutral: int
    unverified: int
    attribution_score: float
    status: str  # "PASS" | "WARN" | "REJECTED"
    claims: list[ClaimResult]
    details: list[dict]
    # Honest disclosure of which verification engine actually ran:
    # "nli" (DeBERTa NLI model available) or "text_overlap" (degraded fallback).
    verification_mode: str = "text_overlap"


# Compiled patterns for citation matching
# Enforces word-boundary after article number to prevent "Article 999" matching inside "Article 22"
_CITATION_CONTENT_PATTERN = re.compile(
    r'\[([^\]]+?)\s+(Article|Art\.|§|Section|Annex|条|第\d+条)\s*([\dXIV]+)(?:\s*[,.;:/]?\s*[^\]]*)?\]',
    re.IGNORECASE,
)
_SOURCE_PATTERN = re.compile(r'\(source:\s*([^)]+)\)', re.IGNORECASE)
_CLAIM_BOUNDARY_CHARS = ".!?\n\r\u3002\uff01\uff1f"
_SENTENCE_END_CHARS = ".!?\u3002\uff01\uff1f"


def _is_decimal_period(text: str, pos: int) -> bool:
    return (
        text[pos] == "."
        and pos > 0
        and pos + 1 < len(text)
        and text[pos - 1].isdigit()
        and text[pos + 1].isdigit()
    )


def _split_claim_sentences(report: str) -> list[str]:
    sentences: list[str] = []
    start = 0
    for pos, ch in enumerate(report):
        if ch not in _SENTENCE_END_CHARS:
            continue
        if _is_decimal_period(report, pos):
            continue
        sentence = report[start:pos + 1].strip()
        if sentence:
            sentences.append(sentence)
        start = pos + 1

    tail = report[start:].strip()
    if tail:
        sentences.append(tail)
    return sentences


def _claim_text_for_span(report: str, start: int, end: int) -> str:
    """Return the sentence-like claim containing a citation span."""
    left = max(report.rfind(ch, 0, start) for ch in _CLAIM_BOUNDARY_CHARS)
    right = len(report)
    for pos in range(end, len(report)):
        ch = report[pos]
        if ch not in _CLAIM_BOUNDARY_CHARS:
            continue
        if _is_decimal_period(report, pos):
            continue
        right = pos + 1
        break
    claim = report[left + 1:right].strip()
    return claim or report[start:end].strip()


def _parse_citation_marker(marker: str) -> tuple[Optional[str], Optional[str]]:
    """
    Parse a citation marker like '[REACH Article 22]' into (doc_name, article_no).
    Returns (None, None) if the pattern doesn't match.
    """
    m = _CITATION_CONTENT_PATTERN.search(marker)
    if m:
        doc_name = m.group(1).strip()
        article_part = m.group(2).strip()
        article_no = f"{article_part} {m.group(3)}"
        return doc_name, article_no
    m = _SOURCE_PATTERN.search(marker)
    if m:
        return m.group(1).strip(), None
    return None, None


def _article_matches(article_no: str, text: str) -> bool:
    """Check if article_no appears as a whole word in text using word-boundary matching."""
    if not article_no:
        return True
    if not text:
        return False
    return bool(_article_pattern(article_no).search(text))


def _nli_label_to_status(label) -> str:
    """Normalize an NLI label string into one of ENTAILED/CONTRADICTED/NEUTRAL."""
    text = (str(label) if not isinstance(label, str) else label).upper()
    if text in ("ENTAIL", "ENTAILED", "1"):
        return "ENTAILED"
    if text in ("CONTRADICT", "CONTRADICTED", "2"):
        return "CONTRADICTED"
    return "NEUTRAL"


@lru_cache(maxsize=256)
def _article_pattern(article_no: str) -> re.Pattern:
    """Compile (and cache) the word-boundary regex for an article number.

    Compiled patterns are immutable and thread-safe, so caching is safe.
    """
    return re.compile(r'\b' + re.escape(article_no) + r'\b', re.IGNORECASE)


class CitationVerifier:
    """
    Verifies generated reports against retrieved chunks.

    Uses NLI model (DeBERTa-v3-large-mnli) when available,
    falls back to embedding similarity when not.
    """

    def __init__(self, nli_model=None, embedder=None):
        self.nli_model = nli_model
        self.embedder = embedder
        self._nli_available = nli_model is not None

    @property
    def verification_mode(self) -> str:
        """Honest disclosure of the verification engine currently in use.

        Returns "nli" when a real NLI model is available, otherwise
        "text_overlap" (the degraded word-overlap path). Downstream callers
        and users should treat text_overlap verdicts as weaker evidence than
        NLI entailment.
        """
        return "nli" if self._nli_available else "text_overlap"

    def extract_citations(self, report: str) -> list[tuple[str, Optional[str]]]:
        """
        Extract citation markers from report text.

        Returns list of (claim_text, citation_marker) tuples.
        Citation formats: [REACH Article 22], [GDPR § 5 p.3], (source: filename)
        """
        citations = []

        for match in _CITATION_CONTENT_PATTERN.finditer(report):
            cited_text = match.group(0)
            claim_text = _claim_text_for_span(report, match.start(), match.end())
            citations.append((claim_text, cited_text))

        for match in _SOURCE_PATTERN.finditer(report):
            cited_text = match.group(0)
            claim_text = _claim_text_for_span(report, match.start(), match.end())
            citations.append((claim_text, cited_text))

        return citations

    def extract_claims(self, report: str) -> list[str]:
        """Split report into individual claims (one per sentence)."""
        # Handles Chinese and English punctuation without splitting decimals.
        sentences = _split_claim_sentences(report)
        claims = [s.strip() for s in sentences if len(s.strip()) > 10]
        return claims

    def verify_claim_nli(self, claim: str, chunks: list[dict]) -> ClaimResult:
        """
        Verify a single claim against chunks using NLI.

        For each chunk, check: does chunk ENTAIL claim?
        If any chunk entails -> ENTAILED
        If any chunk contradicts -> CONTRADICTED
        If no evidence -> NEUTRAL
        """
        if not self.nli_model:
            return self._verify_by_embedding(claim, chunks)

        if not chunks:
            return ClaimResult(
                claim=claim,
                status="NEUTRAL",
                evidence=None,
                citation_marker=None,
            )

        # Build all (chunk, claim) premise/hypothesis pairs once and try to
        # run them through the NLI model in a single batched predict() call.
        # Most HuggingFace NLI pipelines (and our unit-test mocks) accept a
        # list input and return one label per premise. Older per-call APIs
        # will raise on a list, in which case we fall back to per-chunk calls
        # limited to a top-K of candidates to keep the cost bounded.
        contents = [chunk.get("content", "")[:2000] for chunk in chunks]
        pairs = [[f"{content}\n\nClaim: {claim}"] for content in contents]

        try:
            results = self.nli_model.predict(pairs, multi_label=False)
            return self._best_nli_result(claim, contents, results)
        except Exception as e:
            logger.debug(f"NLI batched predict failed, falling back to per-chunk: {e}")

        # Fallback: rank candidates by cheap text overlap, run NLI on top-K.
        top_contents = self._top_candidates_by_overlap(claim, contents, k=3)
        for content in top_contents:
            try:
                result = self.nli_model.predict(
                    [f"{content}\n\nClaim: {claim}"],
                    multi_label=False,
                )
                label = result[0].label if hasattr(result[0], "label") else str(result[0])
                status = _nli_label_to_status(label)
                if status in ("ENTAILED", "CONTRADICTED"):
                    return ClaimResult(
                        claim=claim,
                        status=status,
                        evidence=content[:500],
                        citation_marker=None,
                    )
            except Exception as inner:
                logger.debug(f"NLI per-chunk check failed: {inner}")
                continue

        return ClaimResult(
            claim=claim,
            status="NEUTRAL",
            evidence=None,
            citation_marker=None,
        )

    @staticmethod
    def _best_nli_result(
        claim: str,
        contents: list[str],
        results,
    ) -> ClaimResult:
        """Pick the strongest NLI verdict across batched chunk results.

        CONTRADICTED wins over ENTAILED (worst-case reporting), ENTAILED over
        NEUTRAL, mirroring the original loop's short-circuit priority.
        """
        best = ClaimResult(
            claim=claim,
            status="NEUTRAL",
            evidence=None,
            citation_marker=None,
        )
        for content, result in zip(contents, results):
            label = result.label if hasattr(result, "label") else str(result)
            status = _nli_label_to_status(label)
            if status == "CONTRADICTED":
                return ClaimResult(
                    claim=claim,
                    status="CONTRADICTED",
                    evidence=content[:500],
                    citation_marker=None,
                )
            if status == "ENTAILED" and best.status != "CONTRADICTED":
                best = ClaimResult(
                    claim=claim,
                    status="ENTAILED",
                    evidence=content[:500],
                    citation_marker=None,
                )
        return best

    @staticmethod
    def _top_candidates_by_overlap(claim: str, contents: list[str], k: int = 3) -> list[str]:
        """Return the top-k contents ranked by cheap word overlap with claim."""
        claim_words = set(re.findall(r"\w+", claim.lower()))
        if not claim_words:
            return contents[:k]
        scored = []
        for content in contents:
            content_words = set(re.findall(r"\w+", content.lower()))
            overlap = len(claim_words & content_words) / max(len(claim_words), 1)
            scored.append((overlap, content))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [content for _, content in scored[:k]]

    def _verify_by_embedding(self, claim: str, chunks: list[dict]) -> ClaimResult:
        """
        Fallback verification using simple text overlap when no NLI model.

        Pre-tokenizes chunk words once per call batch to avoid O(n*m*len) regex overhead.
        """
        claim_words = set(re.findall(r'\w+', claim.lower()))
        if not claim_words:
            return ClaimResult(
                claim=claim, status="UNVERIFIED", evidence=None, citation_marker=None,
            )

        for chunk in chunks:
            content_lower = chunk.get("content", "").lower()
            # Split once; avoid re.findall inside the loop
            content_words = set(re.findall(r'\w+', content_lower))
            overlap = len(claim_words & content_words) / max(len(claim_words), 1)

            if overlap > 0.5:
                return ClaimResult(
                    claim=claim,
                    status="ENTAILED",
                    evidence=chunk.get("content", "")[:300],
                    citation_marker=None,
                )

        return ClaimResult(
            claim=claim,
            status="UNVERIFIED",
            evidence=None,
            citation_marker=None,
        )

    def verify_citations(self, report: str, chunks: list[dict]) -> VerificationResult:
        """
        Main verification: check all claims in report against chunks.

        Args:
            report: generated report text
            chunks: retrieved source chunks

        Returns:
            VerificationResult with status and attribution score
        """
        # Fast path: no chunks → skip expensive verification
        if not chunks:
            return VerificationResult(
                total_claims=0,
                entailed=0,
                contradicted=0,
                neutral=0,
                unverified=0,
                attribution_score=0.0,
                status="REJECTED",
                claims=[],
                details=[{"error": "No source chunks provided"}],
                verification_mode=self.verification_mode,
            )

        citations = self.extract_citations(report)
        claims = self.extract_claims(report)

        citation_results = []

        # Verify cited passages using parsed doc_name + article_no with word-boundary matching
        for claim_text, marker in citations:
            result = ClaimResult(
                claim=claim_text,
                status="NEUTRAL",
                evidence=None,
                citation_marker=marker,
            )
            doc_name, article_no = _parse_citation_marker(marker)
            for chunk in chunks:
                chunk_doc = chunk.get("doc_name", "")
                chunk_content = chunk.get("content", "")
                chunk_article = chunk.get("article_no", "")

                doc_match = doc_name and doc_name.lower() in chunk_doc.lower()
                article_match = _article_matches(article_no, chunk_article) or \
                                _article_matches(article_no, chunk_content)

                if doc_match and article_match:
                    result.status = "ENTAILED"
                    result.evidence = chunk_content[:300]
                    break
                # Literal marker fallback
                if marker in chunk_content or marker in chunk_doc:
                    result.status = "ENTAILED"
                    result.evidence = chunk_content[:300]
                    break
            citation_results.append(result)

        # Count each claim once in claim-level metrics. Citation coverage is
        # still computed from every marker, so failed duplicate citations are
        # not hidden.
        status_priority = {
            "CONTRADICTED": 4,
            "ENTAILED": 3,
            "UNVERIFIED": 2,
            "NEUTRAL": 1,
        }
        best_by_claim: dict[str, ClaimResult] = {}
        for result in citation_results:
            existing = best_by_claim.get(result.claim)
            if existing is None or status_priority.get(result.status, 0) > status_priority.get(existing.status, 0):
                best_by_claim[result.claim] = result

        all_results = list(best_by_claim.values())

        # Verify remaining claims via NLI / embedding fallback
        # Use a set for O(1) claim dedup instead of O(n^2) list scan
        seen_claims: set[str] = set(best_by_claim)
        for claim in claims:
            if claim not in seen_claims:
                result = self.verify_claim_nli(claim, chunks)
                all_results.append(result)
                seen_claims.add(claim)

        # Compute metrics
        entailed = sum(1 for r in all_results if r.status == "ENTAILED")
        contradicted = sum(1 for r in all_results if r.status == "CONTRADICTED")
        neutral = sum(1 for r in all_results if r.status == "NEUTRAL")
        unverified = sum(1 for r in all_results if r.status == "UNVERIFIED")
        total = len(all_results) or 1

        # Attribution score: (entailed / total) * citation_coverage
        # P0-2: A report with zero citations has ZERO coverage. The previous
        # behavior (citation_coverage=1.0 when no markers were extracted)
        # rewarded LLM hallucinations that omit source markers: any claim that
        # happened to overlap a chunk by >50% would sail past the 0.9 PASS
        # gate without ever being tied to a specific source. "No citations"
        # means "no verifiable attribution", not "perfect attribution".
        citation_count = len(citation_results)
        if citation_count > 0:
            cited_entailed = sum(
                1 for r in citation_results if r.citation_marker and r.status == "ENTAILED"
            )
            citation_coverage = cited_entailed / citation_count
        else:
            citation_coverage = 0.0

        attribution_score = (entailed / total) * citation_coverage

        # Hard gate
        if contradicted > 0:
            status = "REJECTED"
        elif attribution_score >= 0.9:
            status = "PASS"
        elif attribution_score >= 0.7:
            status = "WARN"
        else:
            status = "REJECTED"

        return VerificationResult(
            total_claims=len(all_results),
            entailed=entailed,
            contradicted=contradicted,
            neutral=neutral,
            unverified=unverified,
            attribution_score=round(attribution_score, 3),
            status=status,
            claims=all_results,
            details=[
                {"claim": r.claim, "status": r.status, "evidence": r.evidence}
                for r in all_results
            ],
            verification_mode=self.verification_mode,
        )


def create_verifier(nli_model=None) -> CitationVerifier:
    """Factory function to create CitationVerifier with available models."""
    return CitationVerifier(nli_model=nli_model)
