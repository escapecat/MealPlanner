// 「本周」页 —— 一次做饭 = 一条记录。列表 + 右下角「+」新建。
//
// 这一层只做展示和事件绑定。默认值怎么来的问 Round.defaultsFrom,
// 约束怎么合并问 Round.effectiveConstraints。

var RoundsUI = (function () {

  var el, sheetOpen = false, draft = null, onOpenPkg = null, showBought = false;

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

  function rounds() { return Store.get('rounds', []) || []; }
  function saveRounds(rs) { Store.set('rounds', rs); }
  function config() { return Store.get('config', {}) || {}; }
  function saveConfig(patch) { Store.set('config', Object.assign(config(), patch)); }

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

      // ⚠️ 「今天饿着」和「周末有空」是每次都不一样的,这条最该出现在这儿。
      //    只放在设置页的话,改一次要跑去翻折叠面板,改完还得记得改回来。
      more.appendChild(h('div', { class: 'row' }, [
        h('label', { class: 'lab' }, [
          '最多能等多久(不用守着)· 平时是 ' +
          (cfg.maxIdleWait == null || cfg.maxIdleWait >= 9999 ? '不限'
            : cfg.maxIdleWait >= 60 ? (cfg.maxIdleWait / 60) + ' 小时' : cfg.maxIdleWait + ' 分钟'),
        ]),
        seg(function () { return draft.overrides.maxIdleWait; },
            function (v) {
              if (draft.overrides.maxIdleWait === v) delete draft.overrides.maxIdleWait;
              else draft.overrides.maxIdleWait = v;
            },
            [{ v: 20, t: '20 分' }, { v: 45, t: '45 分' }, { v: 120, t: '2 小时' },
             { v: 99999, t: '不限' }]),
        h('div', { class: 'hint' }, [
          '焖 / 炖 / 烤 / 腌的空等。**今天饿着就调小,周末有空就放开** —— 再点一次取消',
        ]),
      ]));

      more.appendChild(h('div', { class: 'row' }, [
        h('label', { class: 'lab' }, [
          '这次接受隔夜准备吗 · 平时是 ' + (cfg.allowOvernight ? '可以' : '不接受'),
        ]),
        seg(function () { return draft.overrides.allowOvernight; },
            function (v) {
              if (draft.overrides.allowOvernight === v) delete draft.overrides.allowOvernight;
              else draft.overrides.allowOvernight = v;
            },
            [{ v: false, t: '不接受' }, { v: true, t: '可以' }]),
        h('div', { class: 'hint' }, ['泡豆要泡一晚、腌隔夜的酱牛肉 —— 共 19 个变体']),
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

  function generate(r, silent) {
    var cfg = config();
    var cons = Round.effectiveConstraints(r, cfg);
    // 库存里已有的先扣掉,临期的必须排掉 —— 这两条是求解器的输入不是事后过滤
    var stock = {};
    Pantry.items().forEach(function (it) {
      stock[it.ingredientId] = (stock[it.ingredientId] || 0) + it.amount;
    });
    var nowIso = new Date().toISOString();
    var mustUse = Pantry.expiringSoon(3, nowIso).map(function (it) { return it.ingredientId; });

    // ⚠️ 这个 target 以前**从来没传过**。
    //    solver 里那条 `- short * 120` 的营养项(注释还写着「模拟 400 个场景发现
    //    热量达标率 15%」)因为拿不到 target,一直恒等于 0 —— 写了但没接上。
    //    结果就是排出「晚饭 = 400g 青菜 + 一碗饭,442 kcal」这种方案。
    var p = Store.get('profile', {}) || {};
    var wlog = Store.get('weightLog', []) || [];
    var kg = wlog.length ? wlog[wlog.length - 1].kg : null;
    var daily = Profile.dailyTargets(Object.assign({}, p, { weightKg: kg }));
    var target = daily ? Profile.perPlannedMeal(daily, p.breakfast) : null;

    var out = Solver.solve({
      servings: r.input.servings || r.input.meals,
      constraints: cons, stock: stock, mustUse: mustUse,
      target: target,
      stockDetail: Pantry.stockSummary(nowIso),   // 带紧迫度,放久的会被优先排掉
      // 冷却期 + 这一轮被「换掉」的菜。换掉了还排出来,那个按钮就等于没用。
      recentRecipeIds: Object.assign(recentIds(), excludedMap(r)),
    });
    if (!out.ok) {
      if (!silent) {
        Modal.note({
          title: '这次没排出来',
          body: '原因:' + (out.reason || '未知') + '。多半是约束太紧 —— ' +
                '把耗时上限放宽,或者少勾几样忌口再试。',
        });
      }
      return false;
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
                 missing: c.missing, cooked: false,
                 // 配菜:蔬菜不够的那顿配一道简单青菜。存 id + 档位就够,
                 // 食材现查(和主菜一样,派生数据不存两份)。
                 side: c.side ? { recipeId: c.side.recipeId, name: c.side.name,
                                  method: c.side.method, prepLevel: c.side.prepLevel,
                                  activeMinutes: c.side.activeMinutes,
                                  usesLeftover: !!c.side.usesLeftover } : null };
      }),
      freshWaste: out.wasteRatio,
      freshLeft: out.stage2.freshLeft, carryLeft: out.stage2.carryLeft,
      methodCount: out.stage2.methodCount,
    };
    rs[i].status = 'shopping';
    saveRounds(rs);
    render();
    return true;
  }

  /**
   * 改点什么再重新求解,**排不出来就整个撤销**。
   *
   * ⚠️ 换一道菜的代价不该是丢掉整个计划。
   *    第一版是「先删掉 solved,再求解」—— 要是新忌口把菜谱库卡死了,
   *    你就同时失去了旧计划和新计划,而且那条忌口还留在设置里,
   *    之后每次重新生成都会继续失败,根本看不出是哪一步造成的。
   */
  function resolveRound(id, mutate) {
    var beforeRounds = JSON.parse(JSON.stringify(rounds()));
    var beforeConfig = JSON.parse(JSON.stringify(config()));

    mutate();

    var rs = rounds();
    var k = rs.findIndex(function (x) { return x.id === id; });
    delete rs[k].solved;
    rs[k].status = 'planning';
    saveRounds(rs);

    if (generate(rs[k], true)) return true;

    Store.set('rounds', beforeRounds);
    Store.set('config', beforeConfig);
    render();
    Modal.note({
      title: '这样就排不出来了',
      body: '按新的条件,菜谱库里凑不齐这些顿。刚才那一下已经撤销 —— ' +
            '原来的计划和忌口都还在。\n\n' +
            '想换的话,可以先把耗时上限放宽,或者换个别的理由。',
    });
    return false;
  }

  /** 冷却期:最近两轮做过的菜不再排,免得连着吃同一道 */
  function recentIds() {
    var out = {};
    rounds().slice(-2).forEach(function (r) {
      (r.solved && r.solved.meals || []).forEach(function (m) { out[m.recipeId] = 1; });
    });
    return out;
  }

  /** 不该排的菜:这一轮被「换掉」的 + 设置里永久排除的 */
  function excludedMap(r) {
    var out = {};
    ((r.overrides || {}).excludeRecipeIds || []).forEach(function (id) { out[id] = 1; });
    (config().excludeRecipeIds || []).forEach(function (id) { out[id] = 1; });
    return out;
  }

  // ---------------- 菜要用什么 ----------------
  //
  // ⚠️ 不存进 solved,现查。
  //    菜谱的食材是**派生数据** —— 存一份进每一轮的记录,菜谱一改历史轮次就对不上,
  //    而且同一份数据在库里存了两遍。DESIGN 里那条「能从字典算出来的不许存在菜谱上」
  //    对这里同样成立。

  function variantOf(m) {
    var rec = RECIPES.filter(function (x) { return x.id === m.recipeId; })[0];
    if (!rec) return null;
    var v = (rec.variants || []).filter(function (x) { return x.prepLevel === m.prepLevel; })[0]
            || (rec.variants || [])[0];
    return v ? { recipe: rec, variant: v } : null;
  }

  /** 这道菜要哪些食材。
   *  用量就是菜谱写的量,不做换算 —— 求解器里一道菜 = 一份,份数是靠多排几道菜凑的。 */
  function mealIngredients(m) {
    var rv = variantOf(m);
    if (!rv) return [];
    return (rv.variant.ingredients || []).map(function (it) {
      var ing = INGREDIENTS.filter(function (x) { return x.id === it.ids[0]; })[0];
      return {
        id: it.ids[0],
        name: (it.names && it.names[0]) || (ing ? ing.name : it.ids[0]),
        alt: it.ids.length > 1,
        qty: it.qty, unit: it.unit || 'g', role: it.role,
        toTaste: it.toTaste,
      };
    });
  }

  /** 这道菜要哪些调料(用来回答「我不想买这瓶」) */
  function mealSeasonings(m) {
    var rv = variantOf(m);
    if (!rv) return [];
    return (rv.variant.seasonings || []).map(function (it) {
      var ing = INGREDIENTS.filter(function (x) { return x.id === it.ids[0]; })[0];
      return {
        id: it.ids[0],
        name: (it.names && it.names[0]) || (ing ? ing.name : it.ids[0]),
        have: it.ids.some(function (id) { return Pantry.hasStaple(id); }),
      };
    });
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

    // 没买的在上面,买了的沉到底下折叠起来 —— 在超市里要一眼看出还剩什么。
    // 做完的东西应该缩小让路,而不是因为多了个输入框反而变高。
    var todo = s.shopping.filter(function (x) { return !x.bought; });
    var done = s.shopping.filter(function (x) { return x.bought; });

    box.appendChild(h('div', { style: 'font-weight:600;margin:12px 0 4px' }, [
      todo.length ? '还要买 ' + todo.length + ' 样' : '都买齐了',
    ]));
    if (todo.length) {
      box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '克数是菜谱算出来的需求,拿最接近的规格就行',
      ]));
    }

    function shopRow(it, compact) {
      var card2 = h('div', {
        class: 'card',
        style: 'padding:' + (compact ? '8px 12px' : '10px 12px') + ';margin-bottom:6px' +
               (compact ? ';opacity:.6' : ''),
      });
      var head = h('div', { style: 'display:flex;gap:8px;align-items:center' });
      head.appendChild(h('button', {
        type: 'button',
        style: 'border:0;background:none;font-size:18px;cursor:pointer;padding:0;flex:0 0 auto',
        onclick: function () { toggleBought(r, it.ingredientId); },
      }, [it.bought ? '☑' : '☐']));

      if (compact) {
        // 买了的:一行搞定,点数字就能改
        head.appendChild(h('div', { style: 'flex:1' }, [
          h('span', { style: 'text-decoration:line-through' }, [it.name]),
          h('span', { class: 'hint' }, [
            '  ' + (it.actualGrams != null ? it.actualGrams : it.needGrams) + it.unit,
          ]),
        ]));
        head.appendChild(h('button', {
          class: 'btn ghost',
          style: 'width:auto;padding:3px 9px;font-size:11px;flex:0 0 auto',
          onclick: function () {
            Modal.ask({
              title: '实际买了多少 ' + it.name + '?',
              hint: '填实际称重的话,进库存的数就是准的,下一轮排菜也会跟着准。',
              type: 'number', suffix: it.unit,
              value: it.actualGrams != null ? it.actualGrams : (it.hintPack || it.needGrams),
              presets: it.hintPack ? [{ label: '就一包 ' + it.hintPack + it.unit,
                                        value: it.hintPack }] : null,
            }).then(function (v) {
              if (v == null) return;
              var n2 = parseFloat(v);
              if (!isNaN(n2)) setActual(r, it.ingredientId, n2);
            });
          },
        }, ['改']));
        card2.appendChild(head);
        var extra = (it.actualGrams != null ? it.actualGrams : it.needGrams) - it.needGrams;
        if (extra > 5) {
          card2.appendChild(h('div', { class: 'hint', style: 'margin-left:26px' }, [
            '剩 ' + Math.round(extra) + it.unit + ' 进库存',
          ]));
        }
        return card2;
      }

      head.appendChild(h('div', { style: 'flex:1' }, [
        h('div', { style: 'font-weight:600' }, [it.name + '  ' + it.needGrams + it.unit]),
        h('div', { class: 'hint' }, [
          (it.hintPack
            ? '常见 ' + it.hintPack + it.unit +
              (it.hintPacks > 1 ? ' × ' + it.hintPacks : '') + '(估的)'
            : '规格未知') +
          (it.tier === 'fresh' && it.shelfLifeDays ? ' · 冷藏 ' + it.shelfLifeDays + ' 天' : ''),
        ]),
      ]));
      if (it.hintPack) {
        // 这一条的规格准不准要紧吗?要紧的才提示 ——
        // 「一道菜用 30g、包装 300g」这种错 20% 会明显改变推荐;
        // 「一道菜用 250g、包装 300g」错一点无所谓。
        var worth = it.needGrams && it.hintPack && (it.hintPack - it.needGrams) / it.hintPack > 0.5;
        head.appendChild(h('button', {
          class: 'btn ghost',
          style: 'width:auto;padding:4px 8px;font-size:11px;flex:0 0 auto' +
                 (worth ? ';border-color:var(--warn);color:var(--warn)' : ''),
          onclick: function () {
            Modal.ask({
              title: '这包 ' + it.name + ' 实际是多少?',
              hint: '看包装上写的净含量。改了以后排菜会更准,不改也不影响这次记账。',
              type: 'number', suffix: it.unit, value: it.hintPack, ok: '就按这个算',
            }).then(function (v) {
              if (v == null) return;
              var n3 = parseFloat(v);
              if (isNaN(n3) || n3 <= 0) return;
              savePkgCorrection(it.ingredientId, n3, it.unit);
              render();
            });
          },
        }, [worth ? '规格?' : '规格不对?']));
      }
      card2.appendChild(head);
      if (worth) {
        card2.appendChild(h('div', { class: 'hint', style: 'margin-left:26px;color:var(--warn)' }, [
          '这次只用 ' + it.needGrams + it.unit + ',按 ' + it.hintPack + it.unit +
          ' 买会剩不少 —— 实际规格要是更小,顺手点一下改掉',
        ]));
      }
      return card2;
    }

    todo.forEach(function (it) { box.appendChild(shopRow(it, false)); });

    if (done.length) {
      box.appendChild(h('button', {
        class: 'btn ghost',
        style: 'margin-top:10px;margin-bottom:6px;font-size:13px;padding:7px',
        onclick: function () { showBought = !showBought; render(); },
      }, [(showBought ? '▾ ' : '▸ ') + '已买 ' + done.length + ' 样']));
      if (showBought) {
        done.forEach(function (it) { box.appendChild(shopRow(it, true)); });
        box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:6px' }, [
          '默认按需求量记进库存了。买多了的话点「改」填实际克数,多的会算成结转。',
        ]));
      }
    }

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

    // ⚠️ 按**该吃的顺序**分天,不是求解器挑中的顺序。
    //    早先这里就是数组下标 1/2/3/4 —— 你可能第 4 天才吃那条冷藏 1 天的鱼。
    //    排期不写回存储:它能从保质期算出来,存下来就会变成对不上的旧账。
    var plan = Schedule.assign(s.meals, r.input.days, r.input.perDay);

    box.appendChild(h('div', { style: 'font-weight:600;margin:14px 0 6px' }, ['做这些']));
    Schedule.warnings(plan).forEach(function (t) {
      box.appendChild(h('div', { class: 'note warn', style: 'margin-bottom:8px' }, [t]));
    });

    // ⚠️ 必须说清「一道菜 = 一顿」。
    //    早先只给了「第 1 天」+「1. 2.」的编号,第一天两道菜到底是一顿两个菜、
    //    还是两顿,页面上没有任何一个字回答 —— 而这是看懂整页的前提。
    box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
      '**一道菜 = 一顿。**你选了 ' + r.input.days + ' 天 × 每天 ' + r.input.perDay +
      ' 顿 = ' + (r.input.days * r.input.perDay) + ' 顿' +
      (r.input.diners > 1 ? '(' + r.input.diners + ' 人份)' : '') +
      '。顺序按最容易坏的先吃排,时间是估的。',
    ]));

    var lastDay = null;
    plan.forEach(function (p, i) {
      if (p.day !== lastDay) {
        box.appendChild(h('div', {
          style: 'font-weight:600;font-size:14px;margin:14px 0 4px;' +
                 'padding-top:10px;border-top:1px solid var(--border)',
        }, ['第 ' + p.day + ' 天']));
        lastDay = p.day;
      }
      box.appendChild(mealCard(r, p.meal, i, p, slotLabel(p.slot, r.input.perDay)));
    });

    box.appendChild(nextStep(r));
    return box;
  }

  /**
   * 下一步干什么 —— **每个状态都必须有且只有一个主按钮。**
   *
   * ⚠️ 早先这里只有「重新生成」和「删除」两个灰按钮。
   *    Round 的状态机本来就有 planning → shopping → cooking → done 四档,
   *    但 UI 从来没驱动过后两档 —— 生成完就卡在 shopping,
   *    页面上唯一能点的是「重新生成」和「删除」,于是看起来像「做完了?那就删了吧」。
   *    状态机里有 UI 到不了的状态,等于流程断在最关键的地方。
   */
  function nextStep(r) {
    var box = h('div', { style: 'margin-top:14px' });
    var s = r.solved;

    function setStatus(st) {
      var rs = rounds();
      var k = rs.findIndex(function (x) { return x.id === r.id; });
      rs[k].status = st;
      if (st === 'done') rs[k].finishedAt = new Date().toISOString();
      saveRounds(rs); render();
    }

    if (r.status === 'shopping') {
      var left = (s.shopping || []).filter(function (x) { return !x.bought; }).length;
      box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        left ? '在超市边买边勾。买完了点下面开始做饭。'
             : '都买齐了 —— 可以开做了。',
      ]));
      box.appendChild(h('button', {
        class: 'btn', onclick: function () { setStatus('cooking'); },
      }, [left ? '买齐了,开始做饭(还有 ' + left + ' 样没勾)' : '开始做饭']));
    } else if (r.status === 'cooking') {
      var meals = s.meals || [];
      var cooked = meals.filter(function (x) { return x.cooked; }).length;
      box.appendChild(h('div', { class: 'hint', style: 'margin-bottom:8px' }, [
        '做完一道点一下「做了」—— 用掉的食材会自动从冰箱扣掉。' +
        (cooked ? '  已经做了 ' + cooked + '/' + meals.length + '。' : ''),
      ]));
      box.appendChild(h('button', {
        class: 'btn', onclick: function () {
          var skipped = meals.length - cooked;
          Modal.confirm({
            title: '这一轮就到这儿?',
            body: cooked === meals.length
              ? '排的 ' + meals.length + ' 顿全做了。'
              : '排了 ' + meals.length + ' 顿,做了 ' + cooked + ' 顿,还有 ' + skipped +
                ' 顿没做。\n\n没做的会如实记下来 —— 连着两轮做不完,下次会自动少排几天。',
            ok: '结束这一轮',
          }).then(function (ok) { if (ok) setStatus('done'); });
        },
      }, [cooked === meals.length && meals.length ? '全做完了,结束这一轮' : '结束这一轮']));
    } else if (r.status === 'done') {
      var done2 = (s.meals || []).filter(function (x) { return x.cooked; }).length;
      box.appendChild(h('div', { class: 'note' }, [
        '这一轮结束:排 ' + (s.meals || []).length + ' 顿,做了 ' + done2 + ' 顿。' +
        '冰箱里剩下的东西下一轮会优先排掉。',
      ]));
    }
    return box;
  }

  // ---------------- 菜卡 ----------------

  /** 第几顿叫什么。每天几顿不同,叫法也不同 —— 一天一顿就不该硬叫「午饭」。 */
  function slotLabel(slot, perDay) {
    if (perDay <= 1) return null;
    if (perDay === 2) return ['午饭', '晚饭'][slot - 1] || ('第 ' + slot + ' 顿');
    if (perDay === 3) return ['早饭', '午饭', '晚饭'][slot - 1] || ('第 ' + slot + ' 顿');
    return '第 ' + slot + ' 顿';
  }

  function mealCard(r, m, i, sched, slot) {
    var cooking = r.status === 'cooking' || r.status === 'done';
    var rv = variantOf(m);
    var card = h('div', { class: 'card', style: 'padding:10px 12px;margin-bottom:6px' +
                                                (m.cooked ? ';opacity:.55' : '') });

    var head = h('div', { style: 'display:flex;gap:8px;align-items:baseline' });
    head.appendChild(h('div', { style: 'flex:1' + (m.cooked ? ';text-decoration:line-through' : '') },
      [(slot ? slot + ' · ' : '') + m.name +
       (m.prepLevel !== 'scratch' ? '(' + m.prepLevel + ')' : '')]));
    card.appendChild(head);

    // ⚠️ **先说多久能吃上,再说动手多久。**
    //    你要决定的是「今天来不来得及做这个」,那是 eatIn;
    //    动手分钟回答的是「累不累」,是第二位的。
    //    而且库里的「总分钟」不含提前准备 —— 木耳炒蛋写 20 分,
    //    实际要先泡发 30 分钟,真正能吃上是 50 分。214 个变体有这个坑。
    var sv0 = m.side ? variantOf(m.side) : null;
    var tm = Timing.ofMeal(rv && rv.variant, sv0 && sv0.variant);
    card.appendChild(h('div', { class: 'hint' }, [
      m.method + ' · **' + Timing.fmt(tm.eatIn) + '能吃上** = 动手 ' + tm.active +
      ' 分' + (tm.idle ? ' + 等 ' + Timing.fmt(tm.idle) : '') +
      ' 估 · 难度 ' + m.difficulty,
    ]));

    // 提前准备必须显眼 —— 「米泡20分钟」你要是开火前才看到就已经晚了。
    var note0 = Timing.startNote(tm);
    if (note0) {
      // ⚠️ 说清楚**这段可以提前做**,别让人以为要干等着。
      //    腌 30 分钟不需要你守着,而且完全可以在做上一顿的时候顺手腌上 ——
      //    盐焗鸡腿这类「动手 15 分、等 2 小时」的菜其实最省事,
      //    可页面上只写「1 小时 30 分能吃上」的话,看着就像个大工程。
      card.appendChild(h('div', {
        class: 'note warn', style: 'margin-top:8px',
      }, [tm.overnight ? note0
          : (tm.aheadText + ' —— 这段不用守着,' +
             '**做上一顿的时候顺手弄上**就不用等;从零开始的话提前 ' +
             Timing.fmt(tm.eatIn) + '动手')]));
    }

    var ings = mealIngredients(m);
    var nu = rv ? Nutrition.ofMeal(rv.variant) : null;
    if (ings.length) {
      var chips = ings.map(function (x) {
        var strong = x.role === 'main';
        return h('span', {
          style: 'font-size:12px;padding:2px 8px;border-radius:999px;' +
                 'border:1px solid var(--border);' +
                 (strong ? 'background:var(--accent-dim);color:var(--accent);font-weight:600'
                         : 'color:var(--text-dim)'),
        }, [x.name + (x.qty ? ' ' + x.qty + x.unit : (x.toTaste ? ' 适量' : '')) +
            (x.alt ? ' 或…' : '')]);
      });

      // ⚠️ 不带主食的菜要配一碗饭 —— 这件事早就在算了(Nutrition.ofMeal 补一份米,
      //    Solver 也把这份米加进了采购清单),**唯独没显示**。
      //    于是「宁式烤菜」在页面上看起来就是一整顿只吃 400g 青菜,当然诡异。
      //    nutrition.js 里那行注释写的就是「补了什么主食,UI 要显示出来」。
      if (nu && nu.staple) {
        chips.push(h('span', {
          style: 'font-size:12px;padding:2px 8px;border-radius:999px;' +
                 'border:1px dashed var(--border);color:var(--text-dim)',
        }, ['配 ' + nu.staple.name + ' ' + nu.staple.grams + 'g(生重)']));
      }
      card.appendChild(h('div', {
        style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:8px',
      }, chips));
    }

    if (nu) {
      var sideNu = m.side ? Nutrition.ofVariant((variantOf(m.side) || {}).variant || {}) : null;
      card.appendChild(h('div', { class: 'hint', style: 'margin-top:6px' }, [
        '约 ' + (nu.kcal + (sideNu ? sideNu.kcal : 0)) + ' kcal · 蛋白 ' +
        (nu.protein + (sideNu ? sideNu.protein : 0)) + 'g · 蔬菜 ' +
        (nu.veg + (sideNu ? sideNu.veg : 0)) + 'g' +
        (nu.selfContained ? ' · 自带主食' : ' · 已含那碗饭') +
        (m.side ? ' · 含配菜' : ''),
      ]));
    }

    // 配菜 —— 主菜蔬菜不够时配的。
    // ⚠️ 必须是**一道够简单的菜**(动手 ≤12 分、难度 ≤2、一口锅),
    //    不是再做一道正经菜。而且优先挑能吃掉剩料、包装规格又合适的 ——
    //    加了配菜之后浪费从 42% 降到 30%,不是涨上去。
    if (m.side) {
      var sv = variantOf(m.side);
      var sideBox = h('div', {
        style: 'margin-top:10px;padding:8px 10px;border-left:3px solid var(--accent);' +
               'background:var(--accent-dim);border-radius:0 8px 8px 0',
      });
      sideBox.appendChild(h('div', { style: 'font-size:13px' }, [
        '配 · ' + m.side.name,
        h('span', { class: 'hint', style: 'margin-left:8px' }, [
          m.side.method + ' ' + m.side.activeMinutes + ' 分' +
          (m.side.usesLeftover ? ' · 用得上剩料' : ''),
        ]),
      ]));
      if (sv) {
        sideBox.appendChild(h('div', {
          style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:5px',
        }, mealIngredients(m.side).map(function (x) {
          return h('span', {
            style: 'font-size:12px;padding:1px 7px;border-radius:999px;' +
                   'border:1px solid var(--border);color:var(--text-dim)',
          }, [x.name + (x.qty ? ' ' + x.qty + x.unit : '')]);
        })));
      }
      card.appendChild(sideBox);
    }

    // 备注只留做法提示 —— 建库笔记(「牺牲:…单位成本约为自炖的 2 倍」这类)
    // 在转换器里就分流进 devNote 了,界面拿不到。
    // 剩下几条长的是真做菜建议,折叠起来点开看,不按字数一刀切删掉。
    var note = (rv && rv.variant.note) || (rv && rv.recipe.note);
    if (note && note !== '—') {
      if (note.length <= 60) {
        card.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, ['· ' + note]));
      } else {
        var full = false;
        var nb = h('div', { class: 'hint', style: 'margin-top:8px;cursor:pointer' });
        var paint = function () {
          nb.innerHTML = '';
          nb.appendChild(Dom.text('· ' + (full ? note : note.slice(0, 56) + '…')));
          nb.appendChild(h('span', { style: 'color:var(--accent);margin-left:6px' },
                           [full ? '收起' : '展开']));
        };
        nb.addEventListener('click', function () { full = !full; paint(); });
        paint();
        card.appendChild(nb);
      }
    }

    // ⚠️ 调料也得列。早先卡片上只有一句「缺 3 样调料」——
    //    缺哪三样?要不要买?没说。而「不想为这道菜买一瓶鱼露」正是
    //    换掉一道菜最常见的理由,判断依据不能只给个数字。
    //    缺的标红,有的压暗 —— 一眼看出这道菜要不要额外花钱。
    var seas = mealSeasonings(m);
    if (seas.length) {
      var lack = seas.filter(function (x) { return !x.have; }).length;
      card.appendChild(h('div', { class: 'hint', style: 'margin-top:8px' }, [
        lack ? '调料 · 要买 ' + lack + ' 样' : '调料 · 都有',
      ]));
      card.appendChild(h('div', {
        style: 'display:flex;gap:5px;flex-wrap:wrap;margin-top:4px',
      }, seas.map(function (x) {
        return h('span', {
          style: 'font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid ' +
                 (x.have ? 'var(--border);color:var(--text-dim)'
                         : 'var(--warn);color:var(--warn);background:var(--warn-dim)'),
        }, [x.name + (x.have ? '' : ' 要买')]);
      })));
    }

    var acts = h('div', { style: 'display:flex;gap:6px;margin-top:10px;flex-wrap:wrap' });

    // ⚠️ 库里**没有做法步骤**,只有上面那一行备注。
    //    DESIGN 的定位是「食材流转管理器,不是菜谱推荐器」,不自己写 512 道菜的步骤
    //    是对的 —— 我写也是编的。但不写不等于不给出口,以前连出口都没有。
    acts.appendChild(h('a', {
      class: 'btn ghost',
      style: 'width:auto;padding:5px 12px;font-size:13px;text-decoration:none;' +
             'display:inline-block;text-align:center',
      href: 'https://www.xiachufang.com/search/?keyword=' + encodeURIComponent(m.name),
      target: '_blank', rel: 'noopener',
    }, ['搜做法 ↗']));

    if (!cooking) {
      acts.appendChild(h('button', {
        class: 'btn ghost', style: 'width:auto;padding:5px 12px;font-size:13px',
        onclick: function () { swapDish(r, m); },
      }, ['换掉这道']));
    } else {
      acts.appendChild(h('button', {
        class: 'btn ghost', style: 'width:auto;padding:5px 12px;font-size:13px' +
               (m.cooked ? '' : ';border-color:var(--accent);color:var(--accent)'),
        onclick: function () { toggleCooked(r, m.recipeId); },
      }, [m.cooked ? '↩ 没做' : '做了']));
    }
    card.appendChild(acts);

    if (sched && sched.driver) {
      card.appendChild(h('div', {
        class: 'hint', style: sched.urgent ? 'color:var(--danger)' : '',
      }, [sched.reason]));
    }
    return card;
  }

  /**
   * 换掉一道菜 —— **必须问为什么**。
   *
   * 直接换一道是最省事的做法,但那样系统什么也学不到:下一轮照样给你排竹笋。
   * 问一句「为什么」,答案就能直接变成忌口或者「别买这瓶」,越用越准。
   * 这是这个 app 唯一能变聪明的地方 —— 别的信息它都只能靠猜。
   */
  function swapDish(r, m) {
    var missing = mealSeasonings(m).filter(function (x) { return !x.have; });
    var opts = [
      { key: 'ing', label: '里面有我不吃的', hint: '选出来,以后都不给你排' },
    ];
    if (missing.length) {
      opts.push({ key: 'seas', label: '不想为它买调料',
                  hint: '要买 ' + missing.map(function (x) { return x.name; }).join(' · ') });
    }
    opts.push({ key: 'dish', label: '就是不想吃这道', hint: '食材没问题,单纯不想吃' });
    opts.push({ key: 'plain', label: '没什么原因,换一道就行',
                hint: '不记原因 —— 下一轮可能还会排到' });

    Modal.pick({ title: '换掉「' + m.name + '」', hint: '说一句为什么,以后就不用再换了。',
                 options: opts }).then(function (why) {
      if (!why) return;
      if (why === 'plain') return applySwap(r, m, null, null);

      if (why === 'dish') {
        return askScope('以后还给你排「' + m.name + '」吗?', {
          onceLabel: '就这次不做', foreverLabel: '这道菜以后都别排',
        }).then(function (scope) {
          if (!scope) return;
          applySwap(r, m, null, scope === 'forever' ? { recipe: m.recipeId } : null);
        });
      }

      var pool = why === 'ing'
        ? mealIngredients(m).map(function (x) { return { key: x.id, label: x.name,
            hint: x.role === 'main' ? '主料' : (x.role === 'staple' ? '主食' : '配料') }; })
        : missing.map(function (x) { return { key: x.id, label: x.name, hint: '这瓶要另买' }; });

      Modal.pick({
        title: why === 'ing' ? '哪样不吃?' : '哪瓶不想买?',
        hint: why === 'ing'
          ? '拉黑之后,所有用到它的菜都不会再排 —— 「或」组里还有别的选择的不受影响。'
          : '拉黑之后,非它不可的菜就不排了。',
        options: pool,
      }).then(function (id) {
        if (!id) return;
        var name = pool.filter(function (p) { return p.key === id; })[0].label;
        askScope('以后都不吃「' + name + '」吗?', {
          onceLabel: '只是这次不想要', foreverLabel: '以后都别给我排',
        }).then(function (scope) {
          if (!scope) return;
          applySwap(r, m, { id: id, scope: scope }, null);
        });
      });
    });
  }

  function askScope(title, o) {
    return Modal.pick({
      title: title,
      options: [
        { key: 'forever', label: o.foreverLabel, hint: '写进忌口,设置里能改回来' },
        { key: 'once', label: o.onceLabel, hint: '只影响这一轮' },
      ],
    });
  }

  /**
   * @param ban   {id, scope} 要拉黑的食材/调料
   * @param dish  {recipe} 永久不排这道菜
   * 落库之后立刻重新生成 —— 换掉了却还得自己去点「重新生成」,那不叫换掉。
   */
  function applySwap(r, m, ban, dish) {
    resolveRound(r.id, function () {
      var rs = rounds();
      var k = rs.findIndex(function (x) { return x.id === r.id; });
      var ov = rs[k].overrides = rs[k].overrides || {};

      // 换掉的这道,本轮一定不再排
      ov.excludeRecipeIds = (ov.excludeRecipeIds || []).concat([m.recipeId]);
      saveRounds(rs);

      if (ban && ban.scope === 'once') {
        var rs2 = rounds();
        var k2 = rs2.findIndex(function (x) { return x.id === r.id; });
        rs2[k2].overrides.blacklistAdd =
          (rs2[k2].overrides.blacklistAdd || []).concat([ban.id]);
        saveRounds(rs2);
      } else if (ban) {
        saveConfig({
          blacklist: Catalog.expandBlacklist((config().blacklist || []).concat([ban.id])),
        });
      }
      if (dish && dish.recipe) {
        var cur = config().excludeRecipeIds || [];
        if (cur.indexOf(dish.recipe) < 0) {
          saveConfig({ excludeRecipeIds: cur.concat([dish.recipe]) });
        }
      }
    });
  }

  function toggleCooked(r, recipeId) {
    var rs = rounds();
    var k = rs.findIndex(function (x) { return x.id === r.id; });
    var m = rs[k].solved.meals.filter(function (x) { return x.recipeId === recipeId; })[0];
    if (!m) return;
    m.cooked = !m.cooked;
    m.cookedAt = m.cooked ? new Date().toISOString() : null;
    saveRounds(rs);
    // 做了就从库存里扣 —— 这是库存模块存在的理由,不扣的话下一轮会重复买
    if (m.cooked) {
      var now = new Date().toISOString();
      mealIngredients(m).forEach(function (x) {
        if (x.qty) Pantry.consume(x.id, x.qty, now);
      });
    }
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

    if (r.status === 'planning' && !r.solved) {
      box.appendChild(h('button', {
        class: 'btn', style: 'margin-top:10px',
        onclick: function () { generate(r); },
      }, ['生成采购清单和菜']));
    }
    if (r.solved) box.appendChild(resultView(r));

    // 次要操作压成一行小字 —— 以前「删除」和主流程一样醒目,
    // 生成完只看见「重新生成 / 删除」,像是在说「做完了?那就删了吧」。
    var foot = h('div', { style: 'display:flex;gap:14px;margin-top:12px;justify-content:center' });
    function link(label, fn, danger) {
      return h('button', {
        style: 'background:none;border:0;font:inherit;font-size:12px;cursor:pointer;' +
               'text-decoration:underline;color:var(--' + (danger ? 'danger' : 'text-dim') + ')',
        onclick: fn,
      }, [label]);
    }
    if (r.solved && r.status !== 'done') {
      foot.appendChild(link('重新生成', function () {
        resolveRound(r.id, function () {});
      }));
    }
    foot.appendChild(link('删除这一轮', function () {
      Modal.confirm({
        title: '删掉这一轮记录?',
        body: '这一轮的菜、采购清单和实际买入记录都会没掉。' +
              '已经进冰箱的东西不受影响。',
        ok: '删掉', danger: true,
      }).then(function (ok) {
        if (!ok) return;
        var rs = rounds().filter(function (x) { return x.id !== r.id; });
        saveRounds(rs); render();
      });
    }, true));
    box.appendChild(foot);
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
