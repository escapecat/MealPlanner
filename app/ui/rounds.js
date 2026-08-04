// 「本周」页 —— 一次做饭 = 一条记录。列表 + 右下角「+」新建。
//
// 这一层只做展示和事件绑定。默认值怎么来的问 Round.defaultsFrom,
// 约束怎么合并问 Round.effectiveConstraints。

var RoundsUI = (function () {

  var el, sheetOpen = false, draft = null, onOpenPkg = null;

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

  function rounds() { return Store.get('rounds', []) || []; }
  function saveRounds(rs) { Store.set('rounds', rs); }
  function config() { return Store.get('config', {}) || {}; }

  function seg(get, set, options) {
    return h('div', { class: 'seg' }, options.map(function (o) {
      return h('button', {
        type: 'button', 'aria-pressed': String(get() === o.v),
        onclick: function () { set(o.v); renderSheet(); },
      }, [o.t]);
    }));
  }

  // ---------------- 新建面板 ----------------

  function openSheet() {
    var rs = rounds();
    var d = Round.defaultsFrom(rs[rs.length - 1], config(), rs);
    draft = { days: d.days, perDay: d.perDay, diners: d.diners || 1,
              autoReduced: d.autoReduced, overrides: {}, more: false };
    sheetOpen = true;
    render();
  }

  function renderSheet() {
    var host = el.querySelector('#sheet');
    if (!host) return;
    host.innerHTML = '';
    var cfg = config();
    var meals = draft.days * draft.perDay;

    var card = h('div', { class: 'card' });
    card.appendChild(h('div', { style: 'font-weight:600;margin-bottom:10px' }, ['这次做多少']));

    card.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['做几天']),
      seg(function () { return draft.days; },
          function (v) { draft.days = v; },
          [{ v: 1, t: '1' }, { v: 2, t: '2' }, { v: 3, t: '3' },
           { v: 4, t: '4' }, { v: 5, t: '5' }, { v: 7, t: '7' }]),
    ]));
    var fn = Round.freshnessNote(draft.days);
    if (fn) {
      card.appendChild(h('div', { class: fn.level === 'warn' ? 'note warn' : 'note' }, [fn.text]));
    }
    card.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['每天几顿']),
      seg(function () { return draft.perDay; },
          function (v) { draft.perDay = v; },
          [{ v: 1, t: '只做一顿' }, { v: 2, t: '午饭 + 晚饭' }]),
    ]));
    card.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['几个人吃']),
      seg(function () { return draft.diners; },
          function (v) { draft.diners = v; },
          [{ v: 1, t: '1 人' }, { v: 2, t: '2 人' }, { v: 3, t: '3 人' }, { v: 4, t: '4 人' }]),
      h('div', { class: 'hint' }, [
        '营养目标仍按**你一个人**算,人数只用来放大份量 —— 别人饭量不同的话自己调',
      ]),
    ]));
    var dn = Round.dinersNote(draft.diners, meals);
    if (dn) card.appendChild(h('div', { class: 'note' }, [dn]));

    if (draft.autoReduced) {
      card.appendChild(h('div', { class: 'note warn' }, [
        '默认值比上次少了一天 —— 最近两轮都只做完六成以下。' +
        '排不完会变成负担,想做满直接点回去就行。',
      ]));
    }

    // 包装规格天然是「2 顿的量」,顿数直接决定拎几个包回来
    var servings = meals * draft.diners;
    var packs = Math.ceil(servings / 2);
    card.appendChild(h('div', { class: 'note' }, [
      meals + ' 顿 × ' + draft.diners + ' 人 = ' + servings + ' 份 ≈ ' +
      packs + ' 个蛋白包 + ' + packs + '-' + (packs + 1) + ' 个蔬菜包。' +
      '肉 300-400g、绿叶菜 300g/袋,一人一顿 150-200g —— 一个包就是两份的量。',
    ]));

    // ---- 这次有什么不一样(默认收起,不改就不用点开)----
    card.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:4px;font-size:14px;padding:9px',
      onclick: function () { draft.more = !draft.more; renderSheet(); },
    }, [draft.more ? '收起' : '这次有什么不一样?(可跳过)']));

    if (draft.more) {
      var more = h('div', { style: 'margin-top:12px' });

      more.appendChild(h('div', { class: 'row' }, [
        h('label', { class: 'lab' }, [
          '单顿动手时间上限 · 平时是 ' +
          (cfg.maxActiveMinutes === 999 ? '不限' : cfg.maxActiveMinutes + ' 分钟'),
        ]),
        seg(function () { return draft.overrides.maxActiveMinutes; },
            function (v) {
              if (draft.overrides.maxActiveMinutes === v) delete draft.overrides.maxActiveMinutes;
              else draft.overrides.maxActiveMinutes = v;
            },
            [{ v: 15, t: '15' }, { v: 20, t: '20' }, { v: 30, t: '30' },
             { v: 45, t: '45' }, { v: 999, t: '不限' }]),
        h('div', { class: 'hint' }, ['这周忙就压低,再点一次取消']),
      ]));

      more.appendChild(h('div', { class: 'row' }, [
        h('label', { class: 'lab' }, [
          '辣度 · 平时是 ' + ['不吃辣', '微辣', '中辣', '重辣'][cfg.maxSpicy == null ? 3 : cfg.maxSpicy],
        ]),
        seg(function () { return draft.overrides.maxSpicy; },
            function (v) {
              if (draft.overrides.maxSpicy === v) delete draft.overrides.maxSpicy;
              else draft.overrides.maxSpicy = v;
            },
            [{ v: 0, t: '不吃辣' }, { v: 1, t: '微辣' }, { v: 2, t: '中辣' }, { v: 3, t: '重辣' }]),
        h('div', { class: 'hint' }, ['嘴上火了这周清淡点,不用去改长期设定']),
      ]));

      more.appendChild(h('div', { class: 'note' }, [
        '这里改的**只作用于这一次**,不会动你的长期设定。' +
        '记下来之后也能回头看:「那次我限了 20 分钟,结果四顿做完了三顿」。',
      ]));
      card.appendChild(more);
    }

    card.appendChild(h('button', {
      class: 'btn', style: 'margin-top:14px',
      onclick: create,
    }, ['记下这一次']));
    card.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px',
      onclick: function () { sheetOpen = false; render(); },
    }, ['取消']));

    host.appendChild(card);
  }

  function create() {
    var rs = rounds();
    var r = Round.create(
      { days: draft.days, perDay: draft.perDay, diners: draft.diners,
        overrides: draft.overrides },
      config(), new Date().toISOString()
    );
    rs.push(r);
    saveRounds(rs);
    sheetOpen = false;
    render();
  }

  // ---------------- 生成 ----------------

  function generate(r) {
    var cfg = config();
    var cons = Round.effectiveConstraints(r, cfg);
    // 库存里已有的先扣掉,临期的必须排掉 —— 这两条是求解器的输入不是事后过滤
    var stock = {};
    Pantry.items().forEach(function (it) {
      stock[it.ingredientId] = (stock[it.ingredientId] || 0) + it.amount;
    });
    var nowIso = new Date().toISOString();
    var mustUse = Pantry.expiringSoon(3, nowIso).map(function (it) { return it.ingredientId; });

    var out = Solver.solve({
      servings: r.input.servings || r.input.meals,
      constraints: cons, stock: stock, mustUse: mustUse,
      stockDetail: Pantry.stockSummary(nowIso),   // 带紧迫度,放久的会被优先排掉
      recentRecipeIds: recentIds(),
    });
    if (!out.ok) {
      alert('这次没排出来(' + (out.reason || '未知') + ')。'
          + '多半是约束太紧 —— 把耗时上限放宽,或者少勾几样忌口试试。');
      return;
    }
    var rs = rounds();
    var i = rs.findIndex(function (x) { return x.id === r.id; });
    rs[i].solved = {
      at: new Date().toISOString(),
      // 需求克数是主的(菜谱算得出),包装规格只是提示(没人核实过)。
      // 买多少由你在货架前定,回来记实际克数 —— app 不猜它看不见的东西。
      shopping: out.shopping.buy.map(function (b) {
        return {
          ingredientId: b.ingredientId, name: b.ing.name, kind: b.kind,
          needGrams: b.needGrams,
          unit: b.plan ? b.plan.option.unit : 'g',
          hintPack: b.plan ? b.plan.option.netWeight : null,
          hintPacks: b.plan ? b.plan.packs : null,
          hintConfidence: b.plan ? b.plan.option.confidence : null,
          tier: b.ing.tier,
          shelfLifeDays: b.ing.shelfLifeDays,
          bought: false, actualGrams: null,
        };
      }),
      useStock: out.shopping.useStock.map(function (u) {
        return { ingredientId: u.ingredientId, name: u.ing.name,
                 needGrams: u.needGrams, stockGrams: u.stockGrams };
      }),
      // 这几道菜要用、而储物柜里没有的调料 —— 只问这几样,不让用户去 382 条里翻。
      // 「你有郫县豆瓣吗」这个问题只在某道菜要用它的时候才有意义。
      seasonings: (function () {
        var need = {};
        out.stage2.chosen.forEach(function (c) {
          Pantry.missingSeasonings(c.variant).forEach(function (id) {
            var i = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
            if (!i) return;
            (need[id] = need[id] || { ingredientId: id, name: i.name,
                                      packaging: i.packaging,
                                      surplus: !!i.inevitableSurplus, dishes: [] })
              .dishes.push(c.recipe.name);
          });
        });
        return Object.keys(need).map(function (k) { return need[k]; });
      })(),
      meals: out.stage2.chosen.map(function (c) {
        return { recipeId: c.recipe.id, name: c.recipe.name, method: c.recipe.method,
                 prepLevel: c.variant.prepLevel, activeMinutes: c.variant.activeMinutes,
                 totalMinutes: c.variant.totalMinutes, difficulty: c.variant.difficulty,
                 missing: c.missing, cooked: false };
      }),
      freshWaste: out.wasteRatio,
      freshLeft: out.stage2.freshLeft, carryLeft: out.stage2.carryLeft,
      methodCount: out.stage2.methodCount,
    };
    rs[i].status = 'shopping';
    saveRounds(rs);
    render();
  }

  /** 冷却期:最近两轮做过的菜不再排,免得连着吃同一道 */
  function recentIds() {
    var out = {};
    rounds().slice(-2).forEach(function (r) {
      (r.solved && r.solved.meals || []).forEach(function (m) { out[m.recipeId] = 1; });
    });
    return out;
  }

  /** 就地修正包装规格 —— 写进 packageOverrides,和规格页是同一份数据 */
  function savePkgCorrection(ingredientId, netWeight, unit) {
    var ov = Store.get('packageOverrides', {}) || {};
    var existing = PACKAGES.filter(function (p) { return p.ingredientId === ingredientId; })[0];
    if (existing) {
      ov[existing.id] = Object.assign({}, ov[existing.id] || {}, {
        netWeight: netWeight, unit: unit, confidence: 'A',
        editedAt: new Date().toISOString(),
      });
      Store.set('packageOverrides', ov);
    } else {
      var list = Store.get('userPackages', []) || [];
      var i = INGREDIENTS.filter(function (x) { return x.id === ingredientId; })[0];
      list.push({ id: 'UP-' + ingredientId, ingredientId: ingredientId,
                  name: (i ? i.name : ingredientId), netWeight: netWeight, unit: unit,
                  sellMode: '定量预包装', price: null, confidence: 'A',
                  createdAt: new Date().toISOString() });
      Store.set('userPackages', list);
    }
    if (typeof Packaging !== 'undefined') Packaging.invalidate();
  }

  function toggleBought(r, ingredientId) {
    var rs = rounds();
    var k = rs.findIndex(function (x) { return x.id === r.id; });
    var t = rs[k].solved.shopping.filter(function (x) {
      return x.ingredientId === ingredientId;
    })[0];
    if (!t) return;
    t.bought = !t.bought;
    if (!t.bought) t.actualGrams = null;
    saveRounds(rs);
    syncPantry(rs[k]);
    render();
  }

  function setActual(r, ingredientId, grams) {
    var rs = rounds();
    var k = rs.findIndex(function (x) { return x.id === r.id; });
    var t = rs[k].solved.shopping.filter(function (x) {
      return x.ingredientId === ingredientId;
    })[0];
    if (!t) return;
    t.actualGrams = grams;
    saveRounds(rs);
    syncPantry(rs[k]);
    render();
  }

  /** 采购勾选 → 库存。以**实际克数**为准,没填就先按需求量记,回头改了会同步。 */
  function syncPantry(round) {
    var tag = 'round:' + round.id;
    // 先清掉这一轮之前写进去的,再按当前状态重建 —— 避免反复勾选写重复
    Store.set('pantryItems', Pantry.items().filter(function (it) {
      return it.source !== tag;
    }));
    var now = new Date().toISOString();
    (round.solved.shopping || []).forEach(function (t) {
      if (!t.bought) return;
      var g = t.actualGrams != null ? t.actualGrams : t.needGrams;
      if (!g) return;
      var it = Pantry.addFromPackage(
        { id: t.ingredientId, ingredientId: t.ingredientId, netWeight: g, unit: t.unit },
        now);
      var list = Pantry.items();
      list[list.length - 1].source = tag;
      Store.set('pantryItems', list);
    });
  }

  function resultView(r) {
    var s = r.solved;
    var box = h('div', { style: 'margin-top:12px' });

    // ⚠️ 买之前只能给估计,而且要说清楚是估的 ——
    //    包装规格 99.3% 没核实过,拿它算出「浪费 13%」再报给用户,
    //    是把 C 级输入包装成 A 级输出。填了实际克数之后才是真数。
    var filled = (s.shopping || []).filter(function (x) { return x.actualGrams != null; });
    var allBought = (s.shopping || []).length > 0 &&
                    (s.shopping || []).every(function (x) { return x.bought; });

    if (filled.length) {
      var need = 0, got = 0;
      filled.forEach(function (x) { need += x.needGrams; got += x.actualGrams; });
      var over = got - need;
      box.appendChild(h('div', { class: over > need * 0.3 ? 'note warn' : 'note' }, [
        '按你填的实际克数:买了 ' + Math.round(got) + 'g,这次要用 ' + Math.round(need) + 'g,' +
        (over > 5 ? '**多的 ' + Math.round(over) + 'g 进库存**,下次会优先排掉它们。'
                  : '基本正好。') +
        (filled.length < s.shopping.length
          ? '(还有 ' + (s.shopping.length - filled.length) + ' 样没填)' : ''),
      ]));
    } else {
      box.appendChild(h('div', { class: 'note' }, [
        s.methodCount + ' 种做法。' +
        '下面的克数是**菜谱算出来的需求**,准的;括号里的规格是估的,没人核实过 —— ' +
        '买的时候以货架为准,回来填实际克数。',
      ]));
    }

    var useStock = s.useStock || [];
    if (useStock.length) {
      box.appendChild(h('div', { style: 'font-weight:600;margin:12px 0 6px' }, ['先用库存里的']));
      useStock.forEach(function (it) {
        box.appendChild(h('div', { class: 'note', style: 'margin-bottom:6px' }, [
          it.name + ' —— 这次要 ' + it.needGrams + 'g,库存里能出 ' + it.stockGrams + 'g',
        ]));
      });
    }

    box.appendChild(h('div', { style: 'font-weight:600;margin:12px 0 6px' }, ['买这些']));
    box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      '克数是**菜谱算出来的需求**,买的时候拿最接近的规格就行。' +
      '回来把实际克数填上 —— 多的会进库存,下次优先吃掉。',
    ]));

    s.shopping.forEach(function (it, i) {
      var card2 = h('div', { class: 'card', style: 'padding:10px 12px;margin-bottom:8px' });
      var head = h('div', { style: 'display:flex;gap:8px;align-items:center' });
      head.appendChild(h('button', {
        type: 'button',
        style: 'border:0;background:none;font-size:18px;cursor:pointer;padding:0',
        onclick: function () { toggleBought(r, it.ingredientId); },
      }, [it.bought ? '☑' : '☐']));
      head.appendChild(h('div', { style: 'flex:1' + (it.bought ? ';opacity:.55' : '') }, [
        h('div', { style: 'font-weight:600' }, [it.name + '  ' + it.needGrams + it.unit]),
        h('div', { class: 'hint' }, [
          (it.hintPack
            ? '常见规格 ' + it.hintPack + it.unit +
              (it.hintPacks > 1 ? ',大概要 ' + it.hintPacks + ' 份' : '') +
              '(估的)'
            : '规格未知,按需求量买') +
          (it.tier === 'fresh' && it.shelfLifeDays
            ? ' · 冷藏 ' + it.shelfLifeDays + ' 天' : ''),
        ]),
      ]));
      // 站在货架前发现规格不对,就地改 —— 不用去翻那 135 条
      if (it.hintPack) {
        head.appendChild(h('button', {
          class: 'btn ghost',
          style: 'width:auto;padding:4px 8px;font-size:11px;flex:0 0 auto',
          onclick: function () {
            var v = prompt('这包实际是多少 ' + it.unit + '?改了以后排菜会更准,不改也不影响记账。',
                           it.hintPack);
            if (v == null) return;
            var n = parseFloat(v);
            if (isNaN(n) || n <= 0) return;
            savePkgCorrection(it.ingredientId, n, it.unit);
            alert('记下了。以后按 ' + n + it.unit + ' 算。');
          },
        }, ['规格不对?']));
      }
      card2.appendChild(head);

      // 勾了才问实际买了多少 —— 没买之前问这个是噪音
      if (it.bought) {
        var line = h('div', { style: 'display:flex;gap:8px;align-items:center;margin-top:8px' });
        line.appendChild(h('span', { class: 'hint' }, ['实际买了']));
        line.appendChild(h('input', {
          type: 'number', inputmode: 'decimal',
          style: 'width:90px',
          value: it.actualGrams == null ? '' : String(it.actualGrams),
          placeholder: String(it.hintPack || it.needGrams),
          onchange: function (e) {
            var v = parseFloat(e.target.value);
            setActual(r, it.ingredientId, isNaN(v) ? null : v);
          },
        }));
        line.appendChild(h('span', { class: 'hint' }, [it.unit]));
        card2.appendChild(line);
        if (it.actualGrams != null) {
          var over = it.actualGrams - it.needGrams;
          card2.appendChild(h('div', { class: 'hint', style: 'margin-top:4px' }, [
            over > 5 ? '这次用 ' + it.needGrams + it.unit + ',剩 ' + Math.round(over)
                       + it.unit + ' 进库存'
                     : (over < -5 ? '⚠️ 比需求少 ' + Math.round(-over) + it.unit + ',可能不够'
                                  : '正好'),
          ]));
        }
      }
      box.appendChild(card2);
    });

    // 缺的调料:就地回答「买」还是「我有」,不用去储物柜翻 382 条
    var seas = (s.seasonings || []).filter(function (x) {
      return !Pantry.hasStaple(x.ingredientId);
    });
    if (seas.length) {
      box.appendChild(h('div', { style: 'font-weight:600;margin:14px 0 6px' },
        ['还差 ' + seas.length + ' 样调料']));
      seas.forEach(function (sx) {
        var line = h('div', { class: 'card', style: 'padding:10px 12px;margin-bottom:6px' });
        line.appendChild(h('div', {}, [sx.name]));
        line.appendChild(h('div', { class: 'hint' }, [
          sx.dishes.slice(0, 2).join(' · ') + (sx.dishes.length > 2 ? ' 等 ' + sx.dishes.length + ' 道菜要用' : ' 要用') +
          (sx.packaging ? ' · 常见 ' + sx.packaging : ''),
        ]));
        if (sx.surplus) {
          line.appendChild(h('div', { class: 'hint', style: 'color:var(--warn)' },
            ['⚠️ 最小规格一个人多半吃不完,想清楚再买']));
        }
        var btns = h('div', { style: 'display:flex;gap:6px;margin-top:8px' });
        btns.appendChild(h('button', {
          class: 'btn ghost', style: 'width:auto;padding:5px 12px;font-size:13px',
          onclick: function () { Pantry.toggleStaple(sx.ingredientId); render(); },
        }, ['我有']));
        btns.appendChild(h('button', {
          class: 'btn ghost', style: 'width:auto;padding:5px 12px;font-size:13px',
          onclick: function () { Pantry.toggleStaple(sx.ingredientId); render(); },
        }, ['买了 · 记进储物柜']));
        line.appendChild(btns);
        box.appendChild(line);
      });
    }

    box.appendChild(h('div', { style: 'font-weight:600;margin:14px 0 6px' }, ['做这些']));
    s.meals.forEach(function (m, i) {
      box.appendChild(h('div', { class: 'card', style: 'padding:10px 12px;margin-bottom:6px' }, [
        h('div', {}, [(i + 1) + '. ' + m.name +
          (m.prepLevel !== 'scratch' ? '(' + m.prepLevel + ')' : '')]),
        h('div', { class: 'hint' }, [
          m.method + ' · 动手 ' + m.activeMinutes + ' 分' +
          (m.totalMinutes > m.activeMinutes ? '(总共 ' + m.totalMinutes + ' 分)' : '') +
          ' · 难度 ' + m.difficulty +
          (m.missing ? ' · 缺 ' + m.missing + ' 样调料' : ''),
        ]),
      ]));
    });

    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:8px;padding:7px;font-size:13px',
      onclick: function () {
        var rs = rounds();
        var k = rs.findIndex(function (x) { return x.id === r.id; });
        delete rs[k].solved; rs[k].status = 'planning';
        saveRounds(rs); render();
      },
    }, ['重新生成']));
    return box;
  }

  // ---------------- 列表 ----------------

  function roundCard(r, idx, total) {
    var box = h('div', { class: 'card' });
    var head = h('div', { style: 'display:flex;align-items:center;gap:8px;flex-wrap:wrap' }, [
      h('strong', {}, [r.createdAt.slice(5, 10).replace('-', ' / ')]),
      h('span', { class: 'conf conf-' + (r.status === 'done' ? 'A' : 'B') },
        [Round.STATUS[r.status] || r.status]),
      idx === total - 1 ? h('span', { class: 'hint' }, ['最新']) : h('span', {}),
    ]);
    box.appendChild(head);
    box.appendChild(h('div', { style: 'margin-top:4px' }, [Round.summarize(r)]));

    var labels = Round.overrideLabels(r);
    if (labels.length) {
      box.appendChild(h('div', { class: 'hint' }, ['这次特殊:' + labels.join(' · ')]));
    }

    if (r.status === 'planning' && !r.solved) {
      box.appendChild(h('button', {
        class: 'btn', style: 'margin-top:10px',
        onclick: function () { generate(r); },
      }, ['生成采购清单和菜']));
    }
    if (r.solved) box.appendChild(resultView(r));

    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-top:10px;padding:7px;font-size:13px',
      onclick: function () {
        if (confirm('删掉这一轮记录?')) {
          var rs = rounds().filter(function (x) { return x.id !== r.id; });
          saveRounds(rs); render();
        }
      },
    }, ['删除']));
    return box;
  }

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    var rs = rounds();

    w.appendChild(h('h1', {}, ['做饭记录']));
    w.appendChild(h('p', { class: 'sub' }, [
      '每次做饭是一条记录。攒多了才看得出「总剩菠菜」「排四顿只做两顿」这种事。',
    ]));

    if (sheetOpen) {
      w.appendChild(h('div', { id: 'sheet' }));
    } else {
      w.appendChild(h('button', { class: 'btn', onclick: openSheet }, ['＋ 这次要做饭了']));
    }

    if (!rs.length && !sheetOpen) {
      w.appendChild(h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🍚']),
        h('div', {}, ['还没有记录']),
      ]));
      w.appendChild(h('div', { class: 'card' }, [
        h('div', { class: 'hint' }, [
          '点上面那个按钮开始第一次。每次只问两件事(做几天、每天几顿),',
          '想临时改耗时或辣度可以展开改 —— 改的只作用于这一次,不动长期设定。',
        ]),
      ]));
    } else {
      rs.slice().reverse().forEach(function (r, i) {
        w.appendChild(roundCard(r, rs.length - 1 - i, rs.length));
      });
    }

    el.appendChild(w);
    if (sheetOpen) renderSheet();
  }

  function mount(node, opts) {
    el = node;
    onOpenPkg = (opts || {}).onOpenPkg;
    render();
  }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = RoundsUI;
