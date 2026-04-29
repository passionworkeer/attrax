# -*- coding: utf-8 -*-
"""修复 manifest.json 中的文件记录错误"""
import os, json

base = r'E:\desktop\火鹰合规\attrax\data'
corpus = os.path.join(base, 'corpus')

# 读取 manifest
with open(os.path.join(corpus, 'manifest.json'), encoding='utf-8') as f:
    manifest = json.load(f)

# 读取 corpus_index（用于对照参考）
with open(os.path.join(corpus, 'corpus_index.json'), encoding='utf-8') as f:
    idx = json.load(f)

def file_size_mb(path):
    return round(os.path.getsize(path) / (1024 * 1024), 2)

# 修复1: asia/malaysia - PDF 替换为 HTML
# 实际文件: 马来西亚2025年新跨境数据传输指南说明.html (已有)
#           马来西亚《个人数据保护法》（PDPA 2010，Act 709）.html (缺失!)
malaysia_dir = os.path.join(corpus, 'asia', 'malaysia')
malaysia_files = {f for f in os.listdir(malaysia_dir) if f.endswith(('.pdf','.html'))}

for region in manifest['files']:
    if region['region'] == 'asia/malaysia':
        # 重建 Malaysia 文件列表
        new_files = []
        for fn in sorted(os.listdir(malaysia_dir)):
            if fn.endswith('.html'):
                fp = os.path.join(malaysia_dir, fn)
                new_files.append({
                    "filename": fn,
                    "type": "html",
                    "size_mb": file_size_mb(fp)
                })
            elif fn.endswith('.pdf'):
                fp = os.path.join(malaysia_dir, fn)
                new_files.append({
                    "filename": fn,
                    "type": "pdf",
                    "size_mb": file_size_mb(fp)
                })
        region['files'] = new_files
        region['total'] = len(new_files)
        region['pdfs'] = sum(1 for f in new_files if f['type'] == 'pdf')
        region['html'] = sum(1 for f in new_files if f['type'] == 'html')
        region['docx'] = 0

# 修复2: asia/thailand - PDF 替换为 HTML
thailand_dir = os.path.join(corpus, 'asia', 'thailand')
for region in manifest['files']:
    if region['region'] == 'asia/thailand':
        new_files = []
        for fn in sorted(os.listdir(thailand_dir)):
            if fn.endswith(('.html', '.htm')):
                fp = os.path.join(thailand_dir, fn)
                new_files.append({
                    "filename": fn,
                    "type": "html",
                    "size_mb": file_size_mb(fp)
                })
            elif fn.endswith('.pdf'):
                fp = os.path.join(thailand_dir, fn)
                new_files.append({
                    "filename": fn,
                    "type": "pdf",
                    "size_mb": file_size_mb(fp)
                })
        region['files'] = new_files
        region['total'] = len(new_files)
        region['pdfs'] = sum(1 for f in new_files if f['type'] == 'pdf')
        region['html'] = sum(1 for f in new_files if f['type'] == 'html')
        region['docx'] = 0

# 修复3: gcc 区域 - 添加海湾G-Mark认证体系说明.html
gcc_dir = os.path.join(base, '全部法规', '海湾国家GCC')
if os.path.exists(gcc_dir):
    gcc_files = [f for f in os.listdir(gcc_dir) if f.endswith('.html')]
    for region in manifest['files']:
        if region['region'] == 'gcc':
            new_files = []
            for fn in sorted(gcc_files):
                fp = os.path.join(gcc_dir, fn)
                new_files.append({
                    "filename": fn,
                    "type": "html",
                    "size_mb": file_size_mb(fp)
                })
            region['files'] = new_files
            region['total'] = len(new_files)
            region['html'] = len(new_files)
            region['pdfs'] = 0
            region['docx'] = 0

# 更新 summary totals
total_files = sum(r['total'] for r in manifest['summary']['by_region'].values())
total_pdfs = sum(r['pdfs'] for r in manifest['summary']['by_region'].values())
total_html = sum(r['html'] for r in manifest['summary']['by_region'].values())
total_docx = sum(r['docx'] for r in manifest['summary']['by_region'].values())

# 直接从 files 结构重新计算
actual_files = []
for region in manifest['files']:
    for f in region['files']:
        actual_files.append(f)

manifest['summary']['total_files'] = len(actual_files)
manifest['summary']['total_pdfs'] = sum(1 for f in actual_files if f['type'] == 'pdf')
manifest['summary']['total_html'] = sum(1 for f in actual_files if f['type'] == 'html')
manifest['summary']['total_docx'] = sum(1 for f in actual_files if f['type'] == 'docx')

# 重新写入
out_path = os.path.join(corpus, 'manifest.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, ensure_ascii=False, indent=2)

print('manifest.json 修复完成')
print(f'  total_files: {manifest["summary"]["total_files"]}')
print(f'  pdfs: {manifest["summary"]["total_pdfs"]}')
print(f'  html: {manifest["summary"]["total_html"]}')
print(f'  docx: {manifest["summary"]["total_docx"]}')

# 打印修复后的 region 对照
print()
print('=== 修复后的 region 统计 ===')
for region in manifest['files']:
    r = region['region']
    summary = manifest['summary']['by_region'].get(r, {})
    print(f"  {r}: files={region['total']}, pdf={region['pdfs']}, html={region['html']}, docx={region['docx']}")