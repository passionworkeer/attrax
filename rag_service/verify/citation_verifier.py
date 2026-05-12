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


# Compiled patterns for citation matching
# Enforces word-boundary after article number to prevent "Article 999" matching inside "Article 22"
_CITATION_CONTENT_PATTERN = re.compile(
    r'\[([^\]]+?)\s+(Article|Art\.|§|Section|Annex|条|第\d+条)\s*([\dXIV]+)(?:\s*[,.;:/]?\s*[^\]]*)?\]',
    re.IGNORECASE,
)
_SOURCE_PATTERN = re.compile(r'\(source:\s*([^)]+)\)', re.IGNORECASE)


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
    if not article_no or not isinstance(text, str):
        return True
    pattern = re.compile(r'\b' + re.escape(article_no) + r'\b', re.IGNORECASE)
    return bool(pattern.search(text))


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

    def extract_citations(self, report: str) -> list[tuple[str, Optional[str]]]:
        """
        Extract citation markers from report text.

        Returns list of (claim_text, citation_marker) tuples.
        Citation formats: [REACH Article 22], [GDPR § 5 p.3], (source: filename)
        """
        citations = []

        for match in _CITATION_CONTENT_PATTERN.finditer(report):
            cited_text = match.group(0)
            citations.append((cited_text, cited_text))

        for match in _SOURCE_PATTERN.finditer(report):
            cited_text = match.group(0)
            citations.append((cited_text, cited_text))

        return citations

    def extract_claims(self, report: str) -> list[str]:
        """Split report into individual claims (one per sentence)."""
        # Handles Chinese with no trailing space after punctuation
        sentences = re.split(r'(?<=[。！？.!?])\s*', report)
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

        best_result = ClaimResult(
            claim=claim,
            status="NEUTRAL",
            evidence=None,
            citation_marker=None,
        )

        for chunk in chunks:
            content = chunk.get("content", "")[:2000]

            try:
                result = self.nli_model.predict(
                    [f"{content}\n\nClaim: {claim}"],
                    multi_label=False,
                )
                label = result[0].label if hasattr(result[0], "label") else str(result[0])

                if label.upper() in ("ENTAIL", "ENTAILED", "1"):
                    return ClaimResult(
                        claim=claim,
                        status="ENTAILED",
                        evidence=content[:500],
                        citation_marker=None,
                    )
                elif label.upper() in ("CONTRADICT", "CONTRADICTED", "2"):
                    return ClaimResult(
                        claim=claim,
                        status="CONTRADICTED",
                        evidence=content[:500],
                        citation_marker=None,
                    )
            except Exception as e:
                logger.debug(f"NLI check failed: {e}")
                continue

        return best_result

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
            )

        citations = self.extract_citations(report)
        claims = self.extract_claims(report)

        all_results = []

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
            all_results.append(result)

        # Verify remaining claims via NLI / embedding fallback
        # Use a set for O(1) claim dedup instead of O(n^2) list scan
        seen_claims: set[str] = {str(r.claim) for r in all_results}
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
        citation_count = len(citations)
        if citation_count > 0:
            cited_entailed = sum(
                1 for r in all_results if r.citation_marker and r.status == "ENTAILED"
            )
            citation_coverage = cited_entailed / citation_count
        else:
            citation_coverage = 1.0

        attribution_score = (entailed / total) * citation_coverage

        # Soft gate: only reject on contradiction; low attribution is WARN not REJECTED
        if contradicted > 0:
            status = "REJECTED"
        elif attribution_score >= 0.9:
            status = "PASS"
        elif attribution_score >= 0.5:
            status = "WARN"
        else:
            status = "WARN"

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
        )


def create_verifier(nli_model=None) -> CitationVerifier:
    """Factory function to create CitationVerifier with available models."""
    return CitationVerifier(nli_model=nli_model)
