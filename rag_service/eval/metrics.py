#!/usr/bin/env python3
"""
metrics.py - RAGAS-style offline evaluation metrics for rag-service.

No LLM dependency: uses substring/N-gram matching instead.
"""
import json
import os
import re
import uuid
from pathlib import Path
from typing import Any

# ── Corpus reading ────────────────────────────────────────────────────────────

def _read_corpus_chunks(corpus_dir: str) -> list[dict]:
    """Load processed chunks from data/corpus/processed/*.json."""
    path = Path(corpus_dir)
    if not path.exists():
        return []
    chunks = []
    for fp in path.glob("*.json"):
        try:
            with open(fp, encoding="utf-8") as f:
                data = json.load(f)
            items = data if isinstance(data, list) else data.get("chunks", [])
            for item in items:
                item["_src"] = fp.name
                chunks.append(item)
        except Exception:
            pass
    return chunks


def _chunk_to_keywords(chunk: dict) -> list[str]:
    """Extract key terms from a chunk for question generation."""
    content = chunk.get("content", "")
    doc = chunk.get("doc_name", "")
    region = chunk.get("region", "")
    # Strip prepend markers and short tokens
    text = re.sub(r"\[.*?\]", " ", content)
    text = re.sub(r"[^\w一-鿿\s]", " ", text)
    tokens = [t.strip().lower() for t in re.split(r"\s+", text) if len(t.strip()) >= 2]
    # Deduplicate while preserving order
    seen, unique = set(), []
    for t in tokens:
        if t not in seen:
            seen.add(t); unique.append(t)
    return unique[:60]


# ── Test-set generation ────────────────────────────────────────────────────────

