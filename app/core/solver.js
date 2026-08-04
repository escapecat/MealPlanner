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

    // 临期的必须先排进去 —— 这是硬约束,不是打分项
    mustUse.forEach(function (id) {
      var i = ing(id);
      if (!i) return;
      picks.push({ ingredientId: id, ing: i, reason: 'expiring',
                   needGrams: stock[id] || 0, fromStock: true });
    });

    function take(list, count, fallbackPerServing, kind, minDishes) {
      var n = 0;
      var servingsPerPick = Math.max(1, servings / Math.max(1, count));
      for (var k = 0; k < list.length && n < count; k++) {
        var c = list[k];
        if (picks.some(function (p) { return p.ingredientId === c.id; })) continue;
        // 只进 3 道菜的食材,买回去大概率用不掉 —— 这是浪费的主要来源
        if (c.dishes < (minDishes || 1)) continue;
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
    stage1Result.picks.forEach(function (p) {
      have[p.ingredientId] = 1;
      budget[p.ingredientId] = p.plan ? p.plan.total : (p.needGrams || 0);
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
                     missing: (typeof Pantry !== 'undefined')
                              ? Pantry.missingSeasonings(v).length : 0 });
      });
    });
    if (!cands.length) return { ok: false, reason: 'no-candidates' };


    var recent = opts.recentRecipeIds || {};
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

      while (chosen.length < servings && avail.length) {
        var weights = [], total = 0;
        for (var a = 0; a < avail.length; a++) {
          var cc = avail[a], helps = 0;
          for (var q = 0; q < cc.variant.ingredients.length; q++) {
            var x = cc.variant.ingredients[q];
            for (var z = 0; z < x.ids.length; z++) {
              var id = x.ids[z];
              if (left[id] > 0 && x.grams) helps += Math.min(left[id], x.grams);
            }
          }
          // 做法重复的降权但不禁止 ——「做法不重复」是软目标不是硬约束
          var w = (helps + 1) * (methods[cc.recipe.method] ? 0.25 : 1);
          weights.push(w); total += w;
        }
        var pick = rnd() * total, acc = 0, idx = weights.length - 1;
        for (var b = 0; b < weights.length; b++) {
          acc += weights[b];
          if (acc >= pick) { idx = b; break; }
        }
        var got = avail.splice(idx, 1)[0];
        if (usedRecipe[got.recipe.id]) continue;
        chosen.push(got);
        usedRecipe[got.recipe.id] = 1;
        methods[got.recipe.method] = 1;
        for (var q2 = 0; q2 < got.variant.ingredients.length; q2++) {
          var xx = got.variant.ingredients[q2];
          for (var z2 = 0; z2 < xx.ids.length; z2++) {
            var id2 = xx.ids[z2];
            if (left[id2] != null && xx.grams) left[id2] = Math.max(0, left[id2] - xx.grams);
          }
        }
      }
      if (chosen.length < servings) continue;

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

      var score = (1 - wasteRatio) * 100
                + Math.min(methodCount, servings) * 8
                - missing * 4
                - untouched * 25;



      if (!best || score > best.score) {
        best = { score: score, chosen: chosen, left: left,
                 wasteRatio: wasteRatio, methodCount: methodCount, missing: missing,
                 freshLeft: freshLeft, freshBought: freshBought, carryLeft: carryLeft };
      }
    }

    if (!best) return { ok: false, reason: 'cannot-fill', wanted: servings, candidates: cands.length };
    return Object.assign({ ok: true }, best);
  }

  /** 一次跑完两阶段 */
  function solve(opts) {
    var s1 = stage1(opts);
    if (!s1.picks.length) return { ok: false, reason: 'no-ingredients' };
    var s2 = stage2(s1, opts.servings, opts);
    return { ok: s2.ok, stage1: s1, stage2: s2, reason: s2.reason };
  }

  return {
    PROTEIN_PER_SERVING: PROTEIN_PER_SERVING, VEG_PER_SERVING: VEG_PER_SERVING,
    stage1: stage1, stage2: stage2, solve: solve,
  };
})();

if (typeof module !== 'undefined') module.exports = Solver;
