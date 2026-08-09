// 一轮做饭的**业务逻辑** —— 纯逻辑,不碰 DOM、不弹弹层、不重渲染。
//
// ⚠️ 这些函数原来住在 ui/rounds.js 里(约 700 行)。搬出来的理由不是「好看」:
//
//    1. **界面要重写第二遍。** 迁小程序时 ui/ 全部重写,业务留在渲染文件里
//       就得跟着再写一遍 —— 两份状态机必然漂移,而漂移是静默的:
//       两边都不报错,只是排出来的东西对不上。
//
//    2. **测试守的是这些,不是界面。** tools/jstest 那 25 个文件盯的全是
//       「求解器算了新东西页面不知道」「买六项扣一项」这类账目问题。
//       业务搬到 core 之后,界面怎么换,这层保护都还在。
//
// ⚠️ 这一层的规矩:**只返回结果,不决定怎么展示。**
//    生成失败就返回 {ok:false, reason},由调用方决定是弹层还是一行红字。
//    原来 generate() 自己弹 Modal.note、自己调 render(),小程序里这两样都不存在。
//
// ⚠️ 写存储一律经过这里。ui/ 里出现 Store.set 就是业务漏回渲染层了 ——
//    tools/check.sh 有一条 grep 守着。

var RoundFlow = (function () {

  function rounds() { return Store.get('rounds', []) || []; }
  function saveRounds(rs) { Store.set('rounds', rs); }
  function config() { return Store.get('config', {}) || {}; }
  function saveConfig(patch) { Store.set('config', Object.assign(config(), patch)); }

  /** 传轮次对象或 id 都行 —— 调用点有的手里是对象,有的只有 id */
  function idOf(r) { return (r && r.id) ? r.id : r; }
  function indexOf(rs, r) {
    var id = idOf(r);
    return rs.findIndex(function (x) { return x.id === id; });
  }

  /** 字符串 → 一个稳定的正整数。够用就行,不是密码学。 */
  function hashStr(str) {
    var h = 2166136261;
    for (var i = 0; i < String(str).length; i++) {
      h ^= String(str).charCodeAt(i);
      h = (h * 16777619) >>> 0;
    }
    return h % 100000;
  }

  function create(input) {
    var rs = rounds();
    var r = Round.create(
      input,
      // ⚠️ 现有轮次必须传进去避重 —— id 只到分钟,同一分钟建两轮会撞车,
      //    而撞车之后第二轮的生成结果会写进第一轮。见 Round.newId。
      config(), new Date().toISOString(), rs
    );
    rs.push(r);
    saveRounds(rs);
    return r;
  }

  function remove(r) {
    var id = idOf(r);
    saveRounds(rounds().filter(function (x) { return x.id !== id; }));
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

  // ---------------- 生成 ----------------

  /**
   * 排一轮。**只返回结果,不弹层不重渲染。**
   * @return {ok:true, round} | {ok:false, reason}
   */
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

    // ⚠️ 这个 target 以前**从来没传过**。
    //    solver 里那条 `- short * 120` 的营养项(注释还写着「模拟 400 个场景发现
    //    热量达标率 15%」)因为拿不到 target,一直恒等于 0 —— 写了但没接上。
    //    结果就是排出「晚饭 = 400g 青菜 + 一碗饭,442 kcal」这种方案。
    var p = Store.get('profile', {}) || {};
    var wlog = Store.get('weightLog', []) || [];
    var kg = wlog.length ? wlog[wlog.length - 1].kg : null;
    var daily = Profile.dailyTargets(Object.assign({}, p, { weightKg: kg }));
    var target = daily ? Profile.perPlannedMeal(daily, p.breakfast) : null;

    // ⚠️ **必须传 seed,而且每次要不一样。**
    //    求解器的默认种子是 `servings * 7919` —— 一个常数。而这里以前
    //    根本没传过 seed,于是整个求解是**完全确定性**的:
    //    配置不变、冰箱不变,连点五次「重新生成」给你的是同一份菜,
    //    下一周开新一轮排出来的也还是那四道。
    //
    // ⚠️ 我那 100 轮模拟一直在传 `seed: s`,**所以一直没发现** ——
    //    测的是一个线上不存在的用法。和 boot.js 的键少了命名空间前缀
    //    是同一类错:测试跑的路径和真实路径不是一条。
    //
    // 种子 = 轮次 id 的哈希 + 重排次数:
    //    不同轮次 → 不同起点(下周不会又是这四道)
    //    同一轮点「重新生成」→ 计数器 +1,真的换一批
    r.solveCount = (r.solveCount || 0) + 1;

    var out = Solver.solve({
      servings: r.input.servings || r.input.meals,
      constraints: cons, stock: stock, mustUse: mustUse,
      target: target,
      seed: hashStr(r.id) + r.solveCount,
      stockDetail: Pantry.stockSummary(nowIso),   // 带紧迫度,放久的会被优先排掉
      // 冷却期 + 这一轮被「换掉」的菜。换掉了还排出来,那个按钮就等于没用。
      recentRecipeIds: Object.assign(recentIds(), excludedMap(r)),
    });
    if (!out.ok) return { ok: false, reason: out.reason || '未知' };

    var rs = rounds();
    var i = indexOf(rs, r);
    // ⚠️ 计数器必须写回存储。`r` 多半是从 rounds() 读出来的**另一个对象**,
    //    只改它的话下次进来还是 undefined → 计数器永远是 1 →
    //    「重新生成」又变回给同一份菜,等于这个修复没生效。
    rs[i].solveCount = r.solveCount;
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
            var i2 = INGREDIENTS.filter(function (x) { return x.id === id; })[0];
            if (!i2) return;
            (need[id] = need[id] || { ingredientId: id, name: i2.name,
                                      packaging: i2.packaging,
                                      surplus: !!i2.inevitableSurplus, dishes: [] })
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
                 // 份量缩放:热量超标时把米面/肥肉缩回来。
                 // ⚠️ 存结论(缩了哪样、从多少到多少),不存重算过的营养 ——
                 //    页面上的 nu 是从菜谱重算的原始值,不减掉这一刀的话
                 //    会显示「米饭 250g · 1303 kcal」,而采购清单按 90g 买。
                 //    **页面和清单对不上**,而且是页面在骗人。
                 scale: c.scale ? { cuts: c.scale.cuts.map(function (x) {
                                      return { ingredientId: x.ingredientId, name: x.name,
                                               from: x.from, to: x.to, removed: x.removed,
                                               kcal: x.kcal, protein: x.protein };
                                    }), kcal: c.scale.kcal, protein: c.scale.protein } : null,
                 // app 自动配的那份主食(轮换过的)—— 不存的话页面重算又变回白米
                 staple: (c.nutrition && c.nutrition.staple) ? {
                   ingredientId: c.nutrition.staple.ingredientId,
                   name: c.nutrition.staple.name, grams: c.nutrition.staple.grams } : null,
                 // 主料加量:蛋白不够时先加它,比另外补一样自然
                 boost: c.boost ? { ingredientId: c.boost.ingredientId, name: c.boost.name,
                                    from: c.boost.from, to: c.boost.to,
                                    protein: c.boost.protein, kcal: c.boost.kcal } : null,
                 // 补的那份蛋白 —— 和配菜一样,存结论不存明细
                 topUp: c.topUp ? { ingredientId: c.topUp.ingredientId, name: c.topUp.name,
                                    grams: c.topUp.grams, protein: c.topUp.protein,
                                    kcal: c.topUp.kcal, how: c.topUp.how } : null,
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
    return { ok: true, round: rs[i] };
  }

  /**
   * 改点什么再重新求解,**排不出来就整个撤销**。
   *
   * ⚠️ 换一道菜的代价不该是丢掉整个计划。
   *    第一版是「先删掉 solved,再求解」—— 要是新忌口把菜谱库卡死了,
   *    你就同时失去了旧计划和新计划,而且那条忌口还留在设置里,
   *    之后每次重新生成都会继续失败,根本看不出是哪一步造成的。
   *
   * @return {ok:true} | {ok:false, reason}  失败时存储已经回到原样
   */
  function resolve(id, mutate) {
    var beforeRounds = JSON.parse(JSON.stringify(rounds()));
    var beforeConfig = JSON.parse(JSON.stringify(config()));

    if (mutate) mutate();

    var rs = rounds();
    var k = rs.findIndex(function (x) { return x.id === id; });
    delete rs[k].solved;
    rs[k].status = 'planning';
    saveRounds(rs);

    var out = generate(rs[k]);
    if (out.ok) return out;

    Store.set('rounds', beforeRounds);
    Store.set('config', beforeConfig);
    return { ok: false, reason: out.reason };
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

  /**
   * 这道菜实际要用的食材和克数。
   *
   * ⚠️ **必须把加量(boost)和缩量(scale)算进去。**
   *    改版前这里直接读菜谱原始克数,于是同一张卡片上:
   *      食材标签写「猪肉末 100g」
   *      下面一行写「按你的蛋白目标加了量:猪肉末 100g → 150g」
   *    而采购清单是按 150g 买的。**站在灶台前你读的就是那几个标签**,
   *    读到的是错的 —— 做出来的量不对,吃掉的量不对,剩下的记账也跟着错。
   *
   *    又是「求解器算了新东西、页面不知道」那一类。和 scale/staple 那两处
   *    同一个根:凡是求解器对这一顿做过的调整,**所有**展示路径都得知道。
   */
  function mealIngredients(m) {
    var rv = variantOf(m);
    if (!rv) return [];
    var adj = {};                       // ingredientId → 调整后的克数
    if (m.boost) adj[m.boost.ingredientId] = m.boost.to;
    if (m.scale) m.scale.cuts.forEach(function (c) { adj[c.ingredientId] = c.to; });

    return (rv.variant.ingredients || []).map(function (it) {
      var ing = INGREDIENTS.filter(function (x) { return x.id === it.ids[0]; })[0];
      var to = adj[it.ids[0]];
      return {
        id: it.ids[0],
        name: (it.names && it.names[0]) || (ing ? ing.name : it.ids[0]),
        alt: it.ids.length > 1,
        // 改过的一律按克显示 —— 原来写「2个」的鸡蛋加量后成了 150g,
        // 再按「个」报就得四舍五入成 3 个,反而不准
        qty: to != null ? to : it.qty,
        unit: to != null ? 'g' : (it.unit || 'g'),
        adjusted: to != null ? (it.grams != null ? it.grams : it.qty) : null,
        role: it.role,
        toTaste: it.toTaste,
      };
    });
  }

  /** 做了这顿,**实际用掉**的东西 —— 用来从库存里扣。
   *
   * ⚠️ 和 mealIngredients 分开,因为它们回答的不是同一个问题:
   *    那个答「这道菜要什么」(显示用,一道菜一张卡);
   *    这个答「这一顿吃掉了什么」(记账用,含配菜、补的蛋白、配的那碗饭)。
   *
   * ⚠️ 分开之前这两件事共用一个函数,而**买的时候算六项、扣的时候只扣一项**:
   *      买  主菜 + 配菜 + 加量 + 缩量 + 补的蛋白 + 主食   (solver 那边)
   *      扣  主菜                                          (这边)
   *    于是配菜的西兰花、补的那罐金枪鱼、配的那碗米,买回来进了冰箱,
   *    做完了永远不扣 —— 库存越攒越多,而下一轮还会「优先排掉它们」,
   *    结果是反复给你排根本已经吃掉的东西。
   *    这类账目失衡不会报错,只会让排出来的菜越来越不对劲。 */
  function mealConsumption(m) {
    var out = mealIngredients(m).map(function (x) { return { id: x.id, qty: x.qty }; });
    if (m.side) {
      mealIngredients(m.side).forEach(function (x) {
        out.push({ id: x.id, qty: x.qty });
      });
    }
    if (m.topUp) out.push({ id: m.topUp.ingredientId, qty: m.topUp.grams });
    // 配的那碗饭 —— 主食换过的话按换之后的算(m.staple 是求解器最后定的那样)
    var st = m.staple || (m.nutrition && m.nutrition.staple);
    if (st && st.ingredientId) out.push({ id: st.ingredientId, qty: st.grams });
    return out;
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

  // ---------------- 采购 ----------------

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
    var k = indexOf(rs, r);
    if (k < 0) return null;
    var t = rs[k].solved.shopping.filter(function (x) {
      return x.ingredientId === ingredientId;
    })[0];
    if (!t) return rs[k];
    t.bought = !t.bought;
    if (!t.bought) t.actualGrams = null;
    saveRounds(rs);
    syncPantry(rs[k]);
    return rs[k];
  }

  /** 「都买了」时把还没勾的一次性记上 —— 见 ui 里那段弹层 */
  function markAllBought(r) {
    var rs = rounds();
    var k = indexOf(rs, r);
    if (k < 0) return null;
    (rs[k].solved.shopping || []).forEach(function (t) { t.bought = true; });
    saveRounds(rs);
    syncPantry(rs[k]);
    return rs[k];
  }

  function setActual(r, ingredientId, grams) {
    var rs = rounds();
    var k = indexOf(rs, r);
    if (k < 0) return null;
    var t = rs[k].solved.shopping.filter(function (x) {
      return x.ingredientId === ingredientId;
    })[0];
    if (!t) return rs[k];
    t.actualGrams = grams;
    saveRounds(rs);
    syncPantry(rs[k]);
    return rs[k];
  }

  /** 采购勾选 → 库存。以**实际克数**为准,没填就先按需求量记,回头改了会同步。
   *
   * ⚠️ **干货不进冰箱,进调料柜。** 这是「为啥冰箱和调料柜都有大米」的真根因:
   *    以前买什么都往 pantryItems 里塞,于是一袋米被当成一条冷藏库存记着、
   *    旁边算着「买于 08-06」,而它本该是柜子里那条「我有大米」。
   *    同一样东西在两个页面各存一份,还各说各的。
   *
   * ⚠️ 干货只加不减:取消勾选不会把它从柜子里拿走。柜子记的是「我家有大米」,
   *    那件事不会因为你在清单上取消一个勾就变回没有 ——
   *    要去掉走「···」→「记错了」。
   */
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
      var i0 = Catalog.ingredient(t.ingredientId);
      // ⚠️ **调料进柜子,主食进冰箱** —— 两者都是 staple 档,但记法不同。
      //    调料柜是「有/没有」:一瓶生抽用掉多少你不会记,也不该让你记。
      //    主食按克记:一袋 5kg 的米要能吃 55 顿,做一顿扣一顿,吃完了
      //    自己会回到采购清单上。以前米也往柜子里塞,于是勾上就再没提醒过。
      //
      // ⚠️ 米放常温,不是冷藏 —— addFromPackage 按 tier 猜位置,
      //    staple 档会被猜成 fridge,一袋米挂着「冷藏」是假的。
      if (i0 && i0.tier === 'staple' && !Pantry.isGrain(t.ingredientId)) {
        if (!Pantry.hasStaple(t.ingredientId)) Pantry.toggleStaple(t.ingredientId);
        return;
      }
      var loc = (i0 && i0.tier === 'staple') ? 'pantry' : null;
      Pantry.addFromPackage(
        { id: t.ingredientId, ingredientId: t.ingredientId, netWeight: g, unit: t.unit },
        now, loc);
      var list = Pantry.items();
      list[list.length - 1].source = tag;
      Store.set('pantryItems', list);
    });
  }

  // ---------------- 状态机 ----------------

  function setStatus(r, st) {
    var rs = rounds();
    var k = indexOf(rs, r);
    if (k < 0) return null;
    rs[k].status = st;
    if (st === 'done') rs[k].finishedAt = new Date().toISOString();
    saveRounds(rs);
    return rs[k];
  }

  /** 反馈随手就存,不等你点结束 —— 填到一半切走也不该白填 */
  function saveLog(r, log) {
    var rs = rounds();
    var i = indexOf(rs, r);
    if (i < 0) return null;
    rs[i].log = log;
    saveRounds(rs);
    return rs[i];
  }

  /**
   * 下一步该干什么 —— **每个状态有且只有一个主动作**。
   * 只回答「是什么」,不回答「长什么样」:按钮文案和弹层由界面层定。
   */
  function nextStepFor(r) {
    var s = r.solved || {};
    if (r.status === 'shopping') {
      var todo = (s.shopping || []).filter(function (x) { return !x.bought; });
      return { kind: 'startCooking', left: todo.length, unbought: todo };
    }
    if (r.status === 'cooking') {
      var meals = s.meals || [];
      var cooked = meals.filter(function (x) { return x.cooked; }).length;
      return { kind: 'finish', cooked: cooked, total: meals.length };
    }
    if (r.status === 'done' || r.status === 'skipped') {
      var done = (s.meals || []).filter(function (x) { return x.cooked; }).length;
      return { kind: 'over', cooked: done, total: (s.meals || []).length };
    }
    return { kind: 'generate' };
  }

  /** @return {round, cooked}  cooked = 这一下之后它是不是「做过了」 */
  function toggleCooked(r, recipeId) {
    var rs = rounds();
    var k = indexOf(rs, r);
    if (k < 0) return null;
    var m = rs[k].solved.meals.filter(function (x) { return x.recipeId === recipeId; })[0];
    if (!m) return null;
    m.cooked = !m.cooked;
    m.cookedAt = m.cooked ? new Date().toISOString() : null;
    saveRounds(rs);
    // 做了就从库存里扣 —— 这是库存模块存在的理由,不扣的话下一轮会重复买。
    // ⚠️ 走 mealConsumption 不是 mealIngredients:配菜、补的蛋白、配的那碗饭
    //    也是这一顿真吃掉的东西。见 mealConsumption 上面那段。
    if (m.cooked) {
      var now = new Date().toISOString();
      mealConsumption(m).forEach(function (x) {
        if (x.qty) Pantry.consume(x.id, x.qty, now);
      });
    }
    return { round: rs[k], cooked: m.cooked };
  }

  /**
   * 换掉一道菜:落库之后立刻重新求解 ——
   * 换掉了却还得自己去点「重新生成」,那不叫换掉。
   *
   * @param ban   {id, scope} 要拉黑的食材/调料;scope='once' 只影响这一轮
   * @param dish  {recipe} 永久不排这道菜
   * @return {ok:true} | {ok:false, reason}  失败时已经整个撤销
   */
  function applySwap(r, m, ban, dish) {
    var id = idOf(r);
    return resolve(id, function () {
      var rs = rounds();
      var k = rs.findIndex(function (x) { return x.id === id; });
      var ov = rs[k].overrides = rs[k].overrides || {};

      // 换掉的这道,本轮一定不再排
      ov.excludeRecipeIds = (ov.excludeRecipeIds || []).concat([m.recipeId]);
      saveRounds(rs);

      if (ban && ban.scope === 'once') {
        var rs2 = rounds();
        var k2 = rs2.findIndex(function (x) { return x.id === id; });
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

  return {
    rounds: rounds, config: config, saveConfig: saveConfig, hashStr: hashStr,
    create: create, remove: remove, generate: generate, resolve: resolve,
    recentIds: recentIds, excludedMap: excludedMap,
    variantOf: variantOf, mealIngredients: mealIngredients,
    mealConsumption: mealConsumption, mealSeasonings: mealSeasonings,
    savePkgCorrection: savePkgCorrection,
    toggleBought: toggleBought, markAllBought: markAllBought, setActual: setActual,
    syncPantry: syncPantry,
    setStatus: setStatus, saveLog: saveLog, nextStepFor: nextStepFor,
    toggleCooked: toggleCooked, applySwap: applySwap,
  };
})();

if (typeof module !== 'undefined') module.exports = RoundFlow;