REGULATION_TEMPLATES: list[dict] = [
    # ── REACH ──
    {
        "reg": "REACH", "market": "EU",
        "question": "出口欧盟的电子产品中，REACH法规对铅、镉、汞等重金属有哪些限制？",
        "ground_truth_answer": "根据REACH法规(EC) No 1907/2006第67条及附件XVII，含铅、镉、汞、六价铬不得超过0.1%(重量比)，镉及其化合物不得超过0.01%。儿童产品另有更严格限制。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "REACH", "market": "EU",
        "question": "REACH附录XVII第63条对邻苯二甲酸盐有什么限制要求？",
        "ground_truth_answer": "REACH附件XVII第63条规定，DEHP、DBP、BBP、DIHP各不得超过玩具及儿童护理用品中0.1%(以塑化剂计)的含量。",
        "category": "toys", "critical": True,
    },
    {
        "reg": "REACH", "market": "EU",
        "question": "化妆品出口欧盟需要符合REACH的哪些规定？",
        "ground_truth_answer": "REACH主要管控化学品注册、评估、授权和限制。化妆品需关注禁用物质列表(附件II)及限用物质(附件III)，重金属残留如铅限10mg/kg、镉限3mg/kg。",
        "category": "cosmetics", "critical": False,
    },
    {
        "reg": "REACH", "market": "EU",
        "question": "REACH SVHC候选清单是什么，出口商需要注意什么？",
        "ground_truth_answer": "SVHC(高关注物质)候选清单载明需高度关注的物质。当含量超过0.1%且年供应量超过1吨时，供应商有传递安全数据表(SDS)的义务。消费者可申请信息权。",
        "category": "general", "critical": True,
    },
    # ── RoHS ──
    {
        "reg": "RoHS", "market": "EU",
        "question": "充电宝出口欧盟需要符合RoHS指令吗？主要限制哪些物质？",
        "ground_truth_answer": "是的，RoHS指令2011/65/EU限制电子电气设备中铅(Pb)、汞(Hg)、镉(Cd)、六价铬(Cr6+)、多溴联苯(PBB)、多溴二苯醚(PBDE)，限值均为0.1%(除镉为0.01%)。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "RoHS", "market": "EU",
        "question": "RoHS指令与REACH法规的主要区别是什么？",
        "ground_truth_answer": "RoHS针对电子电气设备的特定有害物质限制，属强制性合规；REACH管控所有化学品注册、评估和授权，范围更广。两者可同时适用，RoHS违规通常被海关扣货。",
        "category": "electronics", "critical": False,
    },
    {
        "reg": "RoHS", "market": "EU",
        "question": "RoHS 3(指令2015/863)新增了哪四种邻苯二甲酸酯限制？",
        "ground_truth_answer": "RoHS 3新增邻苯二甲酸二(2-乙基己基)酯(DEHP)、邻苯二甲酸丁苄酯(BBP)、邻苯二甲酸二丁酯(DBP)、邻苯二甲酸二异丁酯(DIBP)四种塑化剂，限值均为0.1%。",
        "category": "electronics", "critical": True,
    },
    # ── GPSR ──
    {
        "reg": "GPSR", "market": "EU",
        "question": "欧盟通用产品安全法规(GPSR)对在线销售商品有哪些基本要求？",
        "ground_truth_answer": "GPSR(法规2023/988)要求：产品须安全、提供欧代信息、加贴CE标志(适用时)、具备溯源码。线上 marketplace须验证商品合规性，否则与卖家承担连带责任。",
        "category": "general", "critical": True,
    },
    {
        "reg": "GPSR", "market": "EU",
        "question": "出口欧盟的电子产品需要满足GPSR哪些电气安全要求？",
        "ground_truth_answer": "GPSR要求产品具备：完整技术文档、符合性声明(DoC)、CE标志、产品溯源标签(含制造商/欧代/型号/批次信息)。低于50V AC或75V DC的低电压设备还需满足LVD指令。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "GPSR", "market": "EU",
        "question": "GPSR对儿童产品的警示标签有什么要求？",
        "ground_truth_answer": "GPSR要求儿童产品标注年龄安全警示、使用说明及监护人信息。产品须附风险评估报告，在包装标注欧代信息及追溯码。不合规产品将被RAPEX系统通报。",
        "category": "toys", "critical": True,
    },
    # ── EMC ──
    {
        "reg": "EMC", "market": "EU",
        "question": "蓝牙耳机出口欧盟需要进行EMC测试吗？主要测试哪些项目？",
        "ground_truth_answer": "是的，需符合EMC指令2014/30/EU。主要测试项目：电磁骚扰(EMI)——传导和辐射发射；电磁抗扰度(EMS)——静电放电、射频辐射、快速脉冲等。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "EMC", "market": "EU",
        "question": "EMC指令和低电压指令(LVD)有什么关联，出口商需要同时满足吗？",
        "ground_truth_answer": "两者均为CE标志的基础指令。LVD管控50V AC以上电气设备的安全；EMC管控电磁兼容性。当设备电压在LVD范围(50-1000V AC)内时，须同时满足LVD和EMC。",
        "category": "electronics", "critical": False,
    },
    {
        "reg": "EMC", "market": "EU",
        "question": "扫地机器人出口欧盟的EMC测试标准是什么？",
        "ground_truth_answer": "适用EN 55014-1(骚扰)和EN 55014-2(抗扰度)标准。扫地机器人含电机和电子控制电路，需通过辐射发射、抗扰度及谐波电流测试，附技术文件后加贴CE标志。",
        "category": "electronics", "critical": True,
    },
    # ── LVD ──
    {
        "reg": "LVD", "market": "EU",
        "question": "出口欧盟的充电器需要符合低电压指令(LVD)吗？主要测试项目有哪些？",
        "ground_truth_answer": "输入电压在50-1000V AC或75-1500V DC范围内的充电器必须符合LVD指令2014/35/EU。主要测试：绝缘电阻、耐压、接地连续性、泄漏电流、温升、机械强度、异常测试等。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "LVD", "market": "EU",
        "question": "低于50V的电子设备出口欧盟是否需要满足LVD指令？",
        "ground_truth_answer": "50V AC以下设备不在LVD指令强制范围内，但须符合通用安全要求(GPSR)。然而其使用的元器件仍需符合相关安全标准，且可能触发EMC指令的适用。",
        "category": "electronics", "critical": False,
    },
    # ── 跨法规场景 ──
    {
        "reg": "REACH+GPSR", "market": "EU",
        "question": "儿童玩具出口欧盟需要同时满足REACH和GPSR的要求，应该如何准备合规文件？",
        "ground_truth_answer": "需同时满足REACH(化学品安全)和GPSR(产品安全)。REACH要求：提供SVHC信息、符合性声明、SDS；GPSR要求：风险评估、CE标志、欧代、溯源标签、产品信息卡。",
        "category": "toys", "critical": True,
    },
    {
        "reg": "GPSR+EMC", "market": "EU",
        "question": "智能手表出口欧盟要满足GPSR和EMC两项法规，认证流程是什么？",
        "ground_truth_answer": "GPSR要求通用安全评估、欧代、CE标志；EMC指令2014/30/EU要求EN 55014测试。认证流程：确定适用指令→产品测试→编制技术文件→签署DoC→加贴CE标志→指定欧代。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "RoHS+EMC", "market": "EU",
        "question": "出口欧盟的无线音箱需要同时符合RoHS和EMC指令，常见违规点有哪些？",
        "ground_truth_answer": "RoHS违规：电池含镉、PCB焊料超标；EMC违规：辐射发射超标、射频干扰未抑制。蓝牙/WiFi设备还须符合RED指令(无线电设备2014/53/EU)，常见问题：频段功率超限。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "REACH+RoHS", "market": "EU",
        "question": "电子电气产品同时受REACH和RoHS管控，两者对有害物质的限制有何重叠和差异？",
        "ground_truth_answer": "两者对铅、镉、汞、六价铬均有重叠限制(REACH限0.1%，RoHS对镉限0.01%更严格)。REACH管控范围更广(含所有化学品)；RoHS针对电子电气设备强制性更强，违规直接导致海关扣货。",
        "category": "electronics", "critical": True,
    },
    # ── US 法规 ──
    {
        "reg": "CPSC", "market": "US",
        "question": "儿童玩具出口美国需要符合CPSC的哪些强制检测标准？",
        "ground_truth_answer": "CPSC要求：ASTM F963(玩具安全标准，含机械物理性能/易燃性/重金属)、CPSIA铅含量限100ppm、邻苯二甲酸酯限0.1%。须由CPSC认可实验室检测并出具检测报告。",
        "category": "toys", "critical": True,
    },
    {
        "reg": "FCC", "market": "US",
        "question": "蓝牙耳机出口美国需要通过FCC认证吗？认证类型如何选择？",
        "ground_truth_answer": "带无线发射功能的产品须通过FCC认证。蓝牙耳机属意图发射器，须进行FCC ID认证(SDoC或Certification)。适用标准：FCC Part 15B(EMI)和Part 15C(射频发射)。",
        "category": "electronics", "critical": True,
    },
    # ── CN 法规 ──
    {
        "reg": "China RoHS", "market": "CN",
        "question": "中国RoHS(电器电子产品有害物质限制使用管理办法)对电子信息产品有哪些限制？",
        "ground_truth_answer": "中国RoHS限制铅、汞、镉、六价铬、多溴联苯、多溴二苯醚六种有害物质。纳入达标管理目录的产品须加贴绿色标识并标注有害物质含量。不在目录内的产品自愿符合。",
        "category": "electronics", "critical": True,
    },
    {
        "reg": "CCC", "market": "CN",
        "question": "哪些电子产品出口中国需要申请CCC认证？申请流程是什么？",
        "ground_truth_answer": "CCC认证适用于列入《强制性产品认证目录》的产品，包括电线电缆、电路开关、家用设备、音视频设备、信息技术设备等。流程：申请→型式试验→工厂检查→认证评定→颁发证书。",
        "category": "electronics", "critical": True,
    },
]


