# -*- coding: utf-8 -*-
"""
markdown 表格 → app/data/*.js

为什么要这一步:数据层是人写人读的 markdown 表,应用层要的是能被 <script src> 加载的
对象数组。DESIGN.md 定了用 .js 不用 .json —— .json 要 fetch 读,file:// 双击打开会被
CORS 拦掉,得起本地服务器;.js 双击就能跑,迁小程序时末尾加一行 module.exports 即可。

复用 validate.py 的表解析器(按表头签名分类,不按行套正则)—— 那个教训今晚犯了六次。

用法:  python tools/build_data.py
"""
import os
import re
import sys
import json
import glob

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from validate import parse_tables, RECIPES, INGREDIENTS, ROOT   # noqa: E402

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

OUT = os.path.join(ROOT, 'app', 'data')
ITEM = re.compile(r'([^\[\]()\s·]+)\[([a-z0-9_?]+)\]')

ROLE = {'主': 'main', '配': 'side', '主食': 'staple', '香料': 'aromatic'}
warnings = []


# ------------------------------------------------------------ 小工具

def cell(row, header, name, default=''):
    """按列名取值,列不存在返回默认 —— 四个字典列集不同,不能按下标取"""
    if name not in header:
        return default
    v = row[header.index(name)].strip()
    return default if v in ('—', '-', '') else v


def num(s, default=None):
    if not s:
        return default
    m = re.search(r'-?\d+(?:\.\d+)?', s.replace(',', ''))
    return float(m.group()) if m else default


def days(s):
    """「冷藏3-5天」「12个月」「365」「常温365天」→ 天数。取区间下限(保守)。"""
    if not s:
        return None
    s = s.replace('**', '')
    m = re.search(r'(\d+)\s*(?:-\s*(\d+))?\s*个?月', s)
    if m:
        return int(m.group(1)) * 30
    m = re.search(r'(\d+)\s*(?:-\s*(\d+))?\s*年', s)
    if m:
        return int(m.group(1)) * 365
    m = re.search(r'(\d+)\s*(?:-\s*(\d+))?\s*周', s)
    if m:
        return int(m.group(1)) * 7
    m = re.search(r'(\d+)\s*(?:-\s*(\d+))?', s)
    return int(m.group(1)) if m else None


def yes(s):
    return s.strip().startswith('是')


# 过敏原的规范写法。字典里出现过 `**大豆**`、`甲壳类`、`鱼类` 这些变体,
# 求解器按字段过滤时对不上就会漏。
ALLERGEN_CANON = {
    '甲壳类': '甲壳', '鱼类': '鱼', '乳制品': '乳', '蛋类': '蛋',
    '小麦': '麸质', '麸质(小麦)': '麸质',
}


def allergens(text):
    """把过敏原列解析成干净的名字列表。

    ⚠️ 只按 `·` 切,不能按 `、` 或 `/` 切 —— 那两个符号出现在括号里的说明文字中。
       早先用通用的 split_list(按 /·、 一起切),把
       `**菠萝蛋白酶**(口腔刺痛/过敏)` 劈成了两个「过敏原」:
       `**菠萝蛋白酶**(口腔刺痛` 和 `过敏)`。
       25 个过敏原里有 14 个是这么来的碎片。
    """
    if not text or text.strip() == '—':
        return []
    out = []
    # 先按 · 切,再按括号外的 / 切 —— `甲壳类(虾酱)· 鱼类(鱼露)` 和 `甲壳/鱼` 都要能拆
    parts = []
    for seg in text.split('·'):
        depth = 0
        buf = ''
        for ch in seg:
            if ch in '((':
                depth += 1
            elif ch in '))':
                depth = max(0, depth - 1)
            if ch == '/' and depth == 0:
                parts.append(buf)
                buf = ''
            else:
                buf += ch
        parts.append(buf)
    for part in parts:
        part = part.strip().replace('*', '')
        part = re.sub(r'[((].*?[))]', '', part).strip()   # 去掉括号说明
        part = re.sub(r'[((].*$', '', part).strip()        # 括号没闭合的也去掉
        if not part or part == '—':
            continue
        out.append(ALLERGEN_CANON.get(part, part))
    # 去重保序
    seen, res = set(), []
    for x in out:
        if x not in seen:
            seen.add(x)
            res.append(x)
    return res


def split_list(s):
    if not s:
        return []
    return [x.strip() for x in re.split(r'[/·、]| 或 ', s) if x.strip() and x.strip() != '—']


def js(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(',', ':'))



