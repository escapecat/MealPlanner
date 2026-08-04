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
    var mustUse = Pantry.expiringSoon(3, new Date().toISOString())
      .map(function (it) { return it.ingredientId; });

    var out = Solver.solve({
      servings: r.input.servings || r.input.meals,
      constraints: cons, stock: stock, mustUse: mustUse,
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
      shopping: out.stage1.picks.map(function (p) {
        return {
          ingredientId: p.ingredientId, name: p.ing.name, kind: p.kind,
          packs: p.plan ? p.plan.packs : null,
          packSize: p.plan ? p.plan.option.netWeight : null,
          unit: p.plan ? p.plan.option.unit : 'g',
          total: p.plan ? p.plan.total : p.needGrams,
          confidence: p.plan ? p.plan.option.confidence : 'C',
          bought: false,
        };
      }),
      meals: out.stage2.chosen.map(function (c) {
        return { recipeId: c.recipe.id, name: c.recipe.name, method: c.recipe.method,
                 prepLevel: c.variant.prepLevel, activeMinutes: c.variant.activeMinutes,
                 totalMinutes: c.variant.totalMinutes, difficulty: c.variant.difficulty,
                 missing: c.missing, cooked: false };
      }),
      freshWaste: out.stage2.wasteRatio,
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

  function resultView(r) {
    var s = r.solved;
    var box = h('div', { style: 'margin-top:12px' });

    box.appendChild(h('div', { class: s.freshWaste > 0.2 ? 'note warn' : 'note' }, [
      '生鲜浪费 ' + (s.freshWaste * 100).toFixed(0) + '%' +
      (s.freshLeft > 1 ? '(剩 ' + Math.round(s.freshLeft) + 'g)' : '') +
      ' · ' + s.methodCount + ' 种做法' +
      (s.carryLeft > 1 ? ' · 结转 ' + Math.round(s.carryLeft) + 'g 下次接着用' : ''),
    ]));

    box.appendChild(h('div', { style: 'font-weight:600;margin:12px 0 6px' }, ['买这些']));
    s.shopping.forEach(function (it, i) {
      var line = h('div', { style: 'display:flex;gap:8px;align-items:center;margin-bottom:6px' });
      line.appendChild(h('button', {
        type: 'button',
        style: 'border:0;background:none;font-size:18px;cursor:pointer;padding:0',
        onclick: function () {
          var rs = rounds();
          var k = rs.findIndex(function (x) { return x.id === r.id; });
          var t = rs[k].solved.shopping[i];
          t.bought = !t.bought;
          // 勾「已买」自动入库 —— 零额外录入
          if (t.bought) {
            Pantry.addFromPackage({ id: t.ingredientId, ingredientId: t.ingredientId,
                                    netWeight: t.total, unit: t.unit },
                                  new Date().toISOString());
          }
          saveRounds(rs); render();
        },
      }, [it.bought ? '☑' : '☐']));
      line.appendChild(h('span', { style: 'flex:1' + (it.bought ? ';opacity:.5' : '') }, [
        it.name + '  ' +
        (it.packs > 1 ? it.packSize + it.unit + ' × ' + it.packs : it.total + it.unit),
      ]));
      line.appendChild(h('span', { class: 'conf conf-' + it.confidence }, [it.confidence]));
      box.appendChild(line);
    });
    box.appendChild(h('div', { class: 'hint' },
      ['勾「已买」会按规格自动入库。规格标 C 的没核实过,买的时候顺手看一眼实际克数。']));

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
