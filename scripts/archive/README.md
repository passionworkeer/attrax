# Archived Scripts

One-off data fix scripts — kept for reference only, not needed for normal operation.

## Data Fix Scripts

| 脚本 | 用途 | 日期 |
|------|------|------|
| `fix_decompressed.py` | 用解压后 HTML 填充 processed JSON 的 rawText | 2026-04 |
| `fix_manifest.py` | 修复 manifest.json 记录错误 | 2026-04 |
| `fix_rawtext.py` | 重新解析缺失 rawText 的 JSON 文件 | 2026-04 |
| `regen_corpus_index.py` | 重新生成 corpus_index.json | 2026-04 |
| `batch_parse_corpus.py` | 批量解析语料库为统一 JSON | 2026-04 |

## Legacy Test Scripts

**目录:** `test-doc-upload/`

**归档日期:** 2026-05-13

**用途:** 旧版文档上传功能测试脚本（PDF、DOCX、纯文本等）。

**包含文件:**
- `final-verification.js` - 最终验证测试
- `TEST_REPORT.md` - 测试报告文档
- `test-all-types.js` - 多格式文档测试
- `test-chinese.html` - 中文内容测试
- `test-docx-flow.js` - DOCX 流程测试
- `test-mammoth.js` - Mammoth.js 库测试
- `test-pdfplumber.js` - PDF 解析测试
- `test-plain.txt` - 纯文本测试
- `test-scan-endpoint.js` - 扫描端点测试

**归档原因:** 这些脚本用于文档解析管线的初期开发和验证，功能已集成到主 `/api/scan` 端点。

**替代方案:** 使用 `tests/unit/` 中的 Vitest 单元测试进行文档解析验证。
