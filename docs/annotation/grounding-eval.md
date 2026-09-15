# 定位标注集格式与评测流程（plan 2026-09-13 §12.2 — 仍为权威；2026-09-14 judge-review plan 继承该阈值未改）

> 最后核对：2026-09-14。本文档仍为 `scripts/eval_grounding.py`（2026-09-13 Batch E 落地）的标注格式与评测流程权威真值。

## 标注集规模与构成

初始标注集建议 **100–150 张**：

- 充电器 / 加湿器 / 玩具 / 耳机盒 各约 20–30 张
- 另加极端比例、旋转、反光、遮挡、多图等场景
- **另留独立验证集**，不在验收集上反复调 Prompt

每张图人工标注：`checkId`、可见性、位置（bbox）、是否有问题、需要哪些补拍。
**不能只标有问题的正样本**——干净样本同样要标，否则 recall/abstention 无法计算。

## 标注文件格式（ground truth，JSONL，一行一个检查实例）

```jsonc
{
  "imageId": "scan_xxx-image-0",          // 会话资产 id；纯离线标注可用任意稳定 id
  "checkId": "common.nameplate.readability",
  "visibility": "present_readable",        // 六态枚举，同 Observation 契约
  "hasIssue": false,                       // 人工判断该区域是否存在真实问题
  "bbox": { "x": 0.10, "y": 0.12, "w": 0.30, "h": 0.15 },  // 无可定位目标时省略
  "needsReshoot": ["nameplate_closeup"],  // 需要补拍的视角
  "note": "可选备注"
}
```

- bbox 归一化到 canonical image（EXIF 方向已应用），x+w≤1、y+h≤1。
- 纯文本类检查（如"缺说明书"）不标 bbox。

## 扫描输出格式（observations，JSONL）

直接取扫描会话 `reportPackage.observations` 数组逐行导出即可：

```jsonc
{"observationId":"...","checkId":"...","imageId":"...","visibility":"...",
 "region":{"kind":"bbox","bbox":{"x":...,"y":...,"w":...,"h":...}}}
```

## 评测

```bash
python scripts/eval_grounding.py ground_truth.jsonl scan_output.jsonl
python scripts/eval_grounding.py ground_truth.jsonl scan_output.jsonl --iou 0.5
```

输出指标：

| 指标 | 发布门槛 |
|---|---|
| localization precision（IoU≥0.5） | **≥95%** |
| localization recall | 报告值（无硬门槛，防刷精度） |
| abstention rate | 报告值（不出框刷精度的失败模式由此暴露） |
| 细小区域（min 边 <3%） | 单独报告 |
| imageId 错误 | **必须为 0** |

未达门槛时：保留框/补拍体验，不靠动画绕过（plan §11）。

## 关键事实验收（§12.2）

- 旧流程的"一致性校验"不得再作为风险（已修：v1-result-adapter 过滤流程节点）
- 底面未拍不得在正面圈出"缺铭牌"（findings 对 not_in_view 输出补拍建议而非画框）
