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
#
# ⚠️ 提交信息要落成临时文件,不能直接给 git 一个 /dev/stdin ——
#    Git Bash 下 git 会去读 /proc/self/fd/0,报 "could not read log file"。
#    第一版就是这么挂的,而且挂在「检查通过之后」,看起来像检查脚本坏了。

cd "$(dirname "$0")/.." || exit 1

sh tools/check.sh
if [ $? -ne 0 ]; then
  echo
  echo "✗ 检查没过,不提交。"
  exit 1
fi

MSGFILE=$(mktemp) || exit 1
if [ -n "$1" ]; then cat "$1" > "$MSGFILE"; else cat > "$MSGFILE"; fi

# 盖构建时间戳 + 给每个资源打版本号。
#
# ⚠️ **自动盖,不靠人记得改。** 手动维护的版本号漏更一次就再也没人信它。
#
# ⚠️ 光有 meta 里那个时间戳没用 —— 它不影响浏览器要不要重新下载。
#    资源必须带 ?v=,否则加到主屏之后 Service Worker 会把旧版一直端给你,
#    而你唯一能想到的办法是删掉图标重装(那会连数据一起清掉)。
STAMP=$(date +'%m-%d %H:%M')
VER=$(date +'%m%d%H%M')
sed -i "s|<meta name=\"build\" content=\"[^\"]*\">|<meta name=\"build\" content=\"$STAMP\">|" app/index.html
# ⚠️ 替换串开头那个 \1 是**反向引用**，把匹配到的标签原样留下。
#    上一版它在编辑时被吃掉了一层转义，替换串成了光秃秃的 ?v=...，
#    于是 31 个 script 标签**全被替换成一截查询串**，页面直接白屏 ——
#    而且是提交推送之后才发现的。
sed -i -E "s|(<script src=\"[^\":?]+\.js)(\?v=[0-9]+)?\"|\1?v=$VER\"|g" app/index.html
sed -i -E "s|(<link rel=\"stylesheet\" href=\"[^\":?]+\.css)(\?v=[0-9]+)?\"|\1?v=$VER\"|g" app/index.html

# ⚠️ **打完版本号当场验伤。** 上面那两条 sed 一旦写错（反向引用被吞、
#    正则多括一层），表现是把整个标签替换掉 —— 而 check.sh 在这之前就跑完了，
#    根本拦不住。所以在这儿数一遍，不对就退出，不提交。
n=$(grep -c "<script src=" app/index.html)
if [ "$n" -lt 5 ]; then
  echo "✗ 打版本号之后只剩 $n 个 script 标签 —— sed 把标签替换没了"
  echo "   恢复:git checkout -- app/index.html"
  rm -f "$MSGFILE"
  exit 1
fi

git add -A || { rm -f "$MSGFILE"; exit 1; }
git commit -F "$MSGFILE"
rc=$?
rm -f "$MSGFILE"
exit $rc
