// 两阶段求解器 —— 纯函数,不碰 DOM。
//
// 为什么分两阶段(DESIGN.md 第五节):
//   一步优化的搜索空间是 |SKU组合| × |菜组合|,会爆炸。
//   拆开之后阶段一只有几十种,阶段二在食材固定的前提下也只有几十种。
//
// **从选包出发,不是从选菜出发。因为规格是硬约束,菜是软的。**
//   你不能买 180g 的鸡胸 —— 只能买 300g 那盒,然后想办法两顿吃完。
//   先选菜再算食材,算出来的采购清单永远是「买 180g」这种做不到的东西。

var Solver = (function () {

  // 一人一顿的主料参考量(DESIGN 第五节的盒马规格表反推)
  var PROTEIN_PER_SERVING = 175;   // g
  var VEG_PER_SERVING = 200;       // g

  function ing(id) {
    return INGREDIENTS.filter(function (i) { return i.id === id; })[0] || null;
  }

  function isProtein(i) {
    return i && ['水产', '畜肉', '禽肉', '内脏', '蛋', '豆制品', '加工肉'].indexOf(i.category) >= 0;
  }
  function isVeg(i) {
    return i && (i.countsAsVeg === true ||
      ['叶菜', '瓜果菜', '根茎', '菌菇', '芽苗'].indexOf(i.category) >= 0);
  }

  // ---------------- 阶段一:选包 ----------------

  /**
   * 输入:servings(总份数)· 约束 · 库存
   * 输出:一组要买的食材及数量
   *
   * 选料的判据是**通用性**:在你的约束下,这个食材能进多少道可做的菜。
   * 选了只能做一道菜的食材,阶段二就会卡死。
   */
  function stage1(opts) {
    var servings = opts.servings;
    var cfg = opts.constraints || {};
    var stock = opts.stock || {};          // {ingredientId: grams}
    var mustUse = opts.mustUse || [];      // 临期,必须排掉

    // 先算每个候选食材的「通用性」= 在当前约束下有多少道可做的菜用它
    //
    // ⚠️ 必须同时数 main 和 side。第一版只数 main,结果蔬菜候选池里只剩下
    //    「以蔬菜为主角」的菜(鱼香茄子/酿苦瓜),而白菜上海青这些最百搭的
    //    在绝大多数菜里是配菜 —— 它们反而进不了候选,选出来的全是冷门菜,
    //    买回去没菜可做,浪费率 62%。
    var usage = {};
    var pool = [];
    RECIPES.forEach(function (r) {
      if (r.type === 'prep') return;
      var vs = Catalog.availableVariants(r, cfg);
      if (!vs.length) return;
      pool.push({ recipe: r, variants: vs });
      vs.forEach(function (v) {
        v.ingredients.forEach(function (x) {
          if (x.role !== 'main' && x.role !== 'side') return;
          x.ids.forEach(function (id) {
            var u = (usage[id] = usage[id] || { dishes: {}, grams: [], asMain: 0 });
            u.dishes[r.id] = 1;
            if (x.role === 'main') u.asMain++;
            if (x.grams) u.grams.push(x.grams);
          });
        });
      });
    });

    var black = {};
    (cfg.blacklist || []).forEach(function (b) { black[b] = 1; });

    function candidates(pred) {
      return Object.keys(usage).filter(function (id) {
        if (black[id]) return false;
        var i = ing(id);
        if (!i || i.tier === 'staple') return false;   // 调料不是主料
        return pred(i);
      }).map(function (id) {
        var u = usage[id];
        // 用菜谱里的**实际平均用量**,不用一刀切的 175g ——
        // 鸡蛋一道菜用 100g(2个),牛腩用 300g,按同一个数算会买错一倍
        var avg = u.grams.length
          ? u.grams.reduce(function (a, b) { return a + b; }, 0) / u.grams.length : null;
        return { id: id, ing: ing(id), dishes: Object.keys(u.dishes).length,
                 asMain: u.asMain, avgGrams: avg };
      }).sort(function (a, b) { return b.dishes - a.dishes; });
    }

    var picks = [];

    // 库存里放久了的,直接进这一轮的「要吃掉」清单 —— 不用买,但要排菜消耗。
    //
    // ⚠️ 紧迫度是**连续的**:超过 55% 保质期就开始进,越接近过期权重越高。
    //    早先只收「3 天内过期」的,结果放了 25 天的鸡蛋(保质期 30 天)没人管,
    //    下一轮又买一盒,等它进红线时已经来不及。
    var urgentStock = (opts.stockDetail || []).filter(function (a) {
      return a.urgency >= 0.55 && a.grams > 10;
    });
    urgentStock.forEach(function (a) {
      var i = ing(a.ingredientId);
      if (!i) return;
      picks.push({ ingredientId: a.ingredientId, ing: i, reason: 'usestock',
                   needGrams: a.grams, fromStock: true,
                   urgency: a.urgency, daysLeft: a.daysLeft });
    });
    // 显式点名的(手动勾「这次要清掉」)优先级最高
    mustUse.forEach(function (id) {
      if (picks.some(function (p) { return p.ingredientId === id; })) return;
      var i = ing(id);
      if (!i) return;
      picks.push({ ingredientId: id, ing: i, reason: 'expiring',
                   needGrams: stock[id] || 0, fromStock: true, urgency: 1 });
    });

    function take(list, count, fallbackPerServing, kind, minDishes) {
      var n = 0;
      var servingsPerPick = Math.max(1, servings / Math.max(1, count));

      // ⚠️ 不能严格取覆盖度前 N 名 —— 那是确定性的,每次都选同样几样。
      //    模拟 400 个场景:只有 16 种食材被选过,鸡蛋 99%、洋葱 98%,
      //    韩式蛋卷出现在 91% 的方案里,512 道菜只排到过 95 道。
      //    改成在覆盖度靠前的一批里**按权重抽签**,保留「百搭优先」但不再一成不变。
      var seedV = (opts.seed != null ? opts.seed : servings * 7919) + (kind === 'veg' ? 104729 : 0);
      var rndV = function () {
        seedV = (seedV * 1103515245 + 12345) % 2147483648;
        return seedV / 2147483648;
      };
      var eligible = list.filter(function (c) { return c.dishes >= (minDishes || 1); });
      var poolSize = Math.min(eligible.length, Math.max(count * 4, 12));
      var top = eligible.slice(0, poolSize);

      while (n < count && top.length) {
        var tot = 0;
        top.forEach(function (c) { tot += c.dishes; });
        var pickAt = rndV() * tot, acc2 = 0, sel = top.length - 1;
        for (var q = 0; q < top.length; q++) {
          acc2 += top[q].dishes;
          if (acc2 >= pickAt) { sel = q; break; }
        }
        var c = top.splice(sel, 1)[0];
        if (picks.some(function (p) { return p.ingredientId === c.id; })) continue;
        var per = c.avgGrams || fallbackPerServing;
        // 每样覆盖「总份数 ÷ 这一类要买几样」,不是一律买两份的量 ——
        // 4 份饭买 2 个蛋白 + 3 个蔬菜,每样都按 2 份买 = 备了 10 份的料
        var need = Math.max(0, per * servingsPerPick - (stock[c.id] || 0));
        if (need <= 0) continue;
        var plan = Packaging.plan(c.id, need);
        if (!plan) continue;
        picks.push({
          ingredientId: c.id, ing: c.ing, kind: kind,
          dishes: c.dishes, perServing: Math.round(per), needGrams: Math.round(need),
          plan: plan, reason: 'coverage',
        });
        n++;
      }
      return n;
    }

    // 买几**种**,不是买几包 —— 这两件事第一版混了。
    //
    // 品种数不能跟着份数线性涨:每多一种就多一份包装零头,而一个人做 8 顿也不需要 4 种肉。
    // 按 ceil(N/2) 算,8 份会买 4 蛋白 + 5 蔬菜 = 9 样,生鲜浪费 46%;
    // 收到 3 + 4 的上限之后,同样 8 份只买 3 + 4,每样覆盖更多顿,零头摊薄。
    // 这也正是「主料复用、做法不重复」—— 少买几样、多变几种做法,而不是反过来。
    var nProtein = Math.min(3, Math.max(1, Math.ceil(servings / 3)));
    var nVeg = Math.min(4, Math.max(2, Math.ceil(servings / 2)));
    // 要求候选至少能进 6 道菜 —— 太冷门的买回去没处使
    take(candidates(isProtein), nProtein, PROTEIN_PER_SERVING, 'protein', 6);
    take(candidates(isVeg), nVeg, VEG_PER_SERVING, 'veg', 6);


    return { picks: picks, pool: pool, usage: usage };
  }

  // ---------------- 阶段二:排菜 ----------------

  function variantUses(v, idSet) {
    var g = 0;
    v.ingredients.forEach(function (x) {
      if (x.role !== 'main' && x.role !== 'side') return;
      x.ids.forEach(function (id) { if (idSet[id] && x.grams) g += x.grams; });
    });
    return g;
  }

  /**
   * 给定阶段一选出的食材,挑 N 道菜把它们吃掉。
   * 随机采样 + 打分取最优 —— 一人份搜索空间很小,够用,而且比精巧算法好调试十倍。
   */
  function stage2(stage1Result, servings, opts) {
    opts = opts || {};
    var have = {};
    var budget = {};
    var weightOf = {};      // 消耗这一样的价值倍数 —— 临期的算得更重
    stage1Result.picks.forEach(function (p) {
      have[p.ingredientId] = 1;
      budget[p.ingredientId] = p.plan ? p.plan.total : (p.needGrams || 0);
      // 快过期的库存吃掉一克,比新买的吃掉一克有价值 —— 一个是救回来,一个只是不剩
      weightOf[p.ingredientId] = p.fromStock ? (1 + (p.urgency || 0) * 3) : 1;
    });

    // 候选:**主料必须全部来自买的东西或库存**。
    //
    // ⚠️ 这是硬约束,不是打分项。第一版只要求「至少用到一样买的东西」,
    //    结果排出来的四顿里有希腊沙拉(要羊奶酪)、猪排丼(要猪排)——
    //    主料全不在采购清单上。你照着清单买回来,发现三道菜做不了。
    //    清单和菜必须闭合,否则整个输出是废的。
    //
    // 配菜(side)不强求 —— 小份的葱姜蒜、一点胡萝卜,后面补进清单就行,
    // 真正贵和占体积的是主料。
    var cands = [];
    var extraNeeded = {};
    stage1Result.pool.forEach(function (e) {
      e.variants.forEach(function (v) {
        var mains = v.ingredients.filter(function (x) { return x.role === 'main'; });
        if (!mains.length) return;
        var allCovered = mains.every(function (x) {
          return x.ids.some(function (id) { return have[id] || (opts.stock && opts.stock[id]); });
        });
        if (!allCovered) return;
        var g = variantUses(v, have);
        if (g <= 0) return;
        cands.push({ recipe: e.recipe, variant: v, uses: g,
                     nutrition: (typeof Nutrition !== 'undefined')
                                ? Nutrition.ofMeal(v) : null,
                     missing: (typeof Pantry !== 'undefined')
                              ? Pantry.missingSeasonings(v).length : 0 });
      });
    });
    if (!cands.length) return { ok: false, reason: 'no-candidates' };

    // ⚠️ **主菜位只认蛋白达标的菜。**
    //    原来的模型是「一道菜 = 一顿饭」,可库里 17% 的菜蛋白低于 20g ——
    //    宁式烤菜(上海青 400g,蛋白 18g)于是可以名正言顺地当一顿晚饭。
    //    光加打分权重不够:那只是让它不容易被选中,没从根上排除。
    //
    //    但**不能拦死**。厨具受限、忌口多、只买了素的时候,达标的候选可能不够铺满,
    //    宁可排出「蛋白偏低但能吃」的一轮,也不该整个失败什么都不给。
    //    所以只在候选还够用时才收紧。
    // 配菜的候选池比主菜宽:**不要求食材已经在阶段一的采购提议里**。
    //
    // ⚠️ 第一版复用了主菜的池子,结果一道配菜都配不上 —— 阶段一买的是土豆胡萝卜,
    //    库里那 30 道简单青菜的主料(西兰花/上海青/菠菜)一样都没买,全被筛掉了。
    //    可现实里你就是会「顺手再买一把青菜」。阶段三本来就是从最终选定的菜倒算清单,
    //    配菜带进来的食材会自然进清单 —— 前提是这里别提前把它们筛没。
    var sideCands = [];
    stage1Result.pool.forEach(function (e) {
      e.variants.forEach(function (v) {
        // ⚠️ 配菜用 ofVariant(菜本身),不是 ofMeal。
        //    ofMeal 会给不带主食的菜补一碗饭 —— 可配菜是跟主菜共用那碗饭的。
        //    用错了:蒜蓉西兰花本身 91 kcal 会被算成 402,所有配菜都判成「太重」,
        //    而且叠回主菜时会重复计一碗饭的热量。
        var nu = (typeof Nutrition !== 'undefined') ? Nutrition.ofVariant(v) : null;
        if (typeof Meal !== 'undefined' && !Meal.isSimpleSide(v, nu, opts.target)) return;
        sideCands.push({ recipe: e.recipe, variant: v, nutrition: nu,
                         missing: (typeof Pantry !== 'undefined')
                                  ? Pantry.missingSeasonings(v).length : 0 });
      });
    });

    if (typeof Meal !== 'undefined') {
      var mainOK = cands.filter(function (c) { return Meal.canBeMain(c.nutrition, opts.target); });
      if (mainOK.length >= servings * 3) cands = mainOK;
    }


    var recent = opts.recentRecipeIds || {};
    var pkgCache = {};          // 包装规格查询缓存 —— 每步每候选都要查,不缓存会很慢
    var best = null;
    var TRIES = Math.min(600, 150 + servings * 40);   // 份数多则搜索空间大,采样跟着涨

    for (var t = 0; t < TRIES; t++) {
      var left = Object.assign({}, budget);
      var chosen = [], usedRecipe = {}, methods = {};
      var seed = (t * 2654435761) % 4294967296;
      var rnd = function () {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return seed / 2147483648;
      };

      // 加权轮盘:每一步都按「这道菜能吃掉多少还剩着的东西」抽签。
      //
      // ⚠️ 第一版是整体洗牌、再逐个判断能不能消耗 —— 好组合全靠运气撞上,
      //    8 份那档生鲜浪费一直卡在 48%。改成每步按剩余量加权之后,
      //    消耗多的菜自然更容易中签,但仍带随机性以保证多样。
      var avail = cands.filter(function (c) { return !recent[c.recipe.id]; });
      // 已经要买的东西 —— 复用它们的菜优先,免得为 20g 配菜再开一整包
      var needSet = {};
      Object.keys(budget).forEach(function (id) { needSet[id] = 1; });

      while (chosen.length < servings && avail.length) {
        var weights = [], total = 0;
        for (var a = 0; a < avail.length; a++) {
          var cc = avail[a], helps = 0;
          for (var q = 0; q < cc.variant.ingredients.length; q++) {
            var x = cc.variant.ingredients[q];
            for (var z = 0; z < x.ids.length; z++) {
              var id = x.ids[z];
              if (left[id] > 0 && x.grams) {
                helps += Math.min(left[id], x.grams) * (weightOf[id] || 1);
              }
            }
          }
          // 新开一包会剩多少 —— 按**真实边际浪费**罚,不是按「开了几包」罚。
          //
          // ⚠️ 12 周多轮模拟的诊断:扔掉的东西 90% 是配菜,不是主料。
          //    芹菜扔 90%、绿豆芽 86%、竹笋 80%、黄瓜 73% —— 全是「一道菜用 30g,
          //    最小包装 300g,没有第二道菜用它」。而猪五花只扔 16%、牛腩 23%。
          //    早先按「多开几包」计数罚,分不出「开一包用 250g」和「开一包用 30g」,
          //    而这两者的浪费差十倍。
          var newWaste = 0;
          for (var q3 = 0; q3 < cc.variant.ingredients.length; q3++) {
            var x3 = cc.variant.ingredients[q3];
            if (x3.role !== 'main' && x3.role !== 'side') continue;
            var id3 = x3.ids[0];
            if (needSet[id3]) continue;              // 已经要买了,不算新开
            var i3 = ing(id3);
            if (!i3 || i3.tier === 'staple') continue;
            var g3 = (typeof Nutrition !== 'undefined') ? Nutrition.gramsOf(x3) : x3.grams;
            if (g3 == null) continue;
            var opt3 = pkgCache[id3];
            if (opt3 === undefined) {
              opt3 = Packaging.smallest(id3);
              pkgCache[id3] = opt3 || null;
            }
            if (!opt3) continue;
            var packs3 = Math.max(1, Math.ceil(g3 / opt3.netWeight));
            var leftover3 = packs3 * opt3.netWeight - g3;
            // fresh 的剩下会烂,buffer 的能结转 —— 罚得轻
            newWaste += leftover3 * (i3.tier === 'fresh' ? 1 : 0.25);
          }
          // 做法重复的降权但不禁止 ——「做法不重复」是软目标不是硬约束
          var w = (helps + 1)
                * (methods[cc.recipe.method] ? 0.25 : 1)
                / (1 + newWaste / 120);            // 会剩 120g 就减半,240g 减到三分之一
          weights.push(w); total += w;
        }
        var pick = rnd() * total, acc = 0, idx = weights.length - 1;
        for (var b = 0; b < weights.length; b++) {
          acc += weights[b];
          if (acc >= pick) { idx = b; break; }
        }
        var got = avail.splice(idx, 1)[0];
        if (usedRecipe[got.recipe.id]) continue;
        // ⚠️ 存副本,不存引用。cands 在 600 次采样之间是共用的,
        //    后面要给选中的菜挂 side、改 nutrition(配了青菜蔬菜就够了)——
        //    直接改引用会污染候选池,让后面几百次采样看到的是被上一轮改过的数据。
        chosen.push(Object.assign({}, got));
        usedRecipe[got.recipe.id] = 1;
        methods[got.recipe.method] = 1;
        for (var q2 = 0; q2 < got.variant.ingredients.length; q2++) {
          var xx = got.variant.ingredients[q2];
          for (var z2 = 0; z2 < xx.ids.length; z2++) {
            var id2 = xx.ids[z2];
            if (left[id2] != null && xx.grams) left[id2] = Math.max(0, left[id2] - xx.grams);
          }
          if (xx.role === 'main' || xx.role === 'side') needSet[xx.ids[0]] = 1;
        }
      }
      if (chosen.length < servings) continue;

      // 蔬菜不够的那几顿,配一道够简单的青菜。
      //
      // ⚠️ 在打分**之前**做,因为配菜会吃掉剩料 —— 它同时在补蔬菜和降浪费,
      //    放到打分之后就白费了这层收益。
      if (typeof Meal !== 'undefined') {
        for (var ci = 0; ci < chosen.length; ci++) {
          var cm = chosen[ci];
          if (!Meal.needsGreens(cm.nutrition, opts.target)) continue;
          var sd = Meal.pickSide(sideCands, left, opts.target, usedRecipe, function (id, g) {
            // 为这样东西开一包会剩多少 —— 和主菜那边用的是同一套包装规格
            if (typeof Packaging === 'undefined') return 0;
            if (pkgCache[id] === undefined) pkgCache[id] = Packaging.smallest(id) || null;
            var o = pkgCache[id];
            if (!o) return 0;
            return Math.max(0, Math.ceil(g / o.netWeight) * o.netWeight - g);
          });
          if (!sd) continue;
          cm.side = sd;
          usedRecipe[sd.recipeId] = 1;
          (sd._cand.variant.ingredients || []).forEach(function (it) {
            it.ids.forEach(function (id3) {
              if (left[id3] != null && it.grams) left[id3] = Math.max(0, left[id3] - it.grams);
            });
            if (it.role === 'main' || it.role === 'side') needSet[it.ids[0]] = 1;
          });
          // 配上之后这一顿的蔬菜和热量都要按补齐后的算,否则白配 ——
          // 蔬菜不叠的话打分看不见配菜的功劳,热量不叠的话「吃撑」那条罚不到。
          var sn = (typeof Nutrition !== 'undefined')
                   ? Nutrition.ofVariant(sd._cand.variant) : { kcal: 0, protein: 0, veg: 0 };
          cm.nutrition = Object.assign({}, cm.nutrition, {
            veg: cm.nutrition.veg + Math.round(sn.veg),
            kcal: cm.nutrition.kcal + Math.round(sn.kcal),
            protein: cm.nutrition.protein + Math.round(sn.protein),
          });
        }
      }

      // 打分。
      //
      // ⚠️ 剩余量必须**按 tier 分开算**,不能混成一个「浪费率」:
      //    DESIGN 第四节的三级策略里,fresh(叶菜/鲜肉/豆腐)是「周末两天内清零」的硬约束,
      //    剩下就是真扔掉;buffer(鸡蛋/冷冻肉/根茎/干货)本来就跨周结转,剩下是**下次接着用**。
      //    第一版把 335g 鸡蛋和 280g 五花肉一起算进浪费率,得出 60% —— 那个数字没有意义,
      //    因为它把「买了一盒鸡蛋」当成了失败。
      var freshBought = 0, freshLeft = 0, carryLeft = 0;
      Object.keys(budget).forEach(function (id) {
        var i = ing(id);
        var isFresh = i && i.tier === 'fresh';
        if (isFresh) { freshBought += budget[id]; freshLeft += left[id]; }
        else { carryLeft += left[id]; }
      });
      var wasteRatio = freshBought ? freshLeft / freshBought : 0;

      var methodCount = Object.keys(methods).length;
      var missing = chosen.reduce(function (s, c) { return s + c.missing; }, 0);
      // 完全没被碰过的食材单独重罚 —— 买了一整包一口没吃,比每样剩一点糟得多
      var untouched = Object.keys(budget).filter(function (id) {
        return budget[id] > 0 && left[id] >= budget[id] - 1;
      }).length;

      // 临期库存没排掉是真会烂掉的东西,罚得比一般剩余重
      var urgentLeft = 0;
      stage1Result.picks.forEach(function (p) {
        if (!p.fromStock) return;
        urgentLeft += (left[p.ingredientId] || 0) * (1 + (p.urgency || 0) * 3);
      });

      // 营养缺口 —— 这一项早先完全没进打分。
      // 模拟 400 个场景发现:热量达标率 15%、蛋白 35%,因为求解器只优化浪费和多样性,
      // 从不看这顿够不够吃。Profile 辛辛苦苦算出来的目标一直没人用。
      //
      // ⚠️ **不能只看平均**。第一版是 `short / chosen.length`,于是「一顿只有
      //    400g 青菜(442 kcal · 蛋白 18g)」被另外三顿的蛋白盈余摊平,
      //    分数上完全看不出来 —— 可你真到那顿是要坐下来吃它的,**平均值不能吃**。
      //    最差的那顿单独占一半权重:一整套里只要有一顿明显不够,就得扣分。
      var short = 0;
      if (opts.target && typeof Nutrition !== 'undefined') {
        var shorts = chosen.map(function (c) {
          return c.nutrition ? Nutrition.shortfall(c.nutrition, opts.target) : 0;
        });
        var sum = shorts.reduce(function (a, b) { return a + b; }, 0);
        var worst = shorts.reduce(function (a, b) { return Math.max(a, b); }, 0);
        short = (sum / shorts.length) * 0.5 + worst * 0.5;
      }

      // 省事程度 —— **这一项以前完全没有**。
      //
      // ⚠️ 时间此前只被当成**过滤器**(超过上限就滤掉),上限之内 10 分钟和 45 分钟
      //    在打分上一模一样。后果最明显的是 prepLevel:
      //    「韭菜鸡蛋盒子」有 scratch(醒面 20 分钟)/ assembled(买现成皮)/
      //    readymade 三档,三个变体是三个独立候选、同分竞争 ——
      //    于是一道菜跟自己抢,抽到哪档全看运气,经常抽到要和面的那档。
      //    库里 13 道要醒面的菜有 11 道都有现成档,却照样排出手工版。
      //
      //    空等按三折算:焖着的时候你是自由的,不像动手那样占人。
      //    权重压得比浪费和营养都低 —— 这是「同等条件下选省事的」,
      //    不是「为了省事什么都不管」。
      var effort = 0;
      chosen.forEach(function (c) {
        var t = (typeof Timing !== 'undefined')
                ? Timing.ofMeal(c.variant, c.side && c.side._cand ? c.side._cand.variant : null)
                : { active: c.variant.activeMinutes || 0, idle: 0 };
        effort += t.active + t.idle * 0.3;
      });
      effort = effort / chosen.length;

      var score = (1 - wasteRatio) * 100
                + Math.min(methodCount, servings) * 8
                - missing * 4
                - untouched * 25
                - urgentLeft * 0.15
                - short * 120           // 权重高于浪费 —— 吃不饱比剩一点严重
                - effort * 1.2;         // 同等条件下选省事的



      if (!best || score > best.score) {
        best = { score: score, chosen: chosen, left: left,
                 wasteRatio: wasteRatio, methodCount: methodCount, missing: missing,
                 freshLeft: freshLeft, freshBought: freshBought, carryLeft: carryLeft,
                 nutritionShortfall: short };
      }
    }

    if (!best) return { ok: false, reason: 'cannot-fill', wanted: servings, candidates: cands.length };
    return Object.assign({ ok: true }, best);
  }

  /**
   * 阶段三:采购清单从**最终选定的菜**倒算,不是照抄阶段一的提议。
   *
   * ⚠️ 这一步早先没有,是架构上的错。阶段一按「通用性」猜要买什么,阶段二再挑菜 ——
   *    但阶段二没用上的东西仍然留在清单里。模拟 400 个场景时出现过浪费率 100% 的方案:
   *    买了一包菜,四顿里一道都没用到。
   *    **买了一口没吃**不是「浪费率高」,是清单本身错了 —— 那样东西根本不该被买。
   *
   * 倒算之后,剩余量只剩下包装规格带来的零头,那才是这个应用真正要对付的东西。
   */
  function finalizeShopping(chosen, stage1Result, opts) {
    var stock = opts.stock || {};
    var need = {};
    // 配菜的食材也得进清单 —— 不然页面上写着「配蒜蓉西兰花」,
    // 采购清单里却没有西兰花,到了超市才发现买不齐。
    chosen.forEach(function (c) {
      var vs = [c.variant];
      if (c.side && c.side._cand) vs.push(c.side._cand.variant);
      vs.forEach(function (v) {
        v.ingredients.forEach(function (x) {
          if (x.role !== 'main' && x.role !== 'side' && x.role !== 'staple') return;
          var id = x.ids[0];
          var g = (typeof Nutrition !== 'undefined') ? Nutrition.gramsOf(x) : x.grams;
          if (g == null) return;
          need[id] = (need[id] || 0) + g;
        });
      });
      // 不带主食的菜要配一碗饭,这份米也得进清单。
      // ⚠️ 一顿只配一碗 —— 挂在 chosen 上,不是挂在每个 variant 上,
      //    否则主菜和配菜会各配一碗饭。
      var nu = c.nutrition;
      if (nu && nu.staple) {
        need[nu.staple.ingredientId] = (need[nu.staple.ingredientId] || 0) + nu.staple.grams;
      }
    });

    var buy = [], useStock = [];
    Object.keys(need).forEach(function (id) {
      var i = ing(id);
      if (!i) return;
      var have = stock[id] || 0;
      var short = need[id] - have;
      if (have > 0) {
        useStock.push({ ingredientId: id, ing: i, needGrams: Math.round(need[id]),
                        fromStock: true, stockGrams: Math.round(Math.min(have, need[id])) });
      }
      if (short <= 0) return;
      // 调料/米面是 staple 档,不进每周采购清单(DESIGN 第四节)——
      // 但如果储物柜里压根没有,还是要提醒买
      if (i.tier === 'staple') {
        if (typeof Pantry !== 'undefined' && Pantry.hasStaple(id)) return;
      }
      var plan = Packaging.plan(id, short);
      buy.push({ ingredientId: id, ing: i, needGrams: Math.round(short), plan: plan,
                 kind: i.tier === 'staple' ? 'staple' : (isProtein(i) ? 'protein' : 'veg') });
    });

    // 按「贵重/占体积」排序:蛋白 → 蔬菜 → 主食调料
    var order = { protein: 0, veg: 1, staple: 2 };
    buy.sort(function (a, b) { return (order[a.kind] || 9) - (order[b.kind] || 9); });
    return { buy: buy, useStock: useStock, need: need };
  }

  /** 一次跑完 */
  function solve(opts) {
    var s1 = stage1(opts);
    if (!s1.picks.length) return { ok: false, reason: 'no-ingredients' };
    var s2 = stage2(s1, opts.servings, opts);
    if (!s2.ok) return { ok: false, stage1: s1, stage2: s2, reason: s2.reason };
    var s3 = finalizeShopping(s2.chosen, s1, opts);

    // 真实剩余 = 买回来的总量 − 菜谱实际用量,只算 fresh
    var freshBought = 0, freshLeft = 0, carryLeft = 0;
    s3.buy.forEach(function (b) {
      if (!b.plan) return;
      var leftover = b.plan.total - b.needGrams;
      if (b.ing.tier === 'fresh') { freshBought += b.plan.total; freshLeft += leftover; }
      else carryLeft += leftover;
    });
    return {
      ok: true, stage1: s1, stage2: s2, shopping: s3,
      freshBought: freshBought, freshLeft: freshLeft, carryLeft: carryLeft,
      wasteRatio: freshBought ? freshLeft / freshBought : 0,
    };
  }

  return {
    PROTEIN_PER_SERVING: PROTEIN_PER_SERVING, VEG_PER_SERVING: VEG_PER_SERVING,
    stage1: stage1, stage2: stage2, solve: solve,
  };
})();

if (typeof module !== 'undefined') module.exports = Solver;
