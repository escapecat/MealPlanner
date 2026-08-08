#!/bin/sh
# 提交前跑这个。
#
# 为什么要有它:2026-08-05 有一次坏代码进了提交 —— heredoc 把字符串里的 \n
# 变成了真换行,`node --check` 确实报了错,但我的命令链条用 && 串起来时
# 把那次失败吞掉了,后面的 git commit 照样执行。
#
# 教训:检查必须是独立的一步,而且失败要能真的挡住提交。

cd "$(dirname "$0")/.." || exit 1
fail=0

for f in app/app.js app/lib/*.js app/core/*.js app/ui/*.js app/data/*.js; do
  [ -e "$f" ] || continue
  if ! node --check "$f" 2>/dev/null; then
    echo "✗ 语法错误: $f"
    node --check "$f" 2>&1 | head -4
    fail=1
  fi
done

if ! python tools/validate.py >/dev/null 2>&1; then
  echo "✗ 数据层校验没过,跑 python tools/validate.py 看详情"
  fail=1
fi

# index.html 里引用的脚本都得真实存在 —— 少一个页面就白屏
for src in $(grep -o 'src="[^"]*\.js"' app/index.html | sed 's/src="//;s/"//'); do
  [ -e "app/$src" ] || { echo "✗ index.html 引用了不存在的 $src"; fail=1; }
done

# 回归测试。加进来的都是「看代码看不出来、跑一遍才暴露」的那类:
#   staples —— 一次性迁移写成每帧重算,把用户刚勾的当残留抹掉(勾了没反应)
#   modal   —— 弹层挡在所有破坏性操作前面,confirm 认错返回值就会静默删数据
#   flow    —— 「换掉这道菜」失败是静默的:排除没生效就又给你排同一道,不报错
#   boot    —— **白屏**。node --check 只查语法,运行时抛异常照样过;
#              而页面一片空白时,除了控制台没有任何提示。这一条按 index.html
#              的顺序真加载一遍再挨个挂载页面。
for t in tools/jstest/staples.js tools/jstest/modal.js tools/jstest/flow.js tools/jstest/pinyin.js tools/jstest/timing.js tools/jstest/notes.js tools/jstest/recipebook.js tools/jstest/boot.js tools/jstest/settings.js tools/jstest/meal.js tools/jstest/snack.js; do
  [ -e "$t" ] || continue
  if ! node "$t" >/dev/null 2>&1; then
    echo "✗ 回归测试没过: $t"
    node "$t" 2>&1 | grep -i "FAIL\|Error" | head -5
    fail=1
  fi
done

# 系统弹窗不该再出现 —— 样式割裂,而且小程序里没有 window.prompt
if grep -rn "[^.a-zA-Z_]\(prompt\|alert\)(" app/ui/*.js app/core/*.js app/app.js 2>/dev/null \
   | grep -v "app/ui/modal.js" | grep -v "//" | grep -q .; then
  echo "✗ 还有 prompt/alert 没换成 Modal:"
  grep -rn "[^.a-zA-Z_]\(prompt\|alert\)(" app/ui/*.js app/core/*.js app/app.js 2>/dev/null \
    | grep -v "app/ui/modal.js" | grep -v "//"
  fail=1
fi

# 求解器的营养项靠 rounds.js 传 target 通电。断了不会报错,只会悄悄排出
# 「晚饭 = 一盘青菜」—— 已经发生过一次,这里钉住。
if ! grep -q "target: target" app/ui/rounds.js; then
  echo "✗ rounds.js 没把 target 传给 Solver —— 营养打分会整项失效"
  fail=1
fi

if [ $fail -eq 0 ]; then
  echo "✓ 语法 · 数据层 · 脚本引用 · 回归测试 全部通过"
else
  echo "✗ 有问题,别提交"
fi
exit $fail
