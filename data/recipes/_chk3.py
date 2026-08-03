import io, re, sys
sys.stdout.reconfigure(encoding="utf-8")
lines = io.open("05-西式.md", encoding="utf-8").read().split("\n")
end = next(i for i, l in enumerate(lines) if l.startswith("## 统计"))
rows = [l for l in lines[:end] if l.startswith("| XS-")]
print("recipe rows:", len(rows))
bad, dups, noid = [], [], []
ids_seen = []
for r in rows:
    cells = r.replace("\\|", "").split("|")[1:-1]
    ids_seen.append(cells[0].strip())
    if len(cells) != 18:
        bad.append((cells[0].strip(), len(cells)))
        continue
    g = lambda c: set(re.findall(r"\[([a-z_]+)\]", c))
    if g(cells[2]) & g(cells[13]):
        dups.append((cells[0].strip(), sorted(g(cells[2]) & g(cells[13]))))
    for col in (2, 13):
        for it in cells[col].split(" · "):
            it = it.strip()
            if it and it != "—" and not re.search(r"\[[a-z_]+\]|\[\?\]", it):
                noid.append((cells[0].strip(), it))
print("bad cols:", bad)
print("dup 食材/调料:", dups)
print("no id:", noid)
print("first/last:", ids_seen[0], ids_seen[-1], "unique:", len(set(ids_seen)))
print("或-groups in 食材/调料:", sum(r.count("\\|") for r in rows) - sum(1 for r in rows if "烤箱 \\|" in r or "空气炸锅 \\|" in r or "砂锅 \\|" in r or "汤锅 \\|" in r))