def generate_test_set(output_path: str | None = None, corpus_dir: str | None = None) -> list[dict]:
    """
    Generate test_set.json.

    If corpus_dir is given and files exist, enriches synthetic templates with
    real chunk keywords. Otherwise uses the built-in regulation templates.
    """
    base = REGULATION_TEMPLATES

    # Enrich from real corpus if available
    if corpus_dir:
        chunks = _read_corpus_chunks(corpus_dir)
        if chunks:
            # Inject a few chunk-derived cases
            for chunk in chunks[:20]:
                keywords = _chunk_to_keywords(chunk)
                if len(keywords) < 3:
                    continue
                doc = chunk.get("doc_name", "")
                region = chunk.get("region", "EU")
                market_map = {"EU": "EU", "US": "US", "CN": "CN"}
                market = market_map.get(region, "EU")
                # Build a generic question from keywords
                kw_sample = "、".join(keywords[:5])
                base.append({
                    "reg": doc,
                    "market": market,
                    "question": f"{doc}中关于「{kw_sample}」的规定是什么？",
                    "ground_truth_answer": chunk.get("content", "")[:500],
                    "category": chunk.get("chunk_type", "general"),
                    "critical": False,
                    "_src_chunk_id": chunk.get("id", ""),
                })

    # Finalize: add id, source_document, strip internal keys
    result = []
    for i, tpl in enumerate(base, 1):
        result.append({
            "id": f"test_{i:03d}",
            "question": tpl["question"],
            "ground_truth_answer": tpl["ground_truth_answer"],
            "source_document": f"{tpl['reg']}.json",
            "market": tpl["market"],
            "category": tpl["category"],
            "critical": tpl.get("critical", False),
        })

    if output_path:
        Path(output_path).parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)

    return result


