# 前端死代码与接口排查（2026-09-15）

## 本轮实施结果

### 用户决策后的补充实施

- 法规动态保留，现有页面已明确展示示例数据标识，未新增实时抓取。
- 套餐按钮改为“选择方案 / Select plan”；隐藏未配置的客服占位。
- 隐藏首页、上传页、套餐页、扫描失败区域及公共页脚的预制 Demo 入口。Demo 路由和数据保留；真实会话的页脚报告链接仍可使用。
- ResultIncompletePanel 展示传入的状态信息，补充清晰照片/说明书及重试指引，移除面向用户的内部字段排查说明。
- 证据包 PDF/DOCX 的标题、字段、空状态、引用匹配状态按语言输出；文件名包含 zh/en。法规标题、条文、引文保留来源原文，避免未经核验的自动翻译；未取得法规时权限标为待确认。
- 清理利润 Word 单元格与成本流程中的两个多余参数，不改变利润计算。
- 第 6 项闲置 backendMarkdown 参数暂时保留，等待利润报告内容取舍。旧转换器与契约文件本轮未动。

新增验证：86 项针对性测试通过、类型检查通过、diff 空白检查通过；HTTP 检查首页/上传/套餐/法规页均 200，未渲染预制 Demo 链接，套餐/法规文案正确。内置浏览器的旧连接失败页受到地址策略限制，本轮未完成视觉复核；导出语言验证使用渲染调用测试，不等同于实际文件排版验收。

以下正文保留排查时的快照；当前已完成：

- 删除 7 个旧实现文件：旧 client/errors/response-schemas/index、旧 session-access/server-i18n、未使用的 BurningAnimation。同步删除旧动画专属测试和旧 helper 专属测试段，保留仍有效的鉴权、限流测试；报告 schema 测试改为直接导入。
- 清理 15 处未使用符号诊断。剩余 6 处涉及仍公开的参数或行为选择（displayMessage、options、两处 locale、ccy、idx），未为了消除提示修改既有接口语义。
- report-package.ts 仍承载 cross-language contract 测试，本轮保留；report-package-schema.ts 与 types.gen.ts 保留。
- 上传页的三项样例已替换为 Anker A2332 / 欧盟、小米 Smart Kettle 2 Pro / 欧盟、LEGO 76429（18+）/ 美国。
- 每套载入 3 张真实图片；参数摘要默认不载入，可勾选。摘要明确标注为测试资料，已剔除预期识别结果与合规结论。来源保存在 public/product-samples/sources.json。
- “载入三张照片”先完整取得资源再替换表单；失败时保留原上传内容，载入期间禁用表单，避免并发修改；用户确认后经原有 /api/scan 提交，不再由三样例按钮进入预制报告。
- 独立的“查看预制 Demo”入口及其素材继续保留，不代表新样例的真实检测结果。

验证：普通 TypeScript 检查通过；前端单测 78 文件、1009 项通过（最后三处清理仅移除无副作用变量/导入，随后类型检查通过）；浏览器分别验证三套真实资产的载入、市场/品类与摘要切换，并检查实际页面显示。本轮未调用模型生成新报告，因此不作模型识别准确率或合规结论验收承诺。

## 结论与范围

检查当前本地工作树，包含已有未提交改动；没有修改业务代码。前端与后端已经重新启动，上传页、前端健康检查、后端 readiness 均返回 200，正常 TypeScript 检查通过。

对 app、components、lib 的 120 个 TS/TSX/CSS 文件，以 27 个 Next 页面、布局和路由等入口检查静态引用（包含动态 import 字面量和 import 类型）。结果：

- 8 个未被应用入口引用的旧实现候选文件，约 952 行。部分仍被测试引用，删除需要同步处理测试。
- 1 个未被应用入口引用的生成类型文件，1145 行，属于契约生成工具产物，应保留。
- 21 处未使用导入、变量或参数诊断，分布于 12 个文件；与上述文件有交集，不能相加当作问题总数。
- 9 个前端 API 路由：没有证据证明其中某个可以直接删除。法规更新接口是静态演示数据；其余存在页面、导出、资源或运维用途。
- 3 类仍在界面使用的演示/占位功能需要与真实流程区分：旧产品示例、静态法规动态、套餐解锁。