# ---------------------------------------------------------------------------
# 备注拆成两半:给做饭的人看的 / 给建库的人看的
#
# ⚠️ 1149 条备注里混着两种完全不同的东西:
#     做法提示  「炒糖色到枣红立刻下肉,全程不加生水」        → 该显示
#     建库笔记  「牺牲:肥瘦比例由厂家定…单位成本约为自炖的 2 倍。
#                 主表备注写的『只适合有空的周末』这条限制被解除」→ 不该显示
#               「⚠️ 牛腱原值 90g 是熟重,按本文件附录『熟重约为生重…』」→ 不该显示
#
#    第二种是我建库时写给自己看的设计理由和数据加工说明,它们引用「本文件」
#    「附录」「主表」和反引号里的 id —— 全是内部产物。出现在做饭页面上,
#    读起来就像 app 在跟你解释它自己的实现。
#
#    **markdown 正本一个字不动**,拆分只发生在这里:note 只留做法提示,
#    其余进 devNote(仍然留在数据里,只是界面不显示)。不删,只分流。
DEV_MARKERS = ['本文件', '附录', '设计上', '牺牲', '换来的是', '单位成本',
               '原值', '熟重', '生重', '这一档', '这一行', '障碍是', '主表',
               '省掉', '解锁', '档位', '补录', '按字典', '代价', '裁决',
               '折叠', '采购清单', '全库', '外包', 'assembled', 'readymade',
               'scratch', '⚠️']

# 反引号包的 id、以及 `CX-046` 这种菜谱交叉引用 —— 做菜提示里不会出现代码格式,
# 出现了就说明这句话是写给建库的人看的
_DEV_RE = re.compile(r'`|[A-Z]{2}-\d{3}')

def _is_dev(seg):
    return any(m in seg for m in DEV_MARKERS) or bool(_DEV_RE.search(seg))

def split_note(text):
    """→ (给人看的做法提示, 建库笔记)。切在第一个出现建库特征的句子处。"""
    if not text:
        return None, None
    parts = re.split(r'(?<=[。;；])', text)
    keep = []
    for i, seg in enumerate(parts):
        if _is_dev(seg):
            return (''.join(keep).strip() or None), ''.join(parts[i:]).strip()
        keep.append(seg)
    return text.strip() or None, None

def emit(fname, varname, rows, note):
    os.makedirs(OUT, exist_ok=True)
    p = os.path.join(OUT, fname)
    with open(p, 'w', encoding='utf-8') as f:
        f.write('// %s\n// 由 tools/build_data.py 从 data/*.md 生成 —— 不要手改,改 markdown 再重新生成\n' % note)
        f.write('var %s = [\n' % varname)
        for r in rows:
            f.write('  ' + js(r) + ',\n')
        f.write('];\n')
        f.write("if (typeof module !== 'undefined') module.exports = %s;\n" % varname)
    print('  %-22s %4d 条  %6.1f KB' % (fname, len(rows), os.path.getsize(p) / 1024))


# ------------------------------------------------------------ 食材

COUNT_UNIT = re.compile(
    r'(\d+(?:\.\d+)?)\s*(只|个|片|张|条|颗|根|块|包|袋|瓶|盒|把|串|枚|杯|勺)')
VOL_UNIT = re.compile(r'(\d+(?:\.\d+)?)\s*(ml|毫升|L|升)')
GRAM = re.compile(r'(\d+(?:\.\d+)?)\s*g')


def parse_qty_role(tail):
    """把克数位解析成 (qty, unit, grams, role, toTaste)。

    ⚠️ 单位必须保留。全库有 200 处不是按克写的:
        鸡蛋 2个 · 速冻水饺 20只 · 饺子皮 25张 · 香醋 15ml · 鲫鱼 1条 300g
    第一版只抠数字丢单位,20 只饺子变成 20 克 —— 求解器会照着买 20 克。
    这里如实记 qty+unit,**换算是字典的事**(鸡蛋单个约 50g 该写进字典),
    转换层不假装知道。
    """
    tail = tail.strip()
    role = None
    for zh, en in ROLE.items():
        if tail.endswith(zh):
            role = en
            tail = tail[:-len(zh)].strip()
            break
    if '适量' in tail:
        return None, None, None, role, True

    g = GRAM.search(tail)
    grams = float(g.group(1)) if g else None

    m = COUNT_UNIT.search(tail)
    if m:
        # 「1条 300g」两者都给了 —— qty 记件数、grams 记重量,都不丢
        return float(m.group(1)), m.group(2), grams, role, False

    v = VOL_UNIT.search(tail)
    if v:
        ml = float(v.group(1)) * (1000 if v.group(2) in ('L', '升') else 1)
        return ml, 'ml', grams, role, False

    return grams, ('g' if grams is not None else None), grams, role, False