# ── Core metrics ──────────────────────────────────────────────────────────────

def _tokenize(text: str) -> list[str]:
    """Simple tokenizer: Chinese chars + ASCII alphanumeric tokens."""
    # Split into tokens (CJK chars become individual tokens)
    tokens = re.findall(r"[一-鿿]+|[a-zA-Z0-9]+", text.lower())
    # Further split CJK sequences
    result = []
    for t in tokens:
        if re.search(r"[一-鿿]", t):
            result.extend(list(t))
        else:
            result.append(t)
    return result


def _extract_claims(text: str) -> list[str]:
    """
    Split answer into atomic claims using sentence delimiters.
    A claim is a clause that makes a single factual assertion.
    """
    # Split by Chinese/English sentence endings
    sentences = re.split(r"[。！？.;!?\n]+", text)
    claims = []
    for s in sentences:
        s = s.strip()
        if len(s) >= 8:  # Minimum meaningful claim length
            claims.append(s)
    return claims


def faithfulness(answer: str, retrieved_docs: list[dict]) -> dict[str, Any]:
    """
    % of answer claims that appear (as a substring) in any retrieved doc.

    Returns:
        score: float in [0.0, 1.0]
        details: summary string
    """
    if not answer or not retrieved_docs:
        return {"score": 0.0, "details": "no answer or docs"}

    claims = _extract_claims(answer)
    if not claims:
        return {"score": 1.0, "details": "no claimable sentences found"}

    # Build combined doc text for fast matching
    doc_texts = [doc.get("content", "") for doc in retrieved_docs]
    combined = "\n".join(doc_texts).lower()

    supported = sum(1 for c in claims if c.lower() in combined)
    score = round(supported / len(claims), 3)
    details = f"{supported}/{len(claims)} claims supported"
    return {"score": score, "details": details}


