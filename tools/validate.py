# -*- coding: utf-8 -*-
"""
数据层校验器。

写这个是因为前面三次数据检查都被临时正则骗了:
  1. 附录表的行被数进了主表(01 报 164 道,实际 121)
  2. `|` 语法检测匹配到了 markdown 的列分隔符(报 119 处,实际 0)
  3. 冲突扫描把「海盐」的后缀「盐」当成了「盐」,导致误并 sea_salt

根因都一样:**按行套正则,而不是按表解析**。
所以这里先把 markdown 切成一张张表,按表头签名分类,再在结构上做检查。

用法:  python tools/validate.py
"""
import re
import os
import sys
import glob
from collections import defaultdict

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RECIPES = os.path.join(ROOT, 'data', 'recipes')
INGREDIENTS = os.path.join(ROOT, 'data', 'ingredients')

# Windows 控制台默认 cp1252,不重设的话打印中文直接 UnicodeEncodeError 崩掉
for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding='utf-8')
    except AttributeError:
        pass

EXPECTED = {'01': ('JC', 121), '02': ('CX', 86), '03': ('YZ', 77),
            '04': ('BF', 78), '05': ('XS', 78), '06': ('RH', 95)}

PH = '\x00'
errors = []
warnings = []
notes = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


# ---------------------------------------------------------------- 表解析

def split_row(line):
    """把一行 markdown 表格切成单元格。转义的 \\| 不算分隔符。"""
    s = line.strip()
    s = s.replace('\\|', PH)
    if s.startswith('|'):
        s = s[1:]
    if s.endswith('|'):
        s = s[:-1]
    return [c.strip().replace(PH, '\\|') for c in s.split('|')]


def is_sep(line):
    return re.match(r'^\s*\|[\s:|-]+\|\s*$', line) is not None


def parse_tables(path):
    """返回 [{'header':[...], 'rows':[(lineno, [cells]), ...], 'line':n}]"""
    lines = open(path, encoding='utf-8').read().splitlines()
    tables, i = [], 0
    while i < len(lines):
        if lines[i].strip().startswith('|') and i + 1 < len(lines) and is_sep(lines[i + 1]):
            header = split_row(lines[i])
            start = i + 1
            i += 2
            rows = []
            while i < len(lines) and lines[i].strip().startswith('|'):
                if not is_sep(lines[i]):
                    rows.append((i + 1, split_row(lines[i])))
                i += 1
            tables.append({'header': header, 'rows': rows, 'line': start})
        else:
            i += 1
    return tables


# ---------------------------------------------------------------- 字典

def load_dicts():
    """id -> [(file, 名称, 别名)]  —— 用 list 是为了抓同 id 重复建条"""
    ids = defaultdict(list)
    for p in sorted(glob.glob(os.path.join(INGREDIENTS, '0*.md'))):
        base = os.path.basename(p)
        for t in parse_tables(p):
            h = t['header']
            if not h or h[0].lower() != 'id' or len(h) < 10:
                continue          # 附录表、统计表,不是字典主表
            for lineno, r in t['rows']:
                if len(r) != len(h):
                    err('%s:%d 字典行 %d 列,表头 %d 列' % (base, lineno, len(r), len(h)))
                    continue
                iid = r[0]
                if not re.match(r'^[a-z][a-z0-9_]*$', iid):
                    continue      # 分组小标题之类
                ids[iid].append((base, r[1], r[2] if len(r) > 2 else ''))
    return ids


# ---------------------------------------------------------------- 食材单元格

# 名称[id] 克数 角色    名称部分不许含 [ ] ( ) 空格
ITEM = re.compile(r'([^\[\]()\s·]+)\[([a-z0-9_?]+)\]')

# 菜名里出现这些字,基本可以断定该有主食。「粉」排除掉调味用法(淀粉/米粉蒸肉),
# 所以只取成词的写法;宁可漏报也别误报 —— 前面被正则骗过三次了。
STAPLE_NAME = re.compile(
    # 光杆「饭」是 06 补的 —— 原来只收组合词,漏了「咖喱牛肉饭」。
    # 但「电饭煲」里也有个饭,「汉堡排」是肉饼不是汉堡 —— 两个负向断言堵掉这两类误报。
    r'(?<!电)饭|丼|粥'
    r'|炒面|拌面|汤面|捞面|拉面|烩面|刀削面|手擀面|意面|冷面|凉面|米线|河粉|米粉|粿条|炒粉'
    r'|三明治|汉堡(?!排)|吐司|卷饼|夹馍|馅饼|烧饼|火烧|馒头|花卷|包子|饺|馄饨|抄手|烧麦|烧卖'
)