def parse_items(s):
    """食材单元格 → [{ids, names, qty, unit, grams, role, toTaste}]
    ids 多于一个表示「或」组(同一个位置多选一)"""
    out = []
    if not s or s in ('—', '-'):
        return out
    for chunk in s.split('·'):
        chunk = chunk.strip()
        if not chunk:
            continue
        pairs = ITEM.findall(chunk)
        if not pairs:
            continue
        tail = chunk[chunk.rfind(']') + 1:]
        qty, unit, grams, role, to_taste = parse_qty_role(tail)
        out.append({
            'ids': [p[1] for p in pairs],
            'names': [p[0] for p in pairs],
            'qty': qty,
            'unit': unit,
            'grams': grams,      # 只有原文明确给了克重才有值,绝不从件数猜
            'role': role,
            'toTaste': to_taste,
        })
    return out


def parse_unit_conv(s):
    """「1个≈50g(带壳;去壳约45g)」→ {'个': 50}
    多种计件方式用 ` · ` 分隔:「1片≈35g · 1条≈500g」→ {'片':35, '条':500}

    markdown 那一列是给人读的(带括号里的区间和口径说明),
    这里抠出机器要的部分,原文另存 unitConvRaw 供 UI 显示 —— 不确定性不能在转换时丢掉。
    """
    out = {}
    if not s:
        return out
    for part in s.split('·'):
        m = re.search(r'(\d+(?:\.\d+)?)\s*([^\d\s≈~=]+?)\s*[≈~=]\s*(\d+(?:\.\d+)?)\s*(g|ml)', part)
        if m:
            n, unit, grams = float(m.group(1)), m.group(2).strip(), float(m.group(3))
            if n:
                out[unit] = round(grams / n, 2)
    return out


def build_ingredients():
    rows, seen = [], {}
    for p in sorted(glob.glob(os.path.join(INGREDIENTS, '0*.md'))):
        src = os.path.basename(p)[:2]
        for t in parse_tables(p):
            h = t['header']
            if not h or h[0].lower() != 'id' or len(h) < 10:
                continue
            for lineno, r in t['rows']:
                if len(r) != len(h) or not re.match(r'^[a-z][a-z0-9_]*$', r[0]):
                    continue
                iid = r[0]
                if iid in seen:
                    warnings.append('重复 id %s(%s 与 %s)' % (iid, seen[iid], src))
                    continue
                seen[iid] = src

                prepared = (src == '04')
                item = {
                    'id': iid,
                    'name': cell(r, h, '名称'),
                    'aliases': split_list(cell(r, h, '别名')),
                    'category': cell(r, h, '类别'),
                    'tier': cell(r, h, 'tier', 'staple' if prepared else ''),
                    'allergens': allergens(cell(r, h, '过敏原')),
                    'hasAlcohol': yes(cell(r, h, '含酒')),
                    'hasBones': yes(cell(r, h, '有刺')) if '有刺' in h else None,
                    'vegLevel': cell(r, h, '素食等级') or None,
                    'costTier': int(num(cell(r, h, '成本档'), 0) or 0) or None,
                    'unitConv': parse_unit_conv(cell(r, h, '单位换算')),
                    'unitConvRaw': cell(r, h, '单位换算') or None,
                    'source': src,
                    'isPrepared': prepared,
                    'note': cell(r, h, '备注'),
                }

                if prepared:
                    item.update({
                        'packaging': cell(r, h, '包装规格'),
                        'countUnit': cell(r, h, '计件单位') or None,
                        'tempZone': cell(r, h, '温区') or None,
                        'shelfLifeDays': days(cell(r, h, '保质期')),
                        'forRecipes': split_list(cell(r, h, '对应菜谱ID')),
                        'refPrice': num(cell(r, h, '参考价')),
                        'confidence': cell(r, h, '可信度') or 'C',
                        'tradeoff': cell(r, h, '牺牲了什么'),
                        'per100g': None,
                    })
                else:
                    item.update({
                        'packaging': cell(r, h, '常见包装'),
                        'shelfLifeDays': days(cell(r, h, '冷藏天数') or cell(r, h, '开封前保质期')),
                        'openedShelfLifeDays': days(cell(r, h, '开封后有效期')),
                        'freezable': yes(cell(r, h, '可冷冻')) if '可冷冻' in h else None,
                        'frozenShelfLifeDays': days(cell(r, h, '冷冻天数')),
                        'per100g': {
                            'kcal': num(cell(r, h, 'kcal') or cell(r, h, 'kcal/100g')),
                            'protein': num(cell(r, h, '蛋白') or cell(r, h, '蛋白/100g')),
                            'fat': num(cell(r, h, '脂肪')),
                            'carb': num(cell(r, h, '碳水') or cell(r, h, '碳水/100g')),
                            'fiber': num(cell(r, h, '膳食纤维/100g')),
                        },
                        'countsAsVeg': yes(cell(r, h, '计入蔬菜量')) if '计入蔬菜量' in h else None,
                        'season': cell(r, h, '时令') or None,
                        'singleUse': cell(r, h, '单次用量') or None,
                        'inevitableSurplus': yes(cell(r, h, '必然过量')) if '必然过量' in h else None,
                        'confidence': 'C',
                    })
                rows.append(item)
    return rows


