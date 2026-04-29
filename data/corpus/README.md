# attrax 火鹰合规 语料库

> 整理时间: 2026-04-29
> 版本: 1.0
> 状态: 已整理，待处理

---

## 总览

| 类型 | 数量 | 说明 |
|------|------|------|
| PDF | 49 | 含官方法规、产品分析、截图 |
| DOCX | 10 | 产品合规分析、参考清单 |
| HTML | 34 | 法规解读网页、官方页面 |
| **合计** | **93** | |

---

## 目录结构

```
corpus/
├── eu/                           # 欧盟法规（核心语料）
│   ├── regulations/
│   │   ├── pdfs/                 # ✅ 官方 EU 法规 PDF（18个，已验证 5/5）
│   │   └── html/                 # ⚠️ EU 法规解读 HTML（6个，待分类）
│   ├── products/                # ✅ EU 产品合规分析 DOCX（8个，已验证 3-5/5）
│   └── uk/                       # 英国法规（1个 HTML）
│
├── us/                           # 美国法规（5个）
├── cn/                           # 中国法规（11个）
├── asia/                         # 亚洲法规
│   ├── malaysia/                 # 马来西亚（2个）
│   ├── thailand/                 # 泰国（1个）
│   ├── singapore/                # 新加坡（3个）
│   ├── indonesia/                # 印度尼西亚（4个）
│   └── vietnam/                  # 越南（5个）
├── middle_east/                  # 中东法规
│   ├── saudi/                    # 沙特（4个）
│   └── uae/                      # 阿联酋（3个）
├── intl/                         # 国际组织
│   ├── wipo/                     # WIPO 国际条约（3个）
│   └── un/                       # 联合国法规（2个）
├── reference/                    # 参考清单文档（5个）
├── screenshot_pending/           # ❌ 待 OCR 截图 PDF（11个，暂不处理）
└── manifest.json                 # 本清单
```

---

## 优先级划分

### Phase 1（立即处理，18 个 EU PDF + 8 个 DOCX）

**EU regulations PDFs（18个）：**
- 质量：全部 5/5，已验证可解析
- 字符量：~4.1M 字符，1,687 页
- 覆盖：REACH / GDPR / AI Act / GPSR / RED / LVD / EMC / RoHS / 玩具安全等

**EU product analysis DOCX（8个）：**
- 质量：3-5/5，含 ~23 张表格
- 覆盖：充电宝、乒乓球拍合规成本与风险分析

### Phase 2（次优先级，~43 个文件）

- 中国法规（11个 HTML/PDF）
- 美国法规（5个）
- 新加坡/越南/印尼/马来西亚（14个）
- EU 法规解读 HTML（6个）
- 参考清单（5个）
- 中东法规（7个）

### Phase 3（低优先级，0 个）

- 海湾国家（GCC）：目录存在，无文件

### 暂跳过（11 个截图 PDF）

- `screenshot_pending/`：截图型 PDF，需 OCR 处理
- 优先级最低，可后续评估是否值得 OCR

---

## 已知重复文件

`全部法规/欧盟/` 中存在 3 个 PDF（GDPR/DMA/DSA），文件大小约为 `合规/EU_regulations/` 中同名文件的 40-60%，为摘要版，已移至 `reference/`。

`欧盟合规充电宝零件要求_副本.docx` 为 `欧盟合规充电宝零件要求.docx` 的副本，已保留，不重复处理。

---

## 语料库元数据

详见 `manifest.json`，包含每个文件的：
- `filename`: 文件名
- `type`: 文件类型（pdf/docx/html）
- `size_mb`: 文件大小（MB）