# 菜名以这些收尾 = 明说自己只是浇头/配料,本来就不含主食
TOPPING_SUFFIX = re.compile(r'(菜码|浇头|臊子|卤|馅|酱)$')


def parse_cell(cell):
    """返回 [(名称, id)],以及名称非法的告警在外面做"""
    if not cell or cell in ('—', '-', ''):
        return []
    return ITEM.findall(cell)


def count_orphan_ids(cell):
    """ITEM 正则要求名称位干净,名称里有括号时整项会被**静默丢弃**。
    02 就是这么让 `外婆菜(袋装)[waipocai]` 躲过两列重复检查的 —— 静默丢弃比报错危险,
    所以单独数一遍 [id] 的总数,对不上就说明有项没被解析出来。"""
    return len(re.findall(r'\[[a-z0-9_?]+\]', cell))


def check_name_syntax(cell):
    """找出 名称[id] 里名称部分含括号/空格的写法"""
    bad = []
    for m in re.finditer(r'\[([a-z0-9_?]+)\]', cell):
        left = cell[:m.start()]
        # 往左取到最近的分隔符 ·  或 或 开头
        seg = re.split(r'·| 或 ', left)[-1].strip()
        if re.search(r'[()（）]', seg) or ' ' in seg:
            bad.append(seg + '[' + m.group(1) + ']')
    return bad


# 克数位:180g / 2个 / 适量 / 共250g / 8只 ……  括号开头说明尾注挤进了克数位
QTY_BAD = re.compile(r'^[（(]')


def check_qty_syntax(cell):
    """括号写在 [id] 后面时,克数位会被解析成「(抹面)」—— 名称干净但一样是坏数据"""
    bad = []
    for m in re.finditer(r'\[([a-z0-9_?]+)\]\s*([^·]*)', cell):
        if QTY_BAD.match(m.group(2).strip()):
            bad.append('[%s]%s' % (m.group(1), m.group(2).strip()[:16]))
    return bad


# ---------------------------------------------------------------- 主检查

