#!/bin/sh
# 提交入口。**只用这个提交,不要手打 git commit。**
#
# 2026-08-06 又踩了一次 check.sh 头上写着的那个坑:
#     bash tools/check.sh 2>&1 | tail -5 && git add -A && git commit ...
# 管道的退出码是 tail 的(永远 0),检查明明报了 FAIL,提交照样过去了。
# 和当初那次 `node --check` 被 && 链吞掉是同一个错误 —— 换了个壳而已。
#
# 教训升级:光把检查写成独立一步不够,**得让它没法被绕过**。
# 这里不加管道、不加 tail、不加 &&,失败直接 exit。

cd "$(dirname "$0")/.." || exit 1

sh tools/check.sh
if [ $? -ne 0 ]; then
  echo
  echo "✗ 检查没过,不提交。"
  exit 1
fi

git add -A || exit 1
git commit -F "${1:-/dev/stdin}"
