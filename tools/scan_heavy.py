# 找出适合补 prepLevel variants 的费工菜:难度>=4 或 活跃分钟>=40
import re, glob, os, sys

os.chdir(r"C:\Users\weideng\MealPlanner\data\recipes")
PRE = {'01': 'JC', '02': 'CX', '03': 'YZ', '04': 'BF', '05': 'XS', '06': 'RH'}
PH = '\x00'


def cols(line):
    # 先把转义的 \| 换成占位符,再按裸 | 切,最后还原
    s = line.replace('\\|', PH)
    return [c.strip().replace(PH, '\\|') for c in s.split('|')]


total = 0
for k in sorted(PRE):
    f = glob.glob(k + '-*.md')[0]
    hits = []
    n = 0
    for ln in open(f, encoding='utf-8'):
        c = cols(ln)
        if len(c) < 19:
            continue
        if not re.match('^' + PRE[k] + r'-\d{3}$', c[1]):
            continue
        n += 1
        try:
            act, dif = int(c[7]), int(c[9])
        except ValueError:
            continue
        if dif >= 4 or act >= 40:
            hits.append((c[1], c[2], dif, act, int(c[8]) if c[8].isdigit() else -1))
    total += len(hits)
    print('%s  %s  %d/%d 道命中' % (k, f, len(hits), n))
    for h in hits:
        print('     %s %-16s 难%d 活%d' % (h[0], h[1], h[2], h[3]))
print('\n合计命中 %d 道' % total)
