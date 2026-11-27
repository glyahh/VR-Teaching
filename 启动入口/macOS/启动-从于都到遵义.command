#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
COURSE_DIR="$REPO_ROOT/课堂演示"
if command -v node >/dev/null 2>&1; then
  exec node "$COURSE_DIR/harness/launch-course.mjs" "$@"
fi
for html in "$COURSE_DIR"/*.html; do
  if [ -f "$html" ]; then
    open "$html"
    exit 0
  fi
done
echo "未检测到 Node.js 且课堂演示目录尚无已构建的 HTML 课件，请先安装 Node.js 22+。" >&2
exit 1
