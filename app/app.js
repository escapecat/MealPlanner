// 装配层:决定显示哪一页,绑定底部 tab。
// 业务逻辑一律不在这里 —— 这一层只负责「谁来渲染」。

(function () {
  var root = document.getElementById('app');

  var TABS = [
    { id: 'plan',    icon: '🍚', label: '本周' },
    { id: 'pantry',  icon: '🧊', label: '库存' },
    { id: 'pkg',     icon: '📦', label: '规格' },
    { id: 'me',      icon: '⚙️', label: '我的' },
  ];

  var current = 'plan';

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

  function needsOnboarding() {
    var p = Store.get('profile');
    return !p || !p.age || !p.heightCm;
  }

  /** 空状态写「下一步做什么」,不是只写「暂无数据」 */
  function placeholder(title, lines, cta) {
    var w = h('div', { class: 'wrap' }, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🥬']),
        h('div', { style: 'font-weight:600;margin-bottom:8px' }, [title]),
      ]),
    ]);
    var c = h('div', { class: 'card' });
    lines.forEach(function (l) { c.appendChild(h('div', { class: 'hint' }, [l])); });
    w.appendChild(c);
    if (cta) {
      w.appendChild(h('button', { class: 'btn ghost', onclick: cta.onclick }, [cta.label]));
    }
    return w;
  }

  function renderTabbar() {
    return h('nav', { class: 'tabbar' }, TABS.map(function (t) {
      return h('button', {
        type: 'button',
        'aria-current': current === t.id ? 'page' : null,
        onclick: function () { current = t.id; render(); },
      }, [
        h('span', { class: 'ic' }, [t.icon]),
        h('span', {}, [t.label]),
      ]);
    }));
  }

  function render() {
    root.innerHTML = '';

    if (needsOnboarding()) {
      Onboarding.onDone = function () { current = 'plan'; render(); };
      Onboarding.mount(root);
      return;
    }

    var page = h('div');
    if (current === 'pkg') {
      PackagesUI.mount(page);
    } else if (current === 'me') {
      page.appendChild(renderMe());
    } else if (current === 'pantry') {
      page.appendChild(placeholder('库存还是空的', [
        '库存不用手动录 —— 采购清单上勾「已买」就会自动按包装规格入库,',
        '某顿点「完成」就自动按用量扣减。',
        '所以先去「本周」生成一次计划。',
      ], { label: '去生成本周计划', onclick: function () { current = 'plan'; render(); } }));
    } else {
      page.appendChild(renderPlan());
    }
    root.appendChild(page);
    root.appendChild(renderTabbar());
  }

  function renderPlan() {
    var cfg = Store.get('config', {}) || {};
    var draft = Store.get('planDraft', { days: 2, perDay: 2 }) || { days: 2, perDay: 2 };
    var meals = draft.days * draft.perDay;

    var c = Catalog.countAvailable({
      equipment: cfg.equipment,
      blacklist: Catalog.expandBlacklist(cfg.blacklist),
      maxSpicy: cfg.maxSpicy,
      maxActiveMinutes: cfg.maxActiveMinutes,
    });
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['本周']));
    w.appendChild(h('p', { class: 'sub' }, ['每次做多少是这次的事,不是一次定死的设定']));

    function pick(field, options, label, hint) {
      return h('div', { class: 'row' }, [
        h('label', { class: 'lab' }, [label]),
        h('div', { class: 'seg' }, options.map(function (o) {
          return h('button', {
            type: 'button', 'aria-pressed': String(draft[field] === o.v),
            onclick: function () {
              draft[field] = o.v;
              Store.set('planDraft', draft);
              render();
            },
          }, [o.t]);
        })),
        hint ? h('div', { class: 'hint' }, [hint]) : h('span', {}),
      ]);
    }

    var box = h('div', { class: 'card' });
    box.appendChild(pick('days', [
      { v: 1, t: '1 天' }, { v: 2, t: '2 天' }, { v: 3, t: '3 天' },
    ], '这次做几天?'));
    box.appendChild(pick('perDay', [
      { v: 1, t: '只做一顿' }, { v: 2, t: '午饭 + 晚饭' },
    ], '每天几顿?', '只做晚饭、中午吃外面也很常见'));
    w.appendChild(box);

    // 包装规格天然是「2 顿的量」,所以顿数直接决定要买几个包 —— 把这层换算摊开给你看,
    // 而不是等生成完才发现「怎么买了三包菜」。
    var protein = Math.ceil(meals / 2);
    var veg = Math.ceil(meals / 2);
    w.appendChild(h('div', { class: 'note' }, [
      meals + ' 顿 ≈ ' + protein + ' 个蛋白包 + ' + veg + '-' + (veg + 1) + ' 个蔬菜包。' +
      '盒马冷鲜肉 300-400g、绿叶菜 300g/袋,一人一顿 150-200g —— ' +
      '一个包就是两顿的量,所以「主料复用、做法不重复」不是将就,是唯一解。',
    ]));

    w.appendChild(h('div', { class: 'card' }, [
      h('div', { style: 'font-weight:600' }, ['菜谱库已就绪']),
      h('div', { class: 'hint' }, [
        c.dishes + ' 道菜可做 · ' + c.variants + ' 个做法档位 · 共 ' + c.total + ' 道',
      ]),
    ]));

    w.appendChild(h('div', { class: 'note warn' }, [
      '求解器还没写。下一步是它 —— 先选包(规格是硬约束),再排菜(菜是软的)。',
    ]));

    w.appendChild(h('div', { class: 'card' }, [
      h('div', { style: 'font-weight:600;margin-bottom:6px' }, ['在那之前,建议先做一件事']),
      h('div', { class: 'hint' }, [
        '包装规格 135 条里几乎没有核实过的。求解器算「买 300g 用 180g 剩 120g」全靠这个数,',
        '不准的话算出来的「零浪费」是假的。下次逛超市顺手改几个最常买的。',
      ]),
      h('button', {
        class: 'btn ghost', style: 'margin-top:10px',
        onclick: function () { current = 'pkg'; render(); },
      }, ['去看包装规格']),
    ]));
    return w;
  }

  function renderMe() {
    var p = Store.get('profile', {}) || {};
    var wl = Store.get('weightLog', []) || [];
    var kg = wl.length ? wl[wl.length - 1].kg : null;
    var d = Profile.dailyTargets(Object.assign({}, p, { weightKg: kg }));

    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['我的']));

    if (d) {
      w.appendChild(h('div', { class: 'card' }, [
        h('div', { style: 'font-weight:600' }, ['每日目标']),
        h('div', {}, [d.kcal + ' kcal · 蛋白 ' + d.protein + 'g · 蔬菜 ' + d.veg + 'g']),
        h('div', { class: 'hint' }, [
          '基础代谢 ' + Profile.bmr(Object.assign({}, p, { weightKg: kg })) +
          ' · 日常消耗 ' + d.tdee + ' · 目标 ' + (Profile.GOAL[p.goal] || {}).label,
        ]),
      ]));
    }

    w.appendChild(h('div', { class: 'card' }, [
      h('div', { style: 'font-weight:600;margin-bottom:6px' }, ['数据']),
      h('button', {
        class: 'btn ghost', style: 'margin-bottom:8px',
        onclick: function () {
          var blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)],
                              { type: 'application/json' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'mealplanner-' + new Date().toISOString().slice(0, 10) + '.json';
          a.click();
        },
      }, ['导出备份']),
      h('button', {
        class: 'btn ghost',
        onclick: function () {
          if (confirm('清空所有数据重新开始?这个动作不能撤销。')) {
            Store.keys().forEach(function (k) { Store.remove(k); });
            current = 'plan'; render();
          }
        },
      }, ['重新设置']),
      h('div', { class: 'hint', style: 'margin-top:8px' },
        ['数据只存在这台设备的浏览器里。换设备或清缓存前记得导出。']),
    ]));
    return w;
  }

  render();
})();