# ------------------------------------------------------------ 菜谱

PREFIX = {'01': 'JC', '02': 'CX', '03': 'YZ', '04': 'BF', '05': 'XS', '06': 'RH'}


def build_recipes(known_ids):
    recipes, order = {}, []
    for p in sorted(glob.glob(os.path.join(RECIPES, '0[1-6]-*.md'))):
        base = os.path.basename(p)
        pre = PREFIX[base[:2]]
        for t in parse_tables(p):
            h = t['header']
            if not h or h[0] != 'ID':
                continue

            if len(h) == 18:                                  # 主表
                for lineno, r in t['rows']:
                    if len(r) != 18 or not re.match('^' + pre + r'-\d{3}$', r[0]):
                        continue
                    rec = {
                        'id': r[0], 'name': r[1],
                        'type': r[15] or 'dish',
                        'method': r[3], 'flavor': split_list(r[4]),
                        'spicy': int(num(r[5], 0) or 0),
                        'file': base[:2],
                        'equipmentRequired': [x.strip() for x in r[11].split('+') if x.strip() and x.strip() != '—'],
                        'equipmentAlt': [split_list(g) for g in r[12].split('·') if g.strip() and g.strip() != '—'],
                        'potsUsed': int(num(r[10], 1) or 1),
                        'keepsOvernight': yes(r[14]),
                        'raw': yes(r[16]),
                        'note': split_note(r[17])[0],
                        'devNote': split_note(r[17])[1],
                        'verified': False,
                        'variants': [{
                            'prepLevel': 'scratch',
                            'ingredients': parse_items(r[2]),
                            'seasonings': parse_items(r[13]),
                            'activeMinutes': num(r[6]), 'totalMinutes': num(r[7]),
                            'difficulty': int(num(r[8], 0) or 0),
                            'aheadOfTime': r[9] if r[9] not in ('—', '-', '') else None,
                            'potsUsed': int(num(r[10], 1) or 1),
                            'equipmentRequired': [x.strip() for x in r[11].split('+') if x.strip() and x.strip() != '—'],
                            'note': split_note(r[17])[0],
                            'devNote': split_note(r[17])[1],
                        }],
                    }
                    recipes[r[0]] = rec
                    order.append(r[0])

            elif len(h) > 1 and h[1] == '档位':                # 变体表
                for lineno, r in t['rows']:
                    if len(r) != len(h) or r[0] not in recipes:
                        if len(r) == len(h) and r[0] not in recipes:
                            warnings.append('%s 变体 %s 在主表里不存在' % (base, r[0]))
                        continue
                    recipes[r[0]]['variants'].append({
                        'prepLevel': r[1],
                        'ingredients': parse_items(r[2]),
                        'seasonings': parse_items(r[9]),
                        'activeMinutes': num(r[3]), 'totalMinutes': num(r[4]),
                        'difficulty': int(num(r[5], 0) or 0),
                        'aheadOfTime': r[6] if r[6] not in ('—', '-', '') else None,
                        'potsUsed': int(num(r[7], 1) or 1),
                        'equipmentRequired': [x.strip() for x in r[8].split('+') if x.strip() and x.strip() != '—'],
                        'note': split_note(r[10])[0],
                        'devNote': split_note(r[10])[1],
                    })

    # 悬空引用自查 —— 生成阶段就该发现,别留到运行时
    for rid in order:
        for v in recipes[rid]['variants']:
            for it in v['ingredients'] + v['seasonings']:
                for i in it['ids']:
                    if i != '?' and i not in known_ids:
                        warnings.append('%s 悬空 id %s' % (rid, i))
    return [recipes[i] for i in order]


# ------------------------------------------------------------ 包装

