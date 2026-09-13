#!/usr/bin/env python3
"""eval_grounding.py — 定位质量评测（plan 2026-09-13 §12.2）.

Compares a model scan's observations against a human-labeled ground
truth and reports the release-gate metrics:

  - localization precision  (predicted box vs expert box, IoU >= 0.5)
  - localization recall     (expert boxes the system found)
  - abstention rate         (checks with a visible target but no emitted
                             box — gaming precision by never boxing is
                             the failure mode this exposes)
  - imageId accuracy        (MUST be 100% before release)
  - small-region split      (boxes with min side < 3% of image dimension
                             are reported separately per the plan)

Ground-truth format (JSONL, one record per labeled check-instance)::

    {
      "imageId": "session-image-0",
      "checkId": "common.nameplate.readability",
      "visibility": "present_readable",
      "hasIssue": false,
      "bbox": {"x": 0.10, "y": 0.12, "w": 0.30, "h": 0.15},
      "needsReshoot": [],
      "note": "optional"
    }

Scan format (JSONL, one record per observation, the same shape the
reportPackage.observations array carries)::

    {"observationId": "...", "checkId": "...", "imageId": "...",
     "visibility": "...", "region": {"kind": "bbox",
     "bbox": {"x": ..., "y": ..., "w": ..., "h": ...}} | null}

Usage:
    python scripts/eval_grounding.py ground_truth.jsonl scan_output.jsonl
    python scripts/eval_grounding.py ground_truth.jsonl scan_output.jsonl --iou 0.5
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Metrics:
    name: str
    matched: int = 0
    predicted: int = 0
    truth: int = 0
    image_id_errors: int = 0
    small_matched: int = 0
    small_truth: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def precision(self) -> float | None:
        return self.matched / self.predicted if self.predicted else None

    @property
    def recall(self) -> float | None:
        return self.matched / self.truth if self.truth else None

    @property
    def abstention_rate(self) -> float | None:
        if not self.truth:
            return None
        unboxed = self.truth - self.matched
        return unboxed / self.truth


def _iou(a: dict, b: dict) -> float:
    ax1, ay1 = a["x"], a["y"]
    ax2, ay2 = a["x"] + a["w"], a["y"] + a["h"]
    bx1, by1 = b["x"], b["y"]
    bx2, by2 = b["x"] + b["w"], b["y"] + b["h"]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = a["w"] * a["h"] + b["w"] * b["h"] - inter
    return inter / union if union > 0 else 0.0


def _is_small(bbox: dict) -> bool:
    # §12.2: 细小/细长文字区域另评 — min side under 3% of the image.
    return min(bbox["w"], bbox["h"]) < 0.03


def load_jsonl(path: Path) -> list[dict]:
    records: list[dict] = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, line in enumerate(fh, 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            try:
                records.append(json.loads(line))
            except json.JSONDecodeError as exc:
                print(f"warning: {path}:{line_no}: bad JSON skipped ({exc})", file=sys.stderr)
    return records


def evaluate(
    truth: list[dict],
    predicted: list[dict],
    iou_threshold: float = 0.5,
) -> Metrics:
    metrics = Metrics(name="grounding")

    # Index predictions by (imageId, checkId); keep only box-bearing ones.
    predicted_by_key: dict[tuple[str, str], dict] = {}
    for obs in predicted:
        region = obs.get("region") or {}
        bbox = region.get("bbox") if isinstance(region, dict) else None
        if not isinstance(bbox, dict):
            continue
        key = (str(obs.get("imageId") or ""), str(obs.get("checkId") or ""))
        predicted_by_key[key] = bbox

    for label in truth:
        truth_bbox = label.get("bbox")
        if not isinstance(truth_bbox, dict):
            continue  # labels without a box don't participate in localization
        metrics.truth += 1
        small = _is_small(truth_bbox)
        if small:
            metrics.small_truth += 1

        key = (str(label.get("imageId") or ""), str(label.get("checkId") or ""))
        pred_bbox = predicted_by_key.get(key)
        if pred_bbox is None:
            continue  # abstained (or wrong image) — recall hit, precision safe

        # Wrong-image check: the observation exists but under a different
        # imageId for this checkId.
        same_check_other_image = any(
            str(obs.get("checkId") or "") == key[1]
            and str(obs.get("imageId") or "") != key[0]
            for obs in predicted
            if isinstance((obs.get("region") or {}).get("bbox"), dict)
        )
        if same_check_other_image and key not in predicted_by_key:
            metrics.image_id_errors += 1

        if _iou(pred_bbox, truth_bbox) >= iou_threshold:
            metrics.matched += 1
            if small:
                metrics.small_matched += 1

    metrics.predicted = len(predicted_by_key)
    return metrics


def _fmt(value: float | None) -> str:
    return "n/a" if value is None else f"{value:.1%}"


def report(metrics: Metrics, iou: float) -> None:
    print(f"定位评测（IoU ≥ {iou}）")
    print(f"  ground-truth 框数:        {metrics.truth}")
    print(f"  系统出框数:               {metrics.predicted}")
    print(f"  匹配数:                   {metrics.matched}")
    print(f"  precision:                {_fmt(metrics.precision)}   (发布门槛 ≥95%)")
    print(f"  recall:                   {_fmt(metrics.recall)}")
    print(f"  abstention rate:          {_fmt(metrics.abstention_rate)}")
    if metrics.small_truth:
        print(
            f"  细小区域单独:             {metrics.small_matched}/{metrics.small_truth}"
        )
    print(f"  imageId 错误:             {metrics.image_id_errors}   (必须为 0)")
    if metrics.image_id_errors:
        print("  ❌ imageId 存在错误 — 未达发布门槛")
    if metrics.precision is not None and metrics.precision < 0.95:
        print("  ❌ precision < 95% — 未达发布门槛")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("ground_truth", type=Path, help="labeled JSONL")
    parser.add_argument("scan_output", type=Path, help="observations JSONL")
    parser.add_argument("--iou", type=float, default=0.5)
    args = parser.parse_args(argv)

    truth = load_jsonl(args.ground_truth)
    predicted = load_jsonl(args.scan_output)
    metrics = evaluate(truth, predicted, iou_threshold=args.iou)
    report(metrics, args.iou)
    return 0


if __name__ == "__main__":
    sys.exit(main())
