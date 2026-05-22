# 临时缓存目录清单
# 这些目录可在归档后清空

## 会话缓存
attrax-main/data/sessions/           # 临时会话文件 (TTL 1小时)

## 嵌入缓存
attrax-main/embedding_cache/          # 向量嵌入缓存

## 测试相关
attrax-main/.deepeval/               # DeepEval 测试数据
attrax-main/test-results/            # 测试结果目录
attrax-main/test-doc-upload/          # 上传测试目录

## Python 缓存
attrax-main/__pycache__/             # Python 字节码缓存
attrax/.pytest_cache/                # pytest 缓存
attrax-main/.pytest_cache/           # pytest 缓存

## 根目录异常
node_modules/                        # 不属于任何项目的 node_modules
rag_service.log                      # 开发日志文件

## 空 .next 缓存 (可选)
attrax-main/.next/                   # Next.js 构建缓存 (可按需清理)