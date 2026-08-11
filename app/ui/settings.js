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

  // ⚠️ 写存储一律走 core —— 界面还要为小程序重写一遍,
  //    写存储的代码留在渲染层就得写两份。check.sh 有一条 grep 守着。
  function saveProfile(patch) { Profile.save(patch); render(); }
  function saveConfig(patch) { Profile.saveConfig(patch); render(); }

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

  /** 长期配置 → 求解器/目录用的约束对象。
   *
   * ⚠️ **只此一处**。以前 kitchenSection 和 costOf 各自手抄一份字段列表,
   *    结果新加的 maxDifficulty / maxIdleWait / allowOvernight 谁都没补上,
   *    「当前配置可做 N 道」永远不变。手抄的字段列表一定会漏。
   *    (Round.effectiveConstraints 做的是同一件事,只是多一层单轮覆盖。) */
  function constraintsOf(cfg) {
    return {
      equipment: cfg.equipment,
      blacklist: Catalog.expandBlacklist(cfg.blacklist),
      maxSpicy: cfg.maxSpicy,
      maxActiveMinutes: cfg.maxActiveMinutes,
      maxDifficulty: cfg.maxDifficulty,
      maxIdleWait: cfg.maxIdleWait,
      allowOvernight: cfg.allowOvernight,
    };
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
    // ⚠️ 改版前这五行**字号完全一样** —— 「每日 1814 kcal」和脚注里的
    //    「基础代谢 1649」长得一模一样,眼睛没有任何落点。
    //    这一屏只有一个数是你真正想看的,它就该比别的大。
    box.appendChild(h('div', { class: 'xs dim' }, ['每日目标']));
    box.appendChild(h('div', { class: 'num' }, [d.kcal + ' kcal']));
    box.appendChild(h('div', { class: 'sm-t dim', style: 'margin-top:4px' },
      ['蛋白 ' + d.protein + 'g · 蔬菜 ' + d.veg + 'g']));

    box.appendChild(h('div', {
      style: 'margin-top:16px;padding-top:16px;border-top:1px solid var(--border)',
    }, [
      h('div', { class: 'xs dim' }, ['要排的每一顿']),
      h('div', { style: 'font-weight:600;margin-top:4px' },
        [pm.kcal + ' kcal · 蛋白 ' + pm.protein + 'g']),
      h('div', { class: 'hint' }, [pm.note]),
    ]));

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
        Profile.logWeight(v);
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
      // 同样走 constraintsOf —— 这里以前也在手抄字段,漏的和上面那处一样
      var withOut = Catalog.countAvailable(Object.assign({}, constraintsOf(cfg), {
        blacklist: Catalog.expandBlacklist(list.concat(list.indexOf(id) >= 0 ? [] : [id])),
      })).dishes;
      var withIt = Catalog.countAvailable(Object.assign({}, constraintsOf(cfg), {
        blacklist: Catalog.expandBlacklist(list.filter(function (x) { return x !== id; })),
      })).dishes;
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
    box.appendChild(h('div', { id: 'blhits', style: 'margin-top:8px' }));

    // 常见的几个快选(已经在列表里的不再显示)
    var quick = Catalog.commonDislikes().filter(function (d) { return list.indexOf(d.id) < 0; });
    if (quick.length && !blQ) {
      box.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, ['常见的:']));
      box.appendChild(h('div', { class: 'chips' }, quick.map(function (d) {
        return h('button', {
          type: 'button',
          // 一个芯片可以带出一组 id(「和面」= 三种面粉)—— 不然用户得自己搜三次
          onclick: function () { save(list.concat(d.ids || [d.id])); },
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
    // ⚠️ **约束项必须全传**,漏一条这个数字就是死的。
    //    早先只传了 equipment / blacklist / maxSpicy / maxActiveMinutes 四项,
    //    于是你改难度、改空等、改隔夜,「当前配置可做 375 道」纹丝不动 ——
    //    看起来像这几条设置没生效(实际求解器是认的,只有这个计数器瞎了)。
    //    这比不显示还糟:它在用一个假数字告诉你「你的选择没有代价」。
    //
    //    抽成函数,别在这儿手抄字段列表 —— 手抄迟早再漏一条。
    var c = Catalog.countAvailable(constraintsOf(cfg));

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

    // ⚠️ 这一条以前界面上**没有**,而求解器一直在用 —— cfg.maxDifficulty 是
    //    undefined,Catalog 那行 `if (cfg.maxDifficulty != null)` 整条跳过。
    //    结果难度 5 的松鼠鳜鱼、天妇罗全套、手擀面一直在往外排。
    //    这是「一个人绝对不会做」那类菜最直接的闸门,比按食材拉黑准得多。
    box.appendChild(row('愿意做多难的',
      seg(function () { return cfg.maxDifficulty; },
          function (v) { saveConfig({ maxDifficulty: v }); },
          [{ v: 2, t: '只要简单的' }, { v: 3, t: '中等' },
           { v: 4, t: '有点挑战' }, { v: 5, t: '不限' }]),
      '难度 4 以上是灌汤包、天妇罗全套、松鼠鳜鱼这类。' +
      '**有省事档的菜不会整道消失,只会降级** —— 比如钟水饺从「手工包」降成「买速冻的」。'));

    // ⚠️ 「等」有两种,分开设才有意义:
    //    守着的等(炒/煎/看火)已经在上面那条里;这条管的是**能走开的等** ——
    //    焖饭那 35 分钟你可以去洗澡回消息,只是开饭推后。
    //    合成一条「多久能吃上」的话,焖饭和一道守着炒 80 分钟的菜会被同等对待。
    box.appendChild(row('最多能等多久(不用守着)',
      seg(function () { return cfg.maxIdleWait; },
          function (v) { saveConfig({ maxIdleWait: v }); },
          [{ v: 30, t: '30 分' }, { v: 60, t: '1 小时' }, { v: 120, t: '2 小时' },
           { v: 240, t: '4 小时' }, { v: 99999, t: '不限' }]),
      '焖 / 炖 / 烤 / 腌的空等,加上提前泡发的时间。' +
      '**周末可以放宽,下班饿着就调小。**库里 91 个变体是「动手很短但要等很久」,' +
      '从焖饭(等 55 分)一直到醉蟹(等 4 天)'));

    box.appendChild(row('接受隔夜准备吗',
      seg(function () { return cfg.allowOvernight !== false; },
          function (v) { saveConfig({ allowOvernight: v }); },
          [{ v: false, t: '不接受' }, { v: true, t: '可以' }]),
      '泡豆要泡一晚、腌隔夜的酱牛肉 —— 这类共 19 个变体。选「不接受」就不给你排。' +
      '注意「隔夜更佳」那种不算 —— 那是可选的,不会被拦'));

    // ⚠️ 这一条是「为什么家里全是调味料」的闸门。
    //    求解器原来只有一个 −4 的扣分,而**新口味加分是 +8** ——
    //    用新调料的菜平均带 1.59 个口味标签,不用的只有 1.15,
    //    于是「买瓶新的」净赚 4 分,每周都有动力去挑要新调料的菜。
    //    半年模拟下来调料柜从 7 味涨到 60 味,每瓶用过一两次。
    //
    //    扣分只能让它「不容易被选中」,拦不住。这条是硬闸。
    box.appendChild(row('每次最多买几味新调料',
      seg(function () {
            return cfg.newSeasoningBudget === undefined ? 1 : cfg.newSeasoningBudget;
          },
          function (v) { saveConfig({ newSeasoningBudget: v }); },
          [{ v: 0, t: '一味都不买' }, { v: 1, t: '1 味' },
           { v: 2, t: '2 味' }, { v: null, t: '不限' }]),
      '**手上 7 味基础调料就能做 87 道菜,一周 4 顿够吃五个月。**' +
      '不设上限的话,半年下来柜子里会有 60 来瓶,大部分只用过一两次 —— ' +
      '浪费从冰箱搬到了柜子里。选「一味都不买」时,开头一两轮可能还是会买一两瓶' +
      '(手上实在凑不出一周的菜),之后就稳住了。'));

    box.appendChild(blacklistEditor(cfg));

    box.appendChild(h('div', { class: c.dishes < c.total * 0.25 ? 'note warn' : 'note' }, [
      '当前配置可做 ' + c.dishes + ' 道菜(共 ' + c.total + ' 道)· ' + c.variants + ' 个做法档位',
    ]));
    return box;
  }

  /**
   * 统计 —— **诊断式,不做称号**(FEATURES 第 28 条)。
   *
   * ⚠️ 第 26 条:**每个指标背后要能接一个动作**。
   *    「累计做了 47 道菜」接不上任何动作,是虚荣指标,看两次就腻 —— 不做。
   *    这里每条要么给一个能点的动作,要么就只是陈述一句,不占地方。
   *
   * ⚠️ 第 27 条:冷启动别给空页面,给**进度**。
   *    但「别给空页面」不等于「可以给假结论」—— 一两轮数据也能算出
   *    「叶菜浪费 100%」这种漂亮数字。所以没到样本量的**一个数都不给**,
   *    只说还差几条。半成品的结论比没有更糟:你会照着它改设置。
   */
  function statsSection() {
    var box = h('div', {});
    var list = Stats.all();
    var ready = list.filter(function (o) { return o.ready; });

    if (!ready.length) {
      box.appendChild(h('div', { class: 'note' }, [
        '还没有够得着结论的数据。**做完一轮、顺手评几下**,这里就开始有东西了 —— ' +
        '不够的时候我不会硬凑一个数给你。',
      ]));
    }

    var ul = h('div', { class: 'list' });
    list.forEach(function (o) {
      var row = h('div', { class: 'list-row', style: 'flex-wrap:wrap' });
      row.appendChild(h('div', { class: 'body', style: 'flex:1 0 100%' }, [
        h('div', { class: 'ttl' }, [o.title]),
        h('div', { class: 'sub2', style: o.level === 'warn' ? 'color:var(--warn)' : '' }, [
          o.ready ? o.detail : '还差 ' + (o.need - o.have) + ' 条就能看',
        ]),
      ]));
      if (o.ready && o.action) {
        row.appendChild(h('div', {
          class: 'note' + (o.level === 'warn' ? ' warn' : ''),
          style: 'flex:1 0 100%;margin-top:8px',
        }, [o.action]));
      }
      // 能一键做掉的,就给个按钮 —— 这才是「指标接得上动作」的意思
      if (o.actionKind === 'exclude' && (o.payload || []).length) {
        row.appendChild(h('button', {
          class: 'btn ghost sm', style: 'flex:1 0 100%;margin-top:8px',
          onclick: function () {
            var cur = config().excludeRecipeIds || [];
            var add = o.payload.filter(function (id) { return cur.indexOf(id) < 0; });
            if (!add.length) return;
            saveConfig({ excludeRecipeIds: cur.concat(add) });
            Modal.note({ title: '排除了 ' + add.length + ' 道',
                         body: '以后不会再排到它们。想改回来去「厨房与口味」。' });
          },
        }, ['把这 ' + o.payload.length + ' 道排除掉']));
      }
      ul.appendChild(row);
    });
    box.appendChild(ul);
    return box;
  }

  function dataSection() {
    var box = h('div', { class: 'card' });
    // 规格校准数只是个统计,不是功能入口 —— 所以放这儿一行,
    // 不再单开一个分区让人点进去发现「不用管这个」。
    var nCal = Object.keys(Store.get('packageOverrides', {}) || {}).length +
               (Store.get('userPackages', []) || []).length;
    var nWaste = (Store.get('wasteLog', []) || []).length;
    box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:12px' }, [
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
    // ---- 导入 ----
    //
    // ⚠️ `Store.importAll` **早就写好了,界面上从来没接上** —— 又一个。
    //    而旁边就摆着「清空重来」:**能删不能恢复**,这是最危险的组合。
    //    换手机、清缓存、误点清空 —— 任何一个都能让你几个月的记录消失。
    //
    // ⚠️ 导入是这个 app 里唯一一个**不可撤销**的写操作。所以:
    //    先验、再把「要盖掉什么」摆出来、最后才写。
    function doImport(text) {
      var payload;
      try { payload = JSON.parse(text); }
      catch (e) { Modal.note({ title: '读不了这份文件', body: '不是合法的 JSON。' }); return; }
      var chk = Store.inspectImport(payload);
      if (!chk.ok) {
        Modal.note({ title: '这份备份用不了', body: chk.why });
        return;
      }
      var cur = {
        rounds: (Store.get('rounds', []) || []).length,
        pantry: Pantry.items().length,
      };
      var s2 = chk.summary;
      // Modal.hint/body 按 \n 断行(style.css 里 white-space: pre-line)。
      // ⚠️ 这里用 String.fromCharCode(10) 而不是字面反斜杠 n ——
      //    这个仓库里已经有五六次因为 heredoc 吃掉反斜杠而写出真换行、
      //    直接把文件写成语法错误。绕开它。
      var BR = String.fromCharCode(10);
      Modal.confirm({
        title: '用这份备份覆盖现在的数据?',
        body: '备份里:' + s2.rounds + ' 轮记录 · 冰箱 ' + s2.pantry + ' 项 · ' +
              '调料 ' + s2.staples + ' 样 · 浪费 ' + s2.waste + ' 笔' +
              (s2.at ? BR + '导出于 ' + s2.at.slice(0, 10) : '') +
              BR + BR + '现在这台设备上:' + cur.rounds + ' 轮记录 · 冰箱 ' +
              cur.pantry + ' 项。' +
              BR + '**这些会被全部替换掉,不能撤销。**',
        ok: '覆盖', danger: true,
      }).then(function (ok) {
        if (!ok) return;
        try {
          Store.importAll(payload);
          location.reload();
        } catch (e) {
          Modal.note({ title: '导入失败', body: e.message });
        }
      });
    }

    var fileIn = h('input', {
      type: 'file', accept: 'application/json,.json',
      style: 'display:none',
      onchange: function (e) {
        var f = e.target.files && e.target.files[0];
        if (!f) return;
        var fr = new FileReader();
        fr.onload = function () { doImport(String(fr.result)); };
        fr.readAsText(f);
      },
    });
    box.appendChild(fileIn);
    box.appendChild(h('button', {
      class: 'btn ghost', style: 'margin-bottom:8px',
      onclick: function () { fileIn.click(); },
    }, ['导入备份']));

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
    { id: 'stats',   title: '看看数据说什么',  render: statsSection },
    { id: 'data',    title: '数据',           render: dataSection },
  ];

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });
    w.appendChild(h('h1', {}, ['我的']));
    w.appendChild(targetsCard());

    // ⚠️ 三个分区原来是三个 .btn ghost —— 整宽、实心边框、48px 高,
    //    三个堆在一起像三个主操作在抢你点哪个。它们是**导航**,不是操作。
    var nav = h('div', { class: 'list', style: 'margin-top:16px' });
    SECTIONS.forEach(function (s) {
      nav.appendChild(h('div', {
        class: 'list-row',
        onclick: function () { section = (section === s.id ? null : s.id); render(); },
      }, [
        h('div', { class: 'body' }, [h('div', { class: 'ttl' }, [s.title])]),
        h('span', { class: 'dim' }, [section === s.id ? '▴' : '▸']),
      ]));
      if (section === s.id) nav.appendChild(h('div', { style: 'padding:0 16px 16px' },
                                              [s.render()]));
    });
    w.appendChild(nav);

    // ⚠️ 这儿原来是一段**设计理由**(「判据是会不会被吃掉:厨具不消耗…」)——
    //    那是我当初怎么划分的心路,不是你此刻需要知道的。
    //    你需要的只有一句:调料不在这页,去库存找。
    w.appendChild(h('div', { class: 'hint', style: 'margin-top:16px;text-align:center' }, [
      '找调味料?在「库存 → 调料柜」',
    ]));

    // ---- 版本 ----
    //
    // ⚠️ 加到主屏之后**没有地址栏可以下拉刷新**,而 Service Worker
    //    会把旧版本一直端给你 —— 表现是「明明改了怎么还是老样子」,
    //    而你唯一能想到的办法是删掉图标重装(那会连数据一起清掉)。
    //    所以必须有一个「我就要最新版」的按钮,并且显示构建时间,
    //    让你能确认拿到的到底是哪一版。
    var build = null;
    try {
      var m = document.querySelector('meta[name="build"]');
      build = m && m.getAttribute('content');
    } catch (e) {}
    w.appendChild(h('div', { class: 'list', style: 'margin-top:24px' }, [
      h('div', { class: 'list-row', onclick: hardReload }, [
        h('div', { class: 'body' }, [
          h('div', { class: 'ttl' }, ['版本 ' + (build || '(未知)')]),
          h('div', { class: 'sub2' }, ['点一下强制拿最新版 · 不动你的数据']),
        ]),
        h('span', { class: 'dim' }, ['▸']),
      ]),
    ]));

    el.appendChild(w);
    if (section === 'kitchen' && blQ) renderBlHits(config());
  }

  /** 清掉 Service Worker 缓存再重载。
   *  ⚠️ **只清缓存,不碰 localStorage** —— 数据一个字节都不动。
   *     而且只清自己项目前缀的:CacheStorage 按 origin 共享,
   *     两个 PWA 都在 *.github.io 上,清光了会把另一个的离线缓存也删掉。 */
  function hardReload() {
    var done = function () { location.reload(true); };
    try {
      if (typeof caches === 'undefined') return done();
      caches.keys().then(function (names) {
        return Promise.all(names.filter(function (n) { return n.indexOf('mealplanner') === 0; })
                               .map(function (n) { return caches.delete(n); }));
      }).then(done, done);
    } catch (e) { done(); }
  }

  function mount(node, opts) { el = node; onNav = (opts || {}).onOpenPkg; render(); }

  return { mount: mount };
})();

if (typeof module !== 'undefined') module.exports = SettingsUI;
