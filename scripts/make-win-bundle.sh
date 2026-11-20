#!/usr/bin/env bash
# 生成 Windows 部署包：源码 + 运行时依赖（仅 ws），不含 test/docs/poc 与本地工具配置
set -euo pipefail
cd "$(dirname "$0")/.."
OUT=${1:-/tmp/steel-tide-win.zip}
STAGE=$(mktemp -d)
rsync -a --exclude node_modules --exclude test --exclude docs --exclude poc --exclude scripts \
  --exclude .git --exclude .agents --exclude .aiden --exclude .coco --exclude .hermes \
  --exclude .trae --exclude .trae-cn --exclude .claude --exclude 'agentbuddy*.yaml' \
  --exclude .DS_Store ./ "$STAGE/"
mkdir -p "$STAGE/node_modules"
rsync -a node_modules/ws "$STAGE/node_modules/"
rm -f "$OUT"
( cd "$STAGE" && zip -qr "$OUT" . )
rm -rf "$STAGE"
ls -lh "$OUT"
