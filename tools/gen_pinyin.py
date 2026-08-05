# -*- coding: utf-8 -*-
"""汉字 → 拼音表,只收数据里真正出现过的字。

为什么生成成静态表而不是运行时算:
    这个 app 的硬约束是**双击 index.html 就能跑**(file:// 下不能 fetch、不能 npm)。
    所以 pypinyin 只在构建期用一次,产物是一个纯 .js —— 运行时依然零依赖。

为什么不收全量 2 万字:
    只有 1586 个字在菜谱和食材字典里出现过。收全量表 500KB+,手机上白等。

多音字:同一个字给出所有读音(去掉声调后去重),用 | 分隔。
    干 → gan|an   重 → zhong|chong
    搜索时任一读音命中都算,反正是搜索不是注音。
"""
import io, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')

try:
    from pypinyin import pinyin, Style
except ImportError:
    sys.stderr.write('need: pip install pypinyin (build-time only)\n')
    sys.exit(1)

SRC = ['app/data/recipes.js', 'app/data/ingredients.js', 'app/data/packages.js']
OUT = os.path.join(ROOT, 'app', 'data', 'pinyin.js')

chars = set()
for rel in SRC:
    p = os.path.join(ROOT, rel)
    if not os.path.exists(p):
        continue
    chars |= set(re.findall(u'[一-鿿]', io.open(p, encoding='utf-8').read()))

table = {}
for c in sorted(chars):
    readings = []
    for group in pinyin(c, style=Style.NORMAL, heteronym=True):
        for r in group:
            r = re.sub(u'[^a-z]', '', r.lower())
            if r and r not in readings:
                readings.append(r)
    if readings:
        table[c] = u'|'.join(readings[:4])       # 封顶 4 个,再多对搜索没帮助

body = u',\n'.join(u'  "%s": "%s"' % (c, table[c]) for c in sorted(table))
out = u'''// 汉字 → 拼音(去声调)。**自动生成,别手改** —— 改 tools/gen_pinyin.py 再重跑。
//
// 只收 app/data/ 里真正出现过的 %d 个字。全量表 500KB+,手机上白等。
// 多音字用 | 分隔,搜索时任一读音命中都算。
//
// pypinyin 只在构建期用,产物是这个纯 .js —— 运行时零依赖,双击 index.html 照样跑。

var PINYIN = {
%s
};

if (typeof module !== 'undefined') module.exports = PINYIN;
''' % (len(table), body)

io.open(OUT, 'w', encoding='utf-8', newline='\n').write(out)
sys.stdout.write('wrote %s  (%d chars, %.1f KB)\n'
                 % (os.path.relpath(OUT, ROOT), len(table), os.path.getsize(OUT) / 1024.0))