def answer_relevancy(question: str, answer: str) -> dict[str, Any]:
    """
    Token overlap between question and answer keywords.
    Higher overlap → more relevant answer.

    Returns:
        score: float in [0.0, 1.0]
        details: summary string
    """
    if not question or not answer:
        return {"score": 0.0, "details": "empty input"}

    q_tokens = set(_tokenize(question))
    a_tokens = set(_tokenize(answer))

    # Remove stopwords (minimal set for Chinese/English)
    stops = {"的", "了", "在", "是", "我", "有", "和", "就", "不", "人", "都",
             "一", "一个", "上", "也", "很", "到", "说", "要", "去", "你",
             "the", "a", "an", "is", "are", "was", "were", "of", "and",
             "to", "in", "for", "on", "with", "as", "at", "by", "or", "it"}
    q_tokens -= stops
    a_tokens -= stops

    if not q_tokens:
        return {"score": 1.0, "details": "no query tokens"}

    overlap = len(q_tokens & a_tokens) / len(q_tokens)
    score = round(overlap, 3)
    details = f"token overlap: {len(q_tokens & a_tokens)}/{len(q_tokens)}"
    return {"score": score, "details": details}


def context_precision(
    question: str,
    retrieved_docs: list[dict],
    ground_truth_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """
    Fraction of retrieved docs that are actually relevant to the question.

    A doc is "relevant" if it shares significant keyword overlap with the question.
    Optionally, ground_truth_keywords from the corpus can be passed for tighter check.

    Returns:
        score: float in [0.0, 1.0]
        details: summary string
    """
    if not retrieved_docs:
        return {"score": 0.0, "details": "no docs retrieved"}

    gt_kw = set(w.lower() for w in (ground_truth_keywords or []))
    q_tokens = set(_tokenize(question))

    relevant_count = 0
    for doc in retrieved_docs:
        doc_content = doc.get("content", "")
        doc_tokens = set(_tokenize(doc_content))
        # Check keyword overlap with question
        overlap = len(q_tokens & doc_tokens)
        threshold = max(1, len(q_tokens) // 4)
        is_relevant = overlap >= threshold
        # If ground truth keywords provided, also check those
        if gt_kw and not is_relevant:
            is_relevant = len(gt_kw & doc_tokens) >= 1
        if is_relevant:
            relevant_count += 1

    score = round(relevant_count / len(retrieved_docs), 3)
    details = f"{relevant_count}/{len(retrieved_docs)} docs relevant"
    return {"score": score, "details": details}


def context_recall(
    ground_truth_answer: str,
    retrieved_docs: list[dict],
) -> dict[str, Any]:
    """
    Fraction of ground truth answer content covered by retrieved docs.

    Splits ground truth into key assertions and checks each against doc pool.

    Returns:
        score: float in [0.0, 1.0]
        details: summary string
    """
    if not ground_truth_answer or not retrieved_docs:
        return {"score": 0.0, "details": "no ground truth or docs"}

    gt_claims = _extract_claims(ground_truth_answer)
    if not gt_claims:
        return {"score": 1.0, "details": "no extractable gt claims"}

    combined = "\n".join(doc.get("content", "") for doc in retrieved_docs).lower()

    covered = sum(1 for c in gt_claims if c.lower() in combined)
    score = round(covered / len(gt_claims), 3)
    details = f"{covered}/{len(gt_claims)} gt claims recalled"
    return {"score": score, "details": details}


def compute_all_metrics(
    question: str,
    answer: str,
    retrieved_docs: list[dict],
    ground_truth_answer: str,
    ground_truth_keywords: list[str] | None = None,
) -> dict[str, Any]:
    """Compute all four metrics in one call."""
    return {
        "faithfulness": faithfulness(answer, retrieved_docs),
        "answer_relevancy": answer_relevancy(question, answer),
        "context_precision": context_precision(question, retrieved_docs, ground_truth_keywords),
        "context_recall": context_recall(ground_truth_answer, retrieved_docs),
    }