这是代码引用与接口结构审查，不等于完整业务验收。没有重新发起付费模型检测，也未验证所有按钮、报告内容准确性、CSS 选择器或第三方外部调用。

## 1. 未进入应用调用链的文件

| 文件 | 行数 | 证据与建议 |
| --- | ---: | --- |
| app/api/session-access.ts | 59 | 旧 session 鉴权及响应裁剪；应用路由使用 backend-session-access.ts。core-utilities 测试仍引用，清理时应同步调整。 |
| lib/server-i18n.ts | 96 | 应用代码中仅被上述旧 helper 引用；core-utilities 测试仍覆盖。 |
| components/burning/BurningAnimation.tsx | 178 | 当前页面未引用，但 burning-animation.test.tsx 仍测试。应与当前实际过渡页面比对后移除旧组件及专属测试。 |
| lib/pipeline/report-package.ts | 289 | normalizeReportPackage 仅见测试引用；当前主链使用 v1-result-adapter。先确认旧测试是否承担独有契约约束，再迁移或删除。 |
| lib/rag-client/client.ts | 204 | scanMultipart、fetchProfitReport、fetchHealth 未见业务调用；仅经 index 再导出。 |
| lib/rag-client/errors.ts | 65 | 旧 client 与 index 使用；随旧 client 一起清理。 |
| lib/rag-client/response-schemas.ts | 48 | 旧 client 与 index 使用；随旧 client 一起清理。 |
| lib/rag-client/index.ts | 13 | 应用未使用此聚合入口，但 rag-client-report-package 测试从这里导入 validateReportPackage。先改测试为明确的 schema 引用，再清理旧导出。 |

不能随上述文件删除的内容：

- lib/rag-client/types.gen.ts：package.json 的 codegen:rag-types / check:rag-contract 使用它，属于契约工具。
- lib/rag-client/report-package-schema.ts：lib/types.ts:567、568 有内联类型引用，测试也使用其验证逻辑。不能误判为死文件。
- lib/rag-client/v1-adapter.ts、v1-result-adapter.ts：当前真实扫描主链。
- lib/pipeline/demo-scan-session.ts、session-store 等：仍与显式 Demo 流程有关，不能因命名旧或含 mock 就整批移除。

## 2. 21 处未使用符号

通过 `tsc --noEmit --noUnusedLocals --noUnusedParameters --pretty false` 检出。普通 `tsc --noEmit --pretty false` 通过；以下不是普通构建失败的证据。

| 文件与行 | 未使用内容 |
| --- | --- |
| app/result/[sessionId]/result-state-panels.tsx:53 | displayMessage |
| app/result/[sessionId]/use-result-loader.ts:4 | 整条导入 |
| app/result/[sessionId]/use-result-loader.ts:5 | Market、ProductCategory（两项诊断） |
| components/result/ComplianceReportView.tsx:12 | CitationRefContract |
| components/result/FloatingEvidenceCrop.tsx:3、48 | Image、unoptimized |
| lib/pipeline/profit-report.ts:235、588、736 | numFromStringOrNumber、options、fmtInt |
| lib/rag-client/client.ts:66 | url |
| lib/report-export-modules/evidence-pack.ts:20、227、336 | i18nT、两处 locale |
| lib/report-export-modules/profit-docx.ts:293 | ccy |
| lib/report-export-modules/profit-pdf.ts:82 | halfW |
| lib/report-export-modules/profit-render-model.ts:280、295、388 | t、visibleCostEn、idx |
| lib/reporting.ts:2 | createMockScanResult |
| lib/types.blaze-hawks.ts:5 | 整条导入 |

处理注意：导入和无副作用局部变量可优先清理；参数需要检查调用者及原本意图。例如 evidence-pack 的 locale 应确认是否缺少本地化，而不是为了让检查通过直接删参数；ResultIncompletePanel 接收 displayMessage 却仅显示固定说明，需要决定真实失败信息如何呈现。

