// 「库存」页 —— 这是整个应用的护城河页(DESIGN 第一节:库存模块 > 求解器 > 菜谱库)。
//
// 三件事必须做到:
//   1. **一眼看出该先吃什么** —— 按紧迫度排序并着色,不是按入库顺序平铺
//   2. **能记「扔了」** —— 没有这个动作,系统永远不知道你实际浪费了什么,
//      所有「常剩食材」诊断就都是推测。这是唯一必须手动的一步,因为没法自动观测
//   3. **有手动逃生口** —— 零录入是目标不是教条。你在楼下超市顺手买的东西、
//      吃掉一半的东西,得能记上,否则库存和现实脱节一次就再也不准了
//
// 调料柜和冰箱交互不同,因为两种库存性质不同:调料是有/没有,生鲜是还剩多少。

var PantryUI = (function () {

  var el, tab = 'fridge', q = '', openCat = null, adding = false, addDraft = null, ingQ = '';

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function now() { return new Date().toISOString(); }
  function items() { return Pantry.items(); }
  function saveItems(v) { Store.set('pantryItems', v); }

  // ---------------- 冰箱 ----------------

  function daysLeft(it) {
    if (!it.expiresAt) return null;
    return Math.round((Date.parse(it.expiresAt) - Date.parse(now())) / 864e5);
  }

  function urgencyClass(d) {
    if (d == null) return '';
    if (d < 0) return 'danger';
    if (d <= 2) return 'warn';
    return '';
  }

  /** 记一笔浪费 —— 这是诊断统计唯一的真实数据源 */
  function logWaste(it, grams) {
    var log = Store.get('wasteLog', []) || [];
    log.push({ at: now(), ingredientId: it.ingredientId, grams: grams,
               addedAt: it.addedAt, expiresAt: it.expiresAt });
    Store.set('wasteLog', log);
  }

  function removeItem(id) {
    saveItems(items().filter(function (x) { return x.id !== id; }));
  }

  function setAmount(id, grams) {
    var list = items();
    var it = list.filter(function (x) { return x.id === id; })[0];
    if (!it) return;
    if (grams <= 0) { removeItem(id); return; }
    it.amount = grams;
    saveItems(list);
  }

  function itemCard(it) {
    var ing = Catalog.ingredient(it.ingredientId);
    var d = daysLeft(it);
    var cls = urgencyClass(d);
    var box = h('div', { class: 'card', style: 'padding:12px' });

    var head = h('div', { style: 'display:flex;align-items:baseline;gap:8px;flex-wrap:wrap' });
    head.appendChild(h('strong', {}, [ing ? ing.name : it.ingredientId]));
    head.appendChild(h('span', { style: 'font-size:15px' },
      [Math.round(it.amount) + (it.unit || 'g')]));
    if (d != null) {
      head.appendChild(h('span', {
        class: 'conf conf-' + (cls === 'danger' ? 'U' : cls === 'warn' ? 'C' : 'B'),
      }, [d < 0 ? '过期 ' + (-d) + ' 天' : d === 0 ? '今天到期' : d + ' 天']));
    }
    box.appendChild(head);
    box.appendChild(h('div', { class: 'hint' }, [
      ({ fridge: '冷藏', freezer: '冷冻', pantry: '常温' }[it.location] || it.location) +
      ' · 买于 ' + it.addedAt.slice(5, 10) +
      (it.openedAt ? ' · 已开封' : ''),
    ]));

    var row = h('div', { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' });
    function act(label, fn, danger) {
      return h('button', {
        class: 'btn ghost',
        style: 'width:auto;padding:6px 12px;font-size:13px' +
               (danger ? ';color:var(--danger);border-color:var(--danger)' : ''),
        onclick: fn,
      }, [label]);
    }
    row.appendChild(act('改数量', function () {
      var v = prompt('现在还剩多少 ' + (it.unit || 'g') + '?', Math.round(it.amount));
      if (v == null) return;
      var n = parseFloat(v);
      if (!isNaN(n)) { setAmount(it.id, n); render(); }
    }));
    row.appendChild(act('吃完了', function () { removeItem(it.id); render(); }));
    row.appendChild(act('扔了', function () {
      if (!confirm('记一笔浪费:' + (ing ? ing.name : '') + ' ' +
                   Math.round(it.amount) + (it.unit || 'g') + '?\n' +
                   '记下来才能看出「什么东西总是剩」。')) return;
      logWaste(it, it.amount);
      removeItem(it.id);
      render();
    }, true));
    box.appendChild(row);
    return box;
  }

  function renderFridge(w) {
    var its = items().slice();

    if (adding) { w.appendChild(addForm()); return; }

    w.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-bottom:12px',
      onclick: function () {
        adding = true;
        addDraft = { ingredientId: null, amount: null, location: 'fridge' };
        ingQ = ''; render();
      },
    }, ['＋ 手动记一样(app 之外买的)']));

    if (!its.length) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧊']),
        h('div', { style: 'font-weight:600;margin-bottom:8px' }, ['冰箱是空的']),
      ]));
      w.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'hint' }, [
          '平时不用手动录 —— 采购清单勾「已买」并填实际克数就会自动进来,',
        ]),
        h('div', { class: 'hint' }, [
          '某顿点「完成」自动扣减。上面那个按钮是给「顺路买的」准备的逃生口。',
        ]),
      ]));
      return;
    }

    // 按紧迫度排序 —— 快烂的置顶。按入库顺序平铺等于让人自己找。
    its.sort(function (a, b) {
      var da = daysLeft(a), db2 = daysLeft(b);
      if (da == null && db2 == null) return 0;
      if (da == null) return 1;
      if (db2 == null) return -1;
      return da - db2;
    });

    var soon = its.filter(function (x) { var d = daysLeft(x); return d != null && d <= 2; });
    var total = its.reduce(function (s, x) { return s + x.amount; }, 0);
    w.appendChild(h('div', { class: soon.length ? 'note warn' : 'note' }, [
      its.length + ' 样 · 共 ' + (total / 1000).toFixed(1) + 'kg' +
      (soon.length ? ' · **' + soon.length + ' 样两天内到期**,下次生成会优先排掉' : ''),
    ]));

    var groups = [
      { key: 'urgent', label: '快到期', test: function (d) { return d != null && d <= 2; } },
      { key: 'soon', label: '一周内', test: function (d) { return d != null && d > 2 && d <= 7; } },
      { key: 'ok', label: '还早', test: function (d) { return d == null || d > 7; } },
    ];
    groups.forEach(function (g) {
      var rows = its.filter(function (x) { return g.test(daysLeft(x)); });
      if (!rows.length) return;
      w.appendChild(h('h2', {}, [g.label + ' · ' + rows.length]));
      rows.forEach(function (x) { w.appendChild(itemCard(x)); });
    });

    var wl = Store.get('wasteLog', []) || [];
    if (wl.length) {
      var g2 = wl.reduce(function (s, x) { return s + x.grams; }, 0);
      w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:16px' }, [
        '累计记了 ' + wl.length + ' 笔浪费,共 ' + (g2 / 1000).toFixed(1) + 'kg —— ' +
        '攒够几周就能看出「什么东西总是剩」',
      ]));
    }
  }

  function addForm() {
    var box = h('div', { class: 'card' });
    box.appendChild(h('div', { style: 'font-weight:600;margin-bottom:10px' }, ['手动记一样']));

    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['是什么']),
      h('input', {
        type: 'text', placeholder: '搜食材…… 例:鸡蛋 / 上海青', value: ingQ,
        oninput: function (e) { ingQ = e.target.value.trim(); renderHits(); },
      }),
      h('div', { id: 'hits', style: 'margin-top:6px' }),
    ]));
    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['多少克']),
      h('input', {
        type: 'number', inputmode: 'decimal', placeholder: '300',
        onchange: function (e) {
          var v = parseFloat(e.target.value);
          addDraft.amount = isNaN(v) ? null : v;
        },
      }),
    ]));
    box.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['放哪儿']),
      h('div', { class: 'seg' }, [['fridge', '冷藏'], ['freezer', '冷冻'], ['pantry', '常温']]
        .map(function (o) {
          return h('button', {
            type: 'button', 'aria-pressed': String(addDraft.location === o[0]),
            onclick: function () { addDraft.location = o[0]; render(); },
          }, [o[1]]);
        })),
    ]));
    box.appendChild(h('button', {
      class: 'btn',
      onclick: function () {
        if (!addDraft.ingredientId) { alert('先选是什么'); return; }
        if (!addDraft.amount) { alert('填个克数'); return; }
        Pantry.addFromPackage({ id: addDraft.ingredientId, ingredientId: addDraft.ingredientId,
                                netWeight: addDraft.amount, unit: 'g' },
                              now(), addDraft.location);
        var list = items();
        list[list.length - 1].source = 'manual';
        saveItems(list);
        adding = false; render();
      },
    }, ['记下']));
    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { adding = false; render(); },
    }, ['取消']));
    return box;
  }

  function renderHits() {
    var host = el.querySelector('#hits');
    if (!host) return;
    host.innerHTML = '';
    if (!ingQ) return;
    var hits = INGREDIENTS.filter(function (i) {
      if (i.tier === 'staple') return false;        // 调料走调料柜
      var hay = i.name + ' ' + i.id + ' ' + (i.aliases || []).join(' ');
      return hay.toLowerCase().indexOf(ingQ.toLowerCase()) >= 0;
    }).slice(0, 8);
    host.appendChild(h('div', { class: 'chips' }, hits.map(function (i) {
      return h('button', {
        type: 'button', 'aria-pressed': String(addDraft.ingredientId === i.id),
        onclick: function () { addDraft.ingredientId = i.id; render(); },
      }, [i.name]);
    })));
  }

  // ---------------- 调料柜 ----------------

  function stapleRow(ing) {
    var has = Pantry.hasStaple(ing.id);
    var entry = Pantry.stapleEntry(ing.id);
    var track = Pantry.worthTrackingOpened(ing);
    var box = h('div', { style: 'padding:8px 0;border-bottom:1px solid var(--border)' });

    var head = h('div', { style: 'display:flex;align-items:center;gap:10px' });
    head.appendChild(h('button', {
      type: 'button',
      style: 'border:0;background:none;font-size:19px;cursor:pointer;padding:0;flex:0 0 auto',
      onclick: function () { Pantry.toggleStaple(ing.id); render(); },
    }, [has ? '☑' : '☐']));
    head.appendChild(h('div', { style: 'flex:1;min-width:0' + (has ? '' : ';color:var(--text-dim)') }, [
      h('div', {}, [ing.name]),
      h('div', { class: 'hint' }, [
        (ing.packaging || '规格未填') +
        (ing.inevitableSurplus ? ' · ⚠️ 单人多半吃不完' : ''),
      ]),
    ]));
    box.appendChild(head);

    if (has && track) {
      var opened = entry && entry.openedAt;
      var line = h('div', { style: 'margin-top:6px;margin-left:29px;display:flex;gap:6px;align-items:center;flex-wrap:wrap' });
      if (opened) {
        var dead = Date.parse(opened) + ing.openedShelfLifeDays * 864e5;
        var left = Math.round((dead - Date.parse(now())) / 864e5);
        line.appendChild(h('span', { class: 'conf conf-' + (left < 0 ? 'U' : left < 14 ? 'C' : 'B') },
          [left < 0 ? '开封已过期' : '开封后还剩 ' + left + ' 天']));
        line.appendChild(h('button', {
          class: 'btn ghost', style: 'width:auto;padding:3px 9px;font-size:12px',
          onclick: function () { Pantry.setOpened(ing.id, null); render(); },
        }, ['清除']));
      } else {
        line.appendChild(h('span', { class: 'hint' },
          ['开封后只能放 ' + ing.openedShelfLifeDays + ' 天']));
        line.appendChild(h('button', {
          class: 'btn ghost', style: 'width:auto;padding:3px 9px;font-size:12px',
          onclick: function () { Pantry.setOpened(ing.id, now()); render(); },
        }, ['今天开的']));
      }
      box.appendChild(line);
    }
    return box;
  }

  function renderStaples(w) {
    Pantry.ensureInit();

    var al = Pantry.stapleAlerts(now());
    if (al.length) {
      var ab = h('div', { class: 'card' });
      ab.appendChild(h('div', { style: 'font-weight:600;margin-bottom:6px' }, ['该处理的']));
      al.forEach(function (a) {
        ab.appendChild(h('div', { class: a.expired ? 'note warn' : 'note', style: 'margin-bottom:6px' }, [
          a.name + ' —— ' + (a.expired ? '开封超期 ' + (-a.daysLeft) + ' 天' : '还有 ' + a.daysLeft + ' 天') +
          (a.usedInDishes ? ',库里 ' + a.usedInDishes + ' 道菜用它' : ''),
        ]));
      });
      w.appendChild(ab);
    }

    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        type: 'text', placeholder: '搜调料…… 例:豆瓣 / 咖喱 / 鱼露', value: q,
        oninput: function (e) { q = e.target.value.trim(); render(); },
      }),
    ]));

    if (!q) {
      var sug = Pantry.suggestUnlocks(5);
      if (sug.length) {
        var sb = h('div', { class: 'card' });
        sb.appendChild(h('div', { style: 'font-weight:600;margin-bottom:6px' }, ['添这几样能多做最多菜']));
        sug.forEach(function (s2) {
          var r = h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' });
          r.appendChild(h('button', {
            class: 'btn ghost', style: 'width:auto;padding:5px 10px;font-size:13px;flex:0 0 auto',
            onclick: function () { Pantry.toggleStaple(s2.id); render(); },
          }, ['+ ' + s2.name]));
          r.appendChild(h('span', { class: 'hint', style: 'flex:1' }, [
            '解锁 ' + s2.dishes + ' 道' + (s2.inevitableSurplus ? ' · ⚠️ 最小规格吃不完' : ''),
          ]));
          sb.appendChild(r);
        });
        w.appendChild(sb);
      }
    }

    var pool = INGREDIENTS.filter(function (i) { return i.tier === 'staple'; });

    if (q) {
      var hits = pool.filter(function (i) {
        var hay = i.name + ' ' + i.id + ' ' + (i.aliases || []).join(' ');
        return hay.toLowerCase().indexOf(q.toLowerCase()) >= 0;
      });
      var c = h('div', { class: 'card' });
      if (!hits.length) c.appendChild(h('div', { class: 'hint' }, ['没找到「' + q + '」']));
      hits.slice(0, 40).forEach(function (i) { c.appendChild(stapleRow(i)); });
      w.appendChild(c);
      return;
    }

    // 按类别折叠 —— 382 条平铺没法看
    var byCat = {};
    pool.forEach(function (i) { (byCat[i.category] = byCat[i.category] || []).push(i); });
    var cats = Object.keys(byCat).sort(function (a, b) { return byCat[b].length - byCat[a].length; });

    var ownedCount = (Pantry.staples() || []).length;
    w.appendChild(h('div', { class: 'note' }, [
      '有 ' + ownedCount + ' 样 / 共 ' + pool.length + ' 种。**调料不进每周采购清单** —— ' +
      '只在没有、或开封快过期时提醒。',
    ]));

    cats.forEach(function (cat) {
      var list = byCat[cat];
      var mine = list.filter(function (i) { return Pantry.hasStaple(i.id); }).length;
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-bottom:6px;text-align:left',
        onclick: function () { openCat = (openCat === cat ? null : cat); render(); },
      }, [(openCat === cat ? '▾ ' : '▸ ') + cat + '   ' + mine + '/' + list.length]));
      if (openCat === cat) {
        var c2 = h('div', { class: 'card' });
        list.forEach(function (i) { c2.appendChild(stapleRow(i)); });
        w.appendChild(c2);
      }
    });
  }

  // ---------------- 页面 ----------------

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['库存']));

    w.appendChild(h('div', { class: 'seg', style: 'margin-bottom:14px' },
      [['fridge', '冰箱 ' + items().length], ['staples', '调料柜']].map(function (t) {
        return h('button', {
          type: 'button', 'aria-pressed': String(tab === t[0]),
          onclick: function () { tab = t[0]; q = ''; adding = false; render(); },
        }, [t[1]]);
      })));

    if (tab === 'staples') renderStaples(w); else renderFridge(w);
    el.appendChild(w);
    if (adding) renderHits();
  }

  function mount(node) { el = node; adding = false; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = PantryUI;