def build_packages():
    rows = []
    for t in parse_tables(os.path.join(ROOT, 'data', 'packages.md')):
        h = t['header']
        if not h or h[0] != 'ID' or '净含量' not in h:
            continue
        for lineno, r in t['rows']:
            if len(r) != len(h) or not re.match(r'^PK-\d+$', r[0]):
                continue
            rows.append({
                'id': r[0],
                'ingredientId': cell(r, h, 'ingredientId'),
                'name': cell(r, h, '商品名'),
                'netWeight': num(cell(r, h, '净含量')),
                'unit': cell(r, h, '单位') or 'g',
                'sellMode': cell(r, h, '售卖方式'),
                'price': num(cell(r, h, '参考价')),
                'confidence': cell(r, h, '可信度') or 'C',
                'vendor': cell(r, h, '渠道') or None,
                'note': cell(r, h, '备注'),
                'userEdited': False,        # ← 用户就地改过就置 true,不再被重新生成覆盖
            })
    return rows


# ------------------------------------------------------------

def main():
    print('生成 app/data/ ...')
    ings = build_ingredients()
    known = {i['id'] for i in ings}
    recs = build_recipes(known)
    pkgs = build_packages()

    # 计件项:qty 有值但 grams 没有。字典给了单位换算的就**换算出来**。
    #
    # ⚠️ 这一步早先只做了「报告缺哪些换算」,没做「把有的换算应用上」。
    #    后果是 178 个食材项 grams=null,而营养核算和采购清单都按 grams 走 ——
    #    「鸡蛋 2个」于是贡献 0 kcal、0 蛋白,采购清单里也不会出现鸡蛋。
    #    菜谱写着放两个蛋,系统当它不存在。
    #
    #    换算不是猜:字典里 egg.unitConv = {个: 50} 是查过的数据。
    #    但仍然标 gramsFrom='unitConv',和原文直接写克重的区分开 ——
    #    以后要核对精度时得分得清哪些是抄的、哪些是算的。
    conv = {}
    for i in ings:
        if i.get('unitConv'):
            conv[i['id']] = i['unitConv']

    applied = 0
    for r in recs:
        for v in r['variants']:
            for it in v['ingredients'] + v['seasonings']:
                if it['grams'] is not None or it['qty'] is None:
                    continue
                u = it['unit']
                if not u:
                    continue
                table = conv.get(it['ids'][0], {})
                if table.get(u):
                    it['grams'] = round(it['qty'] * table[u], 1)
                    it['gramsFrom'] = 'unitConv'
                    applied += 1
    if applied:
        print('\n按字典的单位换算补出 %d 处克重(标 gramsFrom=unitConv,和原文写的克重分开)'
              % applied)


    emit('ingredients.js', 'INGREDIENTS', ings, '食材字典(含预制成品)')
    emit('recipes.js', 'RECIPES', recs, '菜谱库(变体已合并进 variants)')
    emit('packages.js', 'PACKAGES', pkgs, '包装规格默认值 —— 用户可就地编辑')

    nvar = sum(len(r['variants']) for r in recs)
    print('\n菜谱 %d 道 · variants %d 个(含 scratch 基础档)· 食材 %d 条 · 包装 %d 条'
          % (len(recs), nvar, len(ings), len(pkgs)))

    need = {}
    for r in recs:
        for v in r['variants']:
            for it in v['ingredients'] + v['seasonings']:
                u = it['unit']
                if not u or u in ('g', 'ml') or it['grams'] is not None:
                    continue
                iid = it['ids'][0]
                if conv.get(iid, {}).get(u):
                    continue            # 字典给了换算,能算
                need.setdefault(iid, [u, 0])[1] += 1
    if need:
        print('\n📌 %d 个食材按件计量、字典也没给单位换算 —— 求解器算不出采购量:' % len(need))
        for iid, (u, n) in sorted(need.items(), key=lambda x: -x[1][1]):
            ing = next((i for i in ings if i['id'] == iid), None)
            why = ''
            if ing and ing.get('note'):
                m = re.search(r'(单位换算[^。;]*)', ing['note'])
                if m:
                    why = '  ← ' + m.group(1)[:40]
            print('   %-26s %s × %d 处%s' % (iid, u, n, why))
    else:
        print('\n所有按件计量的食材都有单位换算,求解器可以算采购量。')

    dangling = [w for w in warnings if '悬空' in w]
    if warnings:
        print('\n⚠️  %d 条告警(悬空 %d):' % (len(warnings), len(dangling)))
        for w in warnings[:25]:
            print('   ' + w)
        if len(warnings) > 25:
            print('   ...还有 %d 条' % (len(warnings) - 25))
    else:
        print('\n无告警。')
    return 0


if __name__ == '__main__':
    sys.exit(main())