def main():
    dict_ids = load_dicts()
    alias_gap = defaultdict(list)

    # 同 id 在多处建条
    dup = {k: v for k, v in dict_ids.items() if len(v) > 1}
    if dup:
        notes.append('字典内同 id 重复建条:%d 个' % len(dup))
        for k in sorted(dup)[:40]:
            notes.append('    %-22s %s' % (k, ' / '.join('%s「%s」' % (f, n) for f, n, _ in dup[k])))

    known = set(dict_ids)
    all_recipe_ids = {}
    grand = 0

    for key in sorted(EXPECTED):
        prefix, want = EXPECTED[key]
        matches = glob.glob(os.path.join(RECIPES, key + '-*.md'))
        if not matches:
            err('找不到 %s-*.md' % key)
            continue
        path = matches[0]
        base = os.path.basename(path)
        tables = parse_tables(path)

        main_t = [t for t in tables if t['header'] and t['header'][0] == 'ID'
                  and len(t['header']) == 18]
        var_t = [t for t in tables if t['header'] and t['header'][0] == 'ID'
                 and len(t['header']) > 1 and t['header'][1] == '档位']

        if not main_t:
            err('%s 找不到 18 列主表' % base)
            continue

        rows = [r for t in main_t for r in t['rows']]
        seen = set()
        for lineno, r in rows:
            if len(r) != 18:
                err('%s:%d 主表 %d 列(应 18)—— 多半是单元格里写了裸 |' % (base, lineno, len(r)))
                continue
            rid = r[0]
            if not re.match('^' + prefix + r'-\d{3}$', rid):
                err('%s:%d ID 格式错:%s' % (base, lineno, rid))
                continue
            if rid in seen:
                err('%s:%d ID 重复:%s' % (base, lineno, rid))
            seen.add(rid)

            food, seasoning = r[2], r[13]
            fids = parse_cell(food)
            sids = parse_cell(seasoning)

            # 解析出的项数对不上 [id] 总数 = 有项被静默丢弃(名称位有括号)
            for cell, got, col in ((food, fids, '食材'), (seasoning, sids, '调料')):
                n_ids = count_orphan_ids(cell)
                if n_ids != len(got):
                    err('%s:%d %s %s列有 %d 项没被解析出来(名称位非法,会静默漏检)'
                        % (base, lineno, rid, col, n_ids - len(got)))

            for nm, iid in fids + sids:
                if iid == '?':
                    continue
                if iid not in known:
                    err('%s:%d %s 悬空 id:%s[%s]' % (base, lineno, rid, nm, iid))
                else:
                    # 菜谱里的显示名必须能在字典的 名称/别名 里找到,否则「名称→id」反查会失配。
                    # 抽查「圆白菜/卷心菜/包菜」这种三组样本不如全库扫一遍。
                    names = set()
                    for _f, _n, _a in dict_ids[iid]:
                        names.add(_n)
                        names.update(x.strip() for x in re.split(r'[/·、]', _a) if x.strip())
                    if nm not in names:
                        alias_gap[(iid, nm)].append('%s %s' % (base[:2], rid))

            # 两列重复 —— 采购量翻倍的那个 bug。`?` 是未匹配占位符,不算重复
            both = ({i for _, i in fids} & {i for _, i in sids}) - {'?'}
            for i in both:
                err('%s:%d %s 同一 id 在食材和调料两列都出现:%s(采购量会翻倍)' % (base, lineno, rid, i))

            for cell, col in ((food, '食材'), (seasoning, '调料')):
                for b in check_name_syntax(cell):
                    warn('%s:%d %s %s列名称含括号或空格:%s' % (base, lineno, rid, col, b))
                for b in check_qty_syntax(cell):
                    warn('%s:%d %s %s列括号挤进克数位:%s' % (base, lineno, rid, col, b))

            # 菜名说明有主食,食材列却没有 主食 角色 —— 06 发现天丼没米饭,这类靠眼睛看不出来
            if (STAPLE_NAME.search(r[1]) and '主食' not in food
                    and not TOPPING_SUFFIX.search(r[1])):
                warn('%s:%d %s「%s」菜名含主食字样,食材列却没有「主食」角色' % (base, lineno, rid, r[1]))

        all_recipe_ids[prefix] = seen
        nvar = 0
        for t in var_t:
            for lineno, r in t['rows']:
                if len(r) != len(t['header']):
                    err('%s:%d 变体表 %d 列(表头 %d 列)' % (base, lineno, len(r), len(t['header'])))
                    continue
                nvar += 1
                if r[0] not in seen:
                    err('%s:%d 变体 ID %s 在主表里不存在' % (base, lineno, r[0]))
                if len(r) > 1 and r[1] not in ('assembled', 'readymade', 'scratch'):
                    err('%s:%d 档位取值非法:%s' % (base, lineno, r[1]))
                if len(r) > 1 and r[1] == 'scratch':
                    warn('%s:%d %s 变体表里写了 scratch —— 主表那行就是 scratch,不该重复' % (base, lineno, r[0]))
                for nm, iid in parse_cell(r[2] if len(r) > 2 else ''):
                    if iid == '?':
                        continue
                    if iid not in known:
                        err('%s:%d 变体 %s 悬空 id:%s[%s]' % (base, lineno, r[0], nm, iid))
                    else:
                        # 变体表也要做别名反查 —— 上一轮漏了,结果两处失配藏在这张表里没被发现
                        names = set()
                        for _f, _n, _a in dict_ids[iid]:
                            names.add(_n)
                            names.update(x.strip() for x in re.split(r'[/·、]', _a) if x.strip())
                        if nm not in names:
                            alias_gap[(iid, nm)].append('%s %s变体' % (base[:2], r[0]))

        grand += len(seen)
        flag = 'OK ' if len(seen) == want else '✗  '
        print('%s%-22s 主表 %3d/%-3d 道   变体 %2d 条' % (flag, base, len(seen), want, nvar))
        if len(seen) != want:
            err('%s 道数 %d,应为 %d —— 少了就是丢数据' % (base, len(seen), want))

    print('-' * 56)
    print('合计 %d 道(应 535)· 字典 %d 个 id' % (grand, len(known)))

    if alias_gap:
        notes.append('菜谱显示名不在字典别名列里:%d 组 —— 「名称→id」反查会失配' % len(alias_gap))
        for (iid, nm), where in sorted(alias_gap.items())[:40]:
            notes.append('    %-22s 用了「%s」  %s' % (iid, nm, ' '.join(where[:4])))

    for label, items in (('错误', errors), ('告警', warnings), ('提示', notes)):
        if items:
            print('\n=== %s %d 条' % (label, len(items)))
            for m in items[:60]:
                print('  ' + m)
            if len(items) > 60:
                print('  ...还有 %d 条' % (len(items) - 60))

    if not errors:
        print('\n没有错误。')
    return 1 if errors else 0


if __name__ == '__main__':
    sys.exit(main())
