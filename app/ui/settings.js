// 设置页(「我的」tab)—— 冷启动填的东西,之后都要能改。
//
// 分工判据:**会被吃掉的东西归「库存」,不会被吃掉的归这里。**
//   厨具:不消耗 → 这里
//   身体数据 / 目标 / 忌口 / 辣度 / 耗时上限:不消耗 → 这里
//   调味料:会慢慢用完,而且 DESIGN 的三级库存里 staple 那档就是「调料米面油」→ 库存
//
// 这一层只做展示和事件绑定。

var SettingsUI = (function () {

  var el, section = null, onNav = null, blQ = '';

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? Dom.text(c) : c);
    });
    return n;
  }

  function profile() { return Store.get('profile', {}) || {}; }
  function config()  { return Store.get('config', {}) || {}; }
  function weightLog() { return Store.get('weightLog', []) || []; }
  function curWeight() { var w = weightLog(); return w.length ? w[w.length - 1].kg : null; }

  function saveProfile(patch) {
    Store.set('profile', Object.assign({}, profile(), patch, { updatedAt: new Date().toISOString() }));
    render();
  }
  function saveConfig(patch) {
    Store.set('config', Object.assign({}, config(), patch, { updatedAt: new Date().toISOString() }));
    render();
  }

  function seg(get, set, options) {
    return h('div', { class: 'seg' }, options.map(function (o) {
      return h('button', {
        type: 'button', 'aria-pressed': String(get() === o.v),
        onclick: function () { set(o.v); },
      }, [o.t]);
    }));
  }

  function chips(items, isOn, toggle) {
    return h('div', { class: 'chips' }, items.map(function (it) {
      return h('button', {
        type: 'button', 'aria-pressed': String(isOn(it)),
        onclick: function () { toggle(it); },
      }, [it.label]);
    }));
  }

  function row(label, node, hint) {
    return h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, [label]), node,
      hint ? h('div', { class: 'hint' }, [hint]) : h('span', {}),
    ]);
  }

  // ---------------- 各分区 ----------------

  function targetsCard() {
    var p = profile(), kg = curWeight();
    var d = Profile.dailyTargets(Object.assign({}, p, { weightKg: kg }));
    var box = h('div', { class: 'card' });
    if (!d) {
      box.appendChild(h('div', { class: 'hint' }, ['身体数据不全,算不出目标']));
      return box;
    }
    var pm = Profile.perPlannedMeal(d, p.breakfast);
    box.appendChild(h('div', { style: 'font-weight:600' }, ['每日目标 ' + d.kcal + ' kcal']));
    box.appendChild(h('div', {}, ['蛋白 ' + d.protein + 'g · 蔬菜 ' + d.veg + 'g']));
    box.appendChild(h('div', { style: 'margin-top:6px' },
      ['要排的午饭 / 晚饭各约 ' + pm.kcal + ' kcal · 蛋白 ' + pm.protein + 'g']));
    box.appendChild(h('div', { class: 'hint' }, [pm.note]));
    box.appendChild(h('div', { class: 'hint' }, [
      '基础代谢 ' + Profile.bmr(Object.assign({}, p, { weightKg: kg })) +
      ' · 日常消耗 ' + d.tdee + ' · ' + (Profile.GOAL[p.goal] || {}).label,
    ]));
    return box;
  }

  function bodySection() {
    var p = profile(), kg = curWeight();
    var box = h('div', { class: 'card' });

    box.appendChild(row('性别',
      seg(function () { return p.sex; }, function (v) { saveProfile({ sex: v }); },
          [{ v: 'male', t: '男' }, { v: 'female', t: '女' }])));

    ['age|年龄|岁', 'heightCm|身高|cm'].forEach(function (spec) {
      var f = spec.split('|');
      box.appendChild(row(f[1], h('input', {
        type: 'number', inputmode: 'decimal', value: p[f[0]] == null ? '' : String(p[f[0]]),
        onchange: function (e) {
          var v = parseFloat(e.target.value);
          if (!isNaN(v)) saveProfile((function (o) { o[f[0]] = v; return o; })({}));
        },
      }), f[2]));
    });

    // 体重是时间序列 —— 改一次记一条,不是覆盖(DESIGN 第七节:体重变则目标重算)
    box.appendChild(row('体重', h('input', {
      type: 'number', inputmode: 'decimal', value: kg == null ? '' : String(kg),
      onchange: function (e) {
        var v = parseFloat(e.target.value);
        if (isNaN(v)) return;
        var log = weightLog();
        log.push({ date: new Date().toISOString(), kg: v });
        Store.set('weightLog', log);
        render();
      },
    }), '每次改都会记一条,不是覆盖 —— 目标跟着体重走。已记 ' + weightLog().length + ' 条'));

    box.appendChild(row('活动量',
      seg(function () { return p.activity; }, function (v) { saveProfile({ activity: v }); },
          Object.keys(Profile.ACTIVITY).map(function (k) {
            return { v: k, t: Profile.ACTIVITY[k].label };
          })),
      (Profile.ACTIVITY[p.activity] || {}).desc));

    box.appendChild(row('目标',
      seg(function () { return p.goal; }, function (v) { saveProfile({ goal: v }); },
          Object.keys(Profile.GOAL).map(function (k) {
            return { v: k, t: Profile.GOAL[k].label };
          })),
      (Profile.GOAL[p.goal] || {}).desc));

    box.appendChild(row('早饭大概吃多少',
      seg(function () { return p.breakfast; }, function (v) { saveProfile({ breakfast: v }); },
          Object.keys(Profile.BREAKFAST).map(function (k) {
            return { v: k, t: Profile.BREAKFAST[k].label };
          })),
      (Profile.BREAKFAST[p.breakfast] || {}).desc +
      ' —— 这是唯一应用看不见的一顿,体重没按预期走时先怀疑这一档'));

    return box;
  }

  /**
   * 忌口编辑器 —— 可搜、可加任何食材、可减。
   *
   * ⚠️ 早先只给了 10 个硬编码的常见项(香菜/苦瓜/秋葵…)。
   *    不吃羊肉、对某样过敏、讨厌某种鱼 —— 全都没地方填。
   *    给一份罐头清单,等于替用户决定了他能表达什么。
   *
   * 每一项都显示代价(少多少道菜可做),因为忌口是真会缩小可选范围的,
   * 勾之前该知道。
   */
  function blacklistEditor(cfg) {
    var list = (cfg.blacklist || []).slice();
    var box = h('div', { class: 'row' });
    box.appendChild(h('label', { class: 'lab' }, ['不吃的']));

    function save(next) { saveConfig({ blacklist: next }); }

    function costOf(id) {
      var withOut = Catalog.countAvailable({
        equipment: cfg.equipment, maxSpicy: cfg.maxSpicy,
        maxActiveMinutes: cfg.maxActiveMinutes,
        blacklist: Catalog.expandBlacklist(list.concat(list.indexOf(id) >= 0 ? [] : [id])),
      }).dishes;
      var withIt = Catalog.countAvailable({
        equipment: cfg.equipment, maxSpicy: cfg.maxSpicy,
        maxActiveMinutes: cfg.maxActiveMinutes,
        blacklist: Catalog.expandBlacklist(list.filter(function (x) { return x !== id; })),
      }).dishes;
      return withIt - withOut;
    }

    // 已经拉黑的:点 × 去掉
    if (list.length) {
      box.appendChild(h('div', { class: 'chips', style: 'margin-bottom:8px' },
        list.map(function (id) {
          var name = id.indexOf('@category:') === 0
            ? id.slice(10) + '(整类)'
            : id.indexOf('@allergen:') === 0
              ? id.slice(10) + ' 过敏(整组)'
              : ((Catalog.ingredient(id) || {}).name || id);
          return h('button', {
            type: 'button', 'aria-pressed': 'true',
            onclick: function () {
              save(list.filter(function (x) { return x !== id; }));
            },
          }, [name + ' ×']);
        })));
    } else {
      box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, ['还没设过']));
    }

    // 搜任何食材加进去
    box.appendChild(h('input', {
      type: 'text', placeholder: '搜食材加进来…… 羊肉 / 香菜 / 内脏', value: blQ,
      oninput: function (e) { blQ = e.target.value.trim(); renderBlHits(cfg); },
    }));
    box.appendChild(h('div', { id: 'blhits', style: 'margin-top:6px' }));

    // 常见的几个快选(已经在列表里的不再显示)
    var quick = Catalog.commonDislikes().filter(function (d) { return list.indexOf(d.id) < 0; });
    if (quick.length && !blQ) {
      box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, ['常见的:']));
      box.appendChild(h('div', { class: 'chips' }, quick.map(function (d) {
        return h('button', {
          type: 'button',
          onclick: function () { save(list.concat([d.id])); },
        }, ['+ ' + d.name]);
      })));
    }
    return box;
  }

  function renderBlHits(cfg) {
    var host = el.querySelector('#blhits');
    if (!host) return;
    host.innerHTML = '';
    if (!blQ) return;
    var list = (cfg.blacklist || []);
    var groups = Search.findGroups(blQ);
    var r = Search.find(blQ, null, 10);
    if (!r.total && !groups.length) {
      host.appendChild(h('div', { class: 'hint' }, ['没找到「' + blQ + '」']));
      return;
    }
    if (groups.length) {
      host.appendChild(h('div', { class: 'hint' }, ['整类:']));
      host.appendChild(h('div', { class: 'chips', style: 'margin-bottom:8px' },
        groups.map(function (g) {
          var on = list.indexOf(g.id) >= 0;
          return h('button', {
            type: 'button', 'aria-pressed': String(on),
            onclick: function () {
              var next = on ? list.filter(function (x) { return x !== g.id; })
                            : list.concat([g.id]);
              saveConfig({ blacklist: next });
            },
          }, [(on ? '✓ ' : '+ ') + g.name +
              (g.kind === 'allergen' ? ' 过敏' : '') + '(' + g.count + ' 种)']);
        })));
    }
    if (!r.total) return;
    host.appendChild(h('div', { class: 'chips' }, r.hits.map(function (i) {
      var on = list.indexOf(i.id) >= 0;
      var al = Search.matchedAlias(i, blQ);
      return h('button', {
        type: 'button', 'aria-pressed': String(on),
        onclick: function () {
          var next = on ? list.filter(function (x) { return x !== i.id; })
                        : list.concat([i.id]);
          saveConfig({ blacklist: next });
        },
      }, [(on ? '✓ ' : '+ ') + i.name + (al ? '(' + al + ')' : '')]);
    })));
  }

  function kitchenSection() {
    var cfg = config();
    var box = h('div', { class: 'card' });
    var c = Catalog.countAvailable({
      equipment: cfg.equipment,
      blacklist: Catalog.expandBlacklist(cfg.blacklist),
      maxSpicy: cfg.maxSpicy, maxActiveMinutes: cfg.maxActiveMinutes,
    });

    var marg = Catalog.equipmentMarginal(cfg);
    box.appendChild(row('厨具',
      chips(marg.map(function (m) {
              return { id: m.name,
                       label: m.name + (m.owned ? ' −' + m.delta : ' +' + m.delta) };
            }),
            function (it) { return (cfg.equipment || []).indexOf(it.id) >= 0; },
            function (it) {
              var list = (cfg.equipment || []).slice();
              var i = list.indexOf(it.id);
              if (i >= 0) list.splice(i, 1); else list.push(it.id);
              saveConfig({ equipment: list });
            }),
      '数字是**边际**的:没勾的写「加上能多做几道」,勾了的写「去掉会少几道」。' +
      '不是「有多少道菜点名要它」—— 那个数会骗人,不粘锅名义挂 79 道,但炒锅几乎全能顶,实际只多 3 道。'));

    var buy = marg.filter(function (m) { return !m.owned; }).slice(0, 3);
    if (buy.length) {
      box.appendChild(h('div', { class: 'note' }, [
        '要添东西的话按这个顺序:' +
        buy.map(function (m) { return m.name + ' +' + m.delta + ' 道'; }).join(' · ') +
        (buy[buy.length - 1].delta <= 3 ? '。最后那个提升很小,可以不买。' : '。'),
      ]));
    }

    box.appendChild(row('能吃多辣',
      seg(function () { return cfg.maxSpicy; }, function (v) { saveConfig({ maxSpicy: v }); },
          [{ v: 0, t: '不吃辣' }, { v: 1, t: '微辣' }, { v: 2, t: '中辣' }, { v: 3, t: '重辣' }])));

    box.appendChild(row('单顿动手时间上限',
      seg(function () { return cfg.maxActiveMinutes; },
          function (v) { saveConfig({ maxActiveMinutes: v }); },
          [{ v: 20, t: '20 分' }, { v: 30, t: '30 分' }, { v: 45, t: '45 分' }, { v: 999, t: '不限' }]),
      '算的是活跃时间 —— 焖煮的那段不占你的时间。单次想临时改,在新建记录时改就行'));

    box.appendChild(blacklistEditor(cfg));

    box.appendChild(h('div', { class: c.dishes < c.total * 0.25 ? 'note warn' : 'note' }, [
      '当前配置可做 ' + c.dishes + ' 道菜(共 ' + c.total + ' 道)· ' + c.variants + ' 个做法档位',
    ]));
    return box;
  }

  function dataSection() {
    var box = h('div', { class: 'card' });
    // 规格校准数只是个统计,不是功能入口 —— 所以放这儿一行,
    // 不再单开一个分区让人点进去发现「不用管这个」。
    var nCal = Object.keys(Store.get('packageOverrides', {}) || {}).length +
               (Store.get('userPackages', []) || []).length;
    var nWaste = (Store.get('wasteLog', []) || []).length;
    box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:10px' }, [
      '记录 ' + (Store.get('rounds', []) || []).length + ' 轮 · ' +
      '冰箱 ' + Pantry.items().length + ' 项 · ' +
      '调料 ' + ((Pantry.staples() || []).length) + ' 样 · ' +
      '浪费记了 ' + nWaste + ' 笔 · 规格校准过 ' + nCal + ' 条',
    ]));
    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-bottom:8px',
      onclick: function () {
        var blob = new Blob([JSON.stringify(Store.exportAll(), null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'mealplanner-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
      },
    }, ['导出备份']));
    box.appendChild(h('button', {
      class: 'btn ghost',
      onclick: function () {
        Modal.confirm({
          title: '清空所有数据重新开始?',
          body: '身体数据、库存、所有轮次记录、浪费记录 —— 全部删掉,不能撤销。' +
                '想留一份的话先点上面的「导出备份」。',
          ok: '我确定,清空', danger: true,
        }).then(function (ok) {
          if (!ok) return;
          Store.keys().forEach(function (k) { Store.remove(k); });
          location.reload();
        });
      },
    }, ['清空重来']));
    box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' },
      ['数据只存在这台设备的浏览器里。换设备或清缓存前记得导出。']));
    return box;
  }

  // ---------------- 页面 ----------------

  var SECTIONS = [
    { id: 'body',    title: '身体数据与目标', render: bodySection },
    { id: 'kitchen', title: '厨房与口味',     render: kitchenSection },
    { id: 'data',    title: '数据',           render: dataSection },
  ];

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['我的']));
    w.appendChild(targetsCard());

    SECTIONS.forEach(function (s) {
      w.appendChild(h('button', {
        class: 'btn ghost', style: 'margin-bottom:8px;text-align:left',
        onclick: function () { section = (section === s.id ? null : s.id); render(); },
      }, [(section === s.id ? '▾ ' : '▸ ') + s.title]));
      if (section === s.id) w.appendChild(s.render());
    });

    w.appendChild(h('div', { class: 'note', style: 'margin-top:8px' }, [
      '**调味料不在这里,在「库存」。** 判据是会不会被吃掉:' +
      '厨具不消耗,归这里;调料会慢慢用完、要提醒补货,归库存。',
    ]));
    el.appendChild(w);
    if (section === 'kitchen' && blQ) renderBlHits(config());
  }

  function mount(node, opts) { el = node; onNav = (opts || {}).onOpenPkg; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = SettingsUI;
