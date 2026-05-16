"""星瀚杯法律AI应用赛道 - 火鹰合规项目报告生成器"""

import sys
sys.stdout.reconfigure(encoding='utf-8')

from docx import Document
from docx.shared import Pt, RGBColor, Inches, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.style import WD_STYLE_TYPE
from docx.oxml.ns import qn
from datetime import datetime

def create_report():
    doc = Document()
    
    # 设置中文字体
    style = doc.styles['Normal']
    style.font.name = 'Microsoft YaHei'
    style.font.size = Pt(11)
    style._element.rPr.rFonts.set(qn('w:eastAsia'), '微软雅黑')
    
    # 标题
    title = doc.add_heading('', 0)
    title_run = title.add_run('火鹰合规 - 第二届星瀚杯法律AI应用赛道参赛报告')
    title_run.font.size = Pt(22)
    title_run.font.bold = True
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER
    
    # 副标题
    subtitle = doc.add_paragraph()
    subtitle.alignment = WD_ALIGN_PARAGRAPH.CENTER
    run = subtitle.add_run('赛道：法律AI应用 · 出海合规智能助手')
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(0, 102, 204)
    
    # 日期
    date_para = doc.add_paragraph()
    date_para.alignment = WD_ALIGN_PARAGRAPH.CENTER
    date_run = date_para.add_run(f'报告日期：{datetime.now().strftime("%Y年%m月%d日")}')
    date_run.font.size = Pt(10)
    date_run.font.color.rgb = RGBColor(128, 128, 128)
    
    doc.add_paragraph()
    
    # 一、团队信息
    doc.add_heading('一、参赛团队信息', 1)
    team_table = doc.add_table(rows=4, cols=2)
    team_table.style = 'Table Grid'
    team_data = [
        ('姓名', 'wang'),
        ('角色', '队长 / 全栈开发'),
        ('学院', ''),
        ('班级', ''),
    ]
    for i, (key, val) in enumerate(team_data):
        team_table.rows[i].cells[0].text = key
        team_table.rows[i].cells[1].text = val
    
    doc.add_paragraph()
    
    # 二、产品名称
    doc.add_heading('二、产品名称', 1)
    p = doc.add_paragraph()
    run = p.add_run('火鹰合规（Blaze Hawks）')
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(204, 51, 51)
    
    doc.add_paragraph()
    
    # 三、选题方向
    doc.add_heading('三、选题方向', 1)
    directions = [
        ('方向9：涉外与出海业务智能助手', '随着企业"出海"步伐加快，业务场景从国内延伸至全球，面临法律环境复杂、语言壁垒高、数据跨境合规难等挑战。本产品正是针对这一需求，为跨境电商卖家提供一站式出海合规解决方案。'),
        ('方向1：新法新规信息抓取与报告生成', '产品内置多市场法规知识库（EU、US、UK、CN、AU、SA、AE 等 16+ 市场），自动追踪法规更新，生成合规报告。'),
        ('方向3：特定类型合同审核', '产品支持对出口产品的合规性进行自动审核，结合目标市场的法规要求，生成风险提示和整改建议。'),
    ]
    for title_text, desc in directions:
        p = doc.add_paragraph()
        run = p.add_run(title_text)
        run.bold = True
        p = doc.add_paragraph(desc)
    
    doc.add_paragraph()
    
    # 四、技术架构
    doc.add_heading('四、核心技术架构', 1)
    
    # 技术栈表格
    doc.add_heading('4.1 技术栈', 2)
    tech_table = doc.add_table(rows=4, cols=2)
    tech_table.style = 'Table Grid'
    tech_data = [
        ('前端（Next.js 16）', 'Next.js 16.2.4 + React 19.2.4 + TypeScript + Tailwind CSS 4.x'),
        ('后端（RAG Service）', 'FastAPI + Python 3.10+ + LangGraph 1.1.6'),
        ('向量检索', 'FAISS（6509+ 向量）+ BM25（jieba 中文分词）+ RRF 融合'),
        ('AI 服务', 'LLM: mimoTalk mimo-v2.5 | Embedding: Ollama nomic-embed-text'),
    ]
    for i, (key, val) in enumerate(tech_data):
        tech_table.rows[i].cells[0].text = key
        tech_table.rows[i].cells[1].text = val
    
    doc.add_paragraph()
    
    # RAG 架构亮点
    doc.add_heading('4.2 RAG 架构亮点', 2)
    highlights = [
        ('多层检索 + 动态降级', '优先级1: Ollama 本地 Embedding（零费用）→ 优先级2: ModelScope Qwen3-Embedding（云端）→ 优先级3: BM25 纯稀疏检索（离线模式）'),
        ('Parent-Child 双层分块', 'Child Chunk（200-300 tokens）：精确向量检索 | Parent Chunk（800-1000 tokens）：LLM 完整上下文 | Contextual Prepending：法规名 + 条款编号前缀'),
        ('Must-Check 强制注入', '不同产品类别强制检查特定法规，例如：电子产品强制检查 RoHS、REACH'),
        ('NLI 引用验证软门', '归因分数 >= 0.9：PASS | 归因分数 0.5-0.9：WARN | 存在矛盾：REJECTED，触发重生成'),
    ]
    for title_text, desc in highlights:
        p = doc.add_paragraph()
        run = p.add_run(f'• {title_text}：')
        run.bold = True
        p.add_run(desc)
    
    doc.add_paragraph()
    
    # 五、新增功能
    doc.add_heading('五、新增功能（本次迭代）', 1)
    
    doc.add_heading('5.1 中英双语界面支持', 2)
    p = doc.add_paragraph()
    p.add_run('为满足国际化需求，新增了完整的 i18n 国际化系统：')
    features = [
        'TranslationProvider 上下文管理，支持 zh/en 切换',
        'LanguageSwitcher 组件，右上角快速切换语言',
        '所有 UI 文本均支持中英双语，包括首页、上传页、扫描页、结果页、法规追踪页',
        '语言首选项保存至 localStorage，自动记忆用户选择',
    ]
    for f in features:
        p = doc.add_paragraph(f'• {f}')
    
    doc.add_heading('5.2 实时法规追踪功能', 2)
    p = doc.add_paragraph()
    p.add_run('新增法规更新追踪功能，让用户能监控目标市场的法规变化：')
    features = [
        'API 端点 /api/regulations/updates，支持按市场和关键词筛选',
        '法规追踪页面 /regulations，显示最近更新的法规列表',
        '支持 8 个市场：EU、US、UK、CN、AU、SA、AE（模拟数据）',
        '法规卡片展示发布日期、生效日期、影响类别、可展开查看详情',
        '即将生效（30天内）的法规显示紧急标识',
        '首页添加法规追踪入口，显示法规更新数量',
    ]
    for f in features:
        p = doc.add_paragraph(f'• {f}')
    
    doc.add_paragraph()
    
    # 六、项目测试
    doc.add_heading('六、项目测试验证', 1)
    
    test_table = doc.add_table(rows=5, cols=2)
    test_table.style = 'Table Grid'
    test_data = [
        ('测试类型', '结果'),
        ('Build 测试', '✅ 通过（npm run build）'),
        ('单元测试', '✅ 174 个测试全部通过（npm run test）'),
        ('API 功能', '✅ /api/regulations/updates 正常返回数据'),
        ('国际化', '✅ LanguageSwitcher 正常工作'),
    ]
    for i, (key, val) in enumerate(test_data):
        test_table.rows[i].cells[0].text = key
        test_table.rows[i].cells[1].text = val
    
    doc.add_paragraph()
    
    # 七、Git 分支管理
    doc.add_heading('七、Git 分支管理', 1)
    p = doc.add_paragraph()
    p.add_run('本次迭代创建了以下分支：')
    branches = [
        'i18n-english-support：英文界面支持功能，已合并至 develop',
        'regulation-tracker：实时法规追踪功能，已合并至 develop',
        'develop：主开发分支，已包含所有新功能',
    ]
    for b in branches:
        p = doc.add_paragraph(f'• {b}')
    
    doc.add_paragraph()
    
    # 八、价值主张
    doc.add_heading('八、核心价值主张', 1)
    p = doc.add_paragraph()
    run = p.add_run('"想出海？先烧毁。" —— 用 AI 的火眼金睛，先把合规风险"烧掉"。')
    run.bold = True
    run.font.size = Pt(14)
    run.font.color.rgb = RGBColor(204, 51, 51)
    
    p = doc.add_paragraph()
    p.add_run('核心创新点：')
    innovations = [
        '针对跨境电商场景的多市场合规检查',
        'LangGraph Agentic RAG + NLI 引用验证',
        '合规报告 + 成本利润对比一体化',
        '三级降级策略，高可用性保障',
        '中英双语界面，支持国际化',
        '实时法规追踪，紧跟政策变化',
    ]
    for i in innovations:
        p = doc.add_paragraph(f'• {i}')
    
    doc.add_paragraph()
    
    # 九、未来规划
    doc.add_heading('九、未来发展规划', 1)
    roadmap = [
        ('短期（1-3个月）', '用户系统与权限管理、团队协作功能、历史扫描记录'),
        ('中期（3-6个月）', '实时法规更新推送、更多市场覆盖、供应商合规管理模块'),
        ('长期（6-12个月）', '移动端 APP（iOS/Android）、多语言支持（中/英/日/韩）、企业级 API 服务（SaaS）'),
    ]
    for period, plan in roadmap:
        p = doc.add_paragraph()
        run = p.add_run(f'{period}：')
        run.bold = True
        p.add_run(plan)
    
    doc.add_paragraph()
    
    # 联系方式
    doc.add_heading('十、联系方式', 1)
    contact_table = doc.add_table(rows=3, cols=2)
    contact_table.style = 'Table Grid'
    contact_data = [
        ('团队', 'wang（队长）'),
        ('演示地址', '本地部署 http://localhost:3000'),
        ('技术栈', 'Next.js + FastAPI + LangGraph + FAISS'),
    ]
    for i, (key, val) in enumerate(contact_data):
        contact_table.rows[i].cells[0].text = key
        contact_table.rows[i].cells[1].text = val
    
    # 保存文档
    output_path = r'E:\desktop\火鹰合规\attrax\星瀚杯参赛报告_火鹰合规_最新.docx'
    doc.save(output_path)
    print(f'报告已保存至：{output_path}')
    return output_path

if __name__ == '__main__':
    create_report()