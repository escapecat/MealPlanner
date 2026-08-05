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

  var el, tab = 'fridge', q = '', adding = false, addDraft = null,
      ingQ = '';

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

    // ⚠️ 「扔了」写进 wasteLog,那是诊断统计唯一的真实数据源。
    //    所以必须另给一个「记错了」—— 否则用户拿「扔了」当通用删除键,
    //    系统就会以为他真扔了食物,「什么东西总是剩」的结论跟着变成垃圾。
    row.appendChild(act('扔了', function () {
      var def = Math.round(it.amount);
      var v = prompt('扔了多少 ' + (it.unit || 'g') + '?(只扔了一部分就改小)\n' +
                     '记下来才能看出什么东西总是剩。', def);
      if (v == null) return;
      var n = parseFloat(v);
      if (isNaN(n) || n <= 0) return;
      logWaste(it, Math.min(n, it.amount));
      if (n >= it.amount) removeItem(it.id);
      else setAmount(it.id, it.amount - n);
      render();
    }, true));
    row.appendChild(act('记错了', function () {
      if (!confirm('直接删掉这条,不算浪费也不算吃掉?')) return;
      removeItem(it.id);
      render();
    }));
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

    // 用 Search 而不是自己 filter + slice(0,8) ——
    // 那样是按字典文件的书写顺序取前 8 个,搜「鸡」时鸡蛋排第 9 被切掉了。
    var r = Search.find(ingQ, Search.FRESH, 12);

    if (!r.total) {
      host.appendChild(h('div', { class: 'hint' }, ['冰箱这边没有「' + ingQ + '」']));
      var other = Search.find(ingQ, Search.STAPLE, 4);
      if (other.total) {
        host.appendChild(h('div', { class: 'note' }, [
          '不过调料柜里有 ' + other.total + ' 个匹配(' +
          other.hits.map(function (i) { return i.name; }).join(' · ') +
          ')—— 这一栏只管生鲜,调料在「调料柜」那边。',
        ]));
      }
      return;
    }

    host.appendChild(h('div', { class: 'chips' }, r.hits.map(function (i) {
      // 命中的是别名就标出来,否则「搜豆出来西洋菜」看着像坏了
      var al = Search.matchedAlias(i, ingQ);
      return h('button', {
        type: 'button', 'aria-pressed': String(addDraft.ingredientId === i.id),
        onclick: function () { addDraft.ingredientId = i.id; render(); },
      }, [i.name + (al ? '(' + al + ')' : '')]);
    })));
    if (r.total > r.hits.length) {
      host.appendChild(h('div', { class: 'hint', style: 'margin-top:4px' },
        ['还有 ' + (r.total - r.hits.length) + ' 个,搜得再具体点']));
    }
  }

  // ---------------- 调料柜 ----------------

  function fmtDate(iso) {
    return iso ? iso.slice(5, 7) + '/' + iso.slice(8, 10) : null;
  }

  /** 一行小字讲清楚:什么时候买的、开没开封、还能放多久 */
  function ageText(entry) {
    var n = now();
    if (entry.openedAt) {
      var d = Pantry.openedDaysLeft(entry, n);
      if (d == null) return { text: fmtDate(entry.openedAt) + ' 开封', level: 'ok' };
      return {
        text: fmtDate(entry.openedAt) + ' 开封 · ' +
              (d < 0 ? '超期 ' + (-d) + ' 天' : '还能放 ' + d + ' 天'),
        level: d < 0 ? 'bad' : (d < 14 ? 'warn' : 'ok'),
      };
    }
    if (entry.addedAt) {
      var u = Pantry.unopenedDaysLeft(entry, n);
      var since = Math.round((Date.parse(n) - Date.parse(entry.addedAt)) / 864e5);
      return {
        text: fmtDate(entry.addedAt) + ' 买 · ' +
              (since <= 0 ? '今天' : since + ' 天前') + ' · 未开封' +
              (u != null && u < 90 ? ' · 保质期剩 ' + u + ' 天' : ''),
        level: (u != null && u < 0) ? 'bad' : (u != null && u < 30 ? 'warn' : 'ok'),
      };
    }
    return { text: '没记买入时间 —— 点 ··· 补上', level: 'dim' };
  }

  /** 密集单行。「我有什么、什么时候买的」要一眼扫完,一样一张卡片是扫不动的。 */
  function ownedRow(ing, catLabel) {
    var entry = Pantry.stapleEntry(ing.id);
    if (!entry) return h('span', {});
    var track = Pantry.worthTrackingOpened(ing);
    var a = ageText(entry);
    var color = { bad: 'var(--danger)', warn: 'var(--warn)', dim: 'var(--text-dim)' }[a.level]
                || 'var(--text-dim)';

    var row = h('div', {
      style: 'display:flex;gap:8px;align-items:center;padding:7px 0;' +
             'border-bottom:1px solid var(--border)',
    });
    row.appendChild(h('div', { style: 'flex:1;min-width:0' }, [
      h('div', {}, [
        ing.name,
        catLabel ? h('span', { class: 'hint', style: 'margin-left:8px' }, [catLabel])
                 : h('span', {}),
      ]),
      h('div', { style: 'font-size:12px;color:' + color }, [a.text]),
    ]));
    if (track && !entry.openedAt) {
      row.appendChild(h('button', {
        class: 'btn ghost', style: 'width:auto;padding:4px 9px;font-size:12px;flex:0 0 auto',
        onclick: function () { Pantry.setOpened(ing.id, now()); render(); },
      }, ['开封了']));
    }
    row.appendChild(h('button', {
      class: 'btn ghost', style: 'width:auto;padding:4px 8px;font-size:12px;flex:0 0 auto',
      onclick: function () { editStaple(ing, entry); },
    }, ['···']));
    return row;
  }

  function editStaple(ing, entry) {
    var lines = [
      ing.name,
      '1 = 改买入日期',
      entry.openedAt ? '2 = 改开封日期' : '2 = 标记为已开封',
      '3 = 用完了(正常吃完)',
      '4 = 记错了 / 其实没有(直接删掉)',
      '',
      '输入数字:',
    ];
    var pick = prompt(lines.join('\n'));
    if (!pick) return;
    pick = pick.trim();
    if (pick === '1') {
      var d = prompt('买入日期(YYYY-MM-DD),留空表示不记得',
                     entry.addedAt ? entry.addedAt.slice(0, 10) : '');
      if (d === null) return;
      Pantry.setBought(ing.id, d ? new Date(d).toISOString() : null);
    } else if (pick === '2') {
      var d2 = prompt('开封日期(YYYY-MM-DD),留空表示还没开封',
                      entry.openedAt ? entry.openedAt.slice(0, 10)
                                     : new Date().toISOString().slice(0, 10));
      if (d2 === null) return;
      Pantry.setOpened(ing.id, d2 ? new Date(d2).toISOString() : null);
    } else if (pick === '3' || pick === '4') {
      // 调料是二元的(有/没有),两种情况都是从柜子里去掉。
      // 但分开问是有意义的:以后要统计「多久用完一瓶」时,得分得清
      // 「用完了」和「压根没有过」。
      Pantry.toggleStaple(ing.id);
    } else return;
    render();
  }

  /** 全库浏览/搜索时用的勾选行 */
  function pickRow(ing) {
    var has = Pantry.hasStaple(ing.id);
    var row = h('div', {
      style: 'display:flex;gap:10px;align-items:center;padding:7px 0;' +
             'border-bottom:1px solid var(--border)',
    });
    row.appendChild(h('button', {
      type: 'button',
      style: 'border:0;background:none;font-size:18px;cursor:pointer;padding:0;flex:0 0 auto',
      onclick: function () { Pantry.toggleStaple(ing.id); render(); },
    }, [has ? '☑' : '☐']));
    var al = q ? Search.matchedAlias(ing, q) : null;
    row.appendChild(h('div', { style: 'flex:1' + (has ? '' : ';color:var(--text-dim)') }, [
      h('div', {}, [ing.name + (al ? '(' + al + ')' : '')]),
      h('div', { class: 'hint' }, [
        (ing.packaging || '规格未填') + (ing.inevitableSurplus ? ' · 单人多半吃不完' : ''),
      ]),
    ]));
    return row;
  }

  function searchBox() {
    return h('div', { class: 'row' }, [
      h('input', {
        type: 'text', placeholder: '搜调料…… 例:豆瓣 / 咖喱 / 鱼露', value: q,
        oninput: function (e) { q = e.target.value.trim(); render(); },
      }),
    ]);
  }

  function renderStaples(w) {
    Pantry.ensureInit();
    var mine = Pantry.staples() || [];

    // ⚠️ 这一页只回答一个问题:**我有什么、还能放多久**。
    //
    //    早先还挂了「没有的 370 种」按类别折叠 —— 那是 15 个折叠块的墙。
    //    但你根本不需要浏览没有的调料:加一样只发生在「刚买了」或
    //    「生成计划时 app 问你」这两种时候,两种都不用翻列表。
    //    所以「没有的」退化成一个搜索框。
    //
    //    11 样东西也不该切成 6 个类别小标题 —— 类别做成行内小字就够了。

    var alerts = Pantry.stapleAlerts(now());
    alerts.forEach(function (a) {
      w.appendChild(h('div', { class: 'note warn' }, [
        a.name + ' —— ' + (a.expired ? '开封超期 ' + (-a.daysLeft) + ' 天' : '还有 ' + a.daysLeft + ' 天') +
        (a.usedInDishes ? ',库里 ' + a.usedInDishes + ' 道菜用它,下次可以优先排' : ''),
      ]));
    });

    w.appendChild(h('div', { class: 'row' }, [
      h('input', {
        type: 'text', placeholder: '买了新调料?搜一下加进来', value: q,
        oninput: function (e) { q = e.target.value.trim(); render(); },
      }),
    ]));

    if (q) {
      var r = Search.find(q, Search.STAPLE, 20);
      var c = h('div', { class: 'card', style: 'padding:2px 14px' });
      if (!r.total) {
        c.appendChild(h('div', { class: 'hint', style: 'padding:10px 0' },
          ['调料柜里没有「' + q + '」']));
        var other = Search.find(q, Search.FRESH, 4);
        if (other.total) {
          c.appendChild(h('div', { class: 'hint', style: 'padding-bottom:10px' }, [
            '冰箱那边有:' + other.hits.map(function (i) { return i.name; }).join(' · '),
          ]));
        }
      } else {
        r.hits.forEach(function (i) { c.appendChild(pickRow(i)); });
      }
      w.appendChild(c);
      if (r.total > r.hits.length) {
        w.appendChild(h('div', { class: 'hint', style: 'text-align:center' },
          ['还有 ' + (r.total - r.hits.length) + ' 个,搜具体点']));
      }
      return;
    }

    if (!mine.length) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🧂']),
        h('div', {}, ['柜子是空的 —— 上面搜一下加进来']),
      ]));
      return;
    }

    // 一个平铺列表,按类别排序但不切标题
    var list = mine.map(function (e) {
      return INGREDIENTS.filter(function (x) { return x.id === e.id; })[0];
    }).filter(Boolean);
    list.sort(function (a, b) {
      if (a.category !== b.category) return (a.category || '').localeCompare(b.category || '', 'zh');
      return a.name.localeCompare(b.name, 'zh');
    });

    w.appendChild(h('div', { class: 'hint', style: 'margin-bottom:6px' }, [
      mine.length + ' 样。缺哪样会在生成计划时直接问你,不用先在这儿备齐。',
    ]));

    var card = h('div', { class: 'card', style: 'padding:2px 14px' });
    var lastCat = null;
    list.forEach(function (i) {
      card.appendChild(ownedRow(i, i.category !== lastCat ? i.category : null));
      lastCat = i.category;
    });
    w.appendChild(card);

    // 建议放最后、压成一行 —— 这是「顺便提一句」,不是页面主体
    var sug = Pantry.suggestUnlocks(3);
    if (sug.length) {
      w.appendChild(h('div', { class: 'hint', style: 'margin-top:14px' }, [
        '还没有的里面,加这几样能多做最多菜:',
      ]));
      w.appendChild(h('div', { class: 'chips' }, sug.map(function (s2) {
        return h('button', {
          type: 'button',
          onclick: function () { Pantry.toggleStaple(s2.id); render(); },
        }, ['+ ' + s2.name + ' ' + s2.dishes + '道']);
      })));
    }
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
