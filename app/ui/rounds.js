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
    draft = { days: d.days, perDay: d.perDay, autoReduced: d.autoReduced, overrides: {}, more: false };
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
          [{ v: 1, t: '1 天' }, { v: 2, t: '2 天' }, { v: 3, t: '3 天' }]),
    ]));
    card.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['每天几顿']),
      seg(function () { return draft.perDay; },
          function (v) { draft.perDay = v; },
          [{ v: 1, t: '只做一顿' }, { v: 2, t: '午饭 + 晚饭' }]),
    ]));

    if (draft.autoReduced) {
      card.appendChild(h('div', { class: 'note warn' }, [
        '默认值比上次少了一天 —— 最近两轮都只做完六成以下。' +
        '排不完会变成负担,想做满直接点回去就行。',
      ]));
    }

    // 包装规格天然是「2 顿的量」,顿数直接决定拎几个包回来
    var packs = Math.ceil(meals / 2);
    card.appendChild(h('div', { class: 'note' }, [
      meals + ' 顿 ≈ ' + packs + ' 个蛋白包 + ' + packs + '-' + (packs + 1) + ' 个蔬菜包。' +
      '肉 300-400g、绿叶菜 300g/袋,一人一顿 150-200g —— 一个包就是两顿的量。',
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
      { days: draft.days, perDay: draft.perDay, overrides: draft.overrides },
      config(), new Date().toISOString()
    );
    rs.push(r);
    saveRounds(rs);
    sheetOpen = false;
    render();
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

    if (r.status === 'planning') {
      box.appendChild(h('div', { class: 'note warn', style: 'margin-top:10px' }, [
        '求解器还没写,这一轮只记下了输入。等它好了,这里会出采购清单和四顿的菜。',
      ]));
    }

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