## 3. 九个前端 API 路由

| 路由 | 调用者/用途 | 本次判断 |
| --- | --- | --- |
| POST /api/scan | app/upload/page.tsx:398 | 创建真实扫描或按配置进入 Demo；保留 |
| GET /api/scan/[sessionId] | use-result-loader.ts:91、profit 页面 | 扫描轮询；保留 |
| GET /api/scan/[sessionId]/asset/[index] | v1-result-adapter 生成图片地址 | 上传图片与缩略图；保留 |
| POST /api/scan/[sessionId]/evidence | EvidenceRequestPanel → evidence-api.ts | 补充资料；保留 |
| POST /api/scan/[sessionId]/revisions | EvidenceRequestPanel → evidence-api.ts | 二次复核；保留 |
| GET /api/report/[sessionId]/[reportType] | result-export-button.tsx:124 | MD/CSV 导出；保留。PDF/DOCX 走浏览器生成，此路由拒绝它们是明确设计，不是死接口 |
| GET /api/regulations/[docId] | evidence-pack.ts:71 | 法规材料获取，转发后端；保留 |
| GET /api/regulations/updates | app/regulations/page.tsx:142 | 活跃接口，但使用本地静态数据，尚不是实时法规抓取 |
| GET /api/health | 本地与部署健康检查 | 运维入口；保留 |

旧 client.ts 中 /scan-multipart、/profit-report、/health 在本地后端 OpenAPI 中仍存在。问题是前端旧 client 未使用，不能据此说后端接口 404 或直接删除后端兼容接口。真实前端主链采用 /api/v1/scans。

## 4. 需要修复或重新接入的界面功能

### A. 新三产品资料尚未成为应用内示例

app/upload/page.tsx:67、72、77 仍用 preset-charger-photo.png、preset-humidifier-photo.png、preset-toy-blocks-photo.png。
startPresetDemo（约 500 行）跳转 /burning/demo，沿用 charger/humidifier/toy 的预制结果，未把新准备的三张照片与可选说明书提交到 /api/scan。

建议：把 Anker、小米、乐高的新素材与对应品类/市场整理为统一样例配置；提供明确的“载入样例并检测”，填入真实上传槽走正常提交链。现有预制报告保留为明确标注的演示入口。

### B. 法规动态是静态数据

app/api/regulations/updates/route.ts:4 引用 data.ts；该文件有 30 条记录。route.ts:121 返回 dataset: static-demo，页面也展示该元信息。

这是有意标注的示例接口，不是坏接口。要实现会上提出的实时官方法规更新，需要真实数据源、抓取时间、更新任务与失败状态；短期不能把静态列表当成实时法规库能力展示。

### C. 套餐按钮只切换选中状态

app/pricing/page.tsx:256 的按钮仅调用 setSelectedPlanIndex，文案却是“立即解锁”；40、48、59、114 行还有历史保留、SKU 配额、人工复核、注册赠送扫描等套餐承诺。本次未见该按钮接入支付或开通接口。

按既定路演需求保留套餐展示，但应明确为方案演示，按钮改成匹配其实际行为的文案。无需为了比赛临时增加真实支付系统。

## 5. 清理次序

1. 清除确定无用的导入/局部变量；逐项判断闲置参数是删掉还是补齐行为。
2. 移除旧 client、旧 helper、旧动画及旧转换器；先迁移相关测试，保留 schema 和生成契约。
3. 接入三套真实样例，验证每套三图与可选文件走同一真实扫描路径。
4. 修正套餐占位文案，保留法规静态数据标识；实时法规更新另列功能任务。
5. 清理完成后检查上传、轮询、图片、补证复核、报告导出；再进行界面优化。

附注：/force-error 是开发环境错误边界测试入口，生产环境返回空页面；不能当普通无引用页面误删。Next 启动还提示 middleware 命名约定已弃用，这是升级维护项，不是当前启动故障。
