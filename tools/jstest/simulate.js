// 求解器模拟器 —— 跑成百上千种场景,看输出合不合理。
//
// 为什么要有它:在这之前我只用手挑的 4 个场景测过,那和「抽查三组别名」是同一个毛病 ——
// 查过的对不代表没查的对。而且有些问题只在大量样本里才看得出来:
//   · 失败率(约束紧到排不出来)
//   · 单调性(是不是永远推荐同样几样食材)
//   · 跨轮重复(连着两周吃一样的)
//   · **营养达标率** —— 求解器压根没把它写进打分,这是最大的盲区
//
// 用法:  node tools/jstest/simulate.js [轮数]

var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');

global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));
global.PACKAGES = require(path.join(APP, 'data/packages.js'));

var db = {};
global.Store = {
  get: function (k, f) { return db[k] !== undefined ? db[k] : (f === undefined ? null : f); },
  set: function (k, v) { db[k] = v; },
};
global.Equipment = require(path.join(APP, 'core/equipment.js'));
global.Catalog = require(path.join(APP, 'core/catalog.js'));
global.Packaging = require(path.join(APP, 'core/packaging.js'));
global.Pantry = require(path.join(APP, 'core/pantry.js'));
global.Nutrition = require(path.join(APP, 'core/nutrition.js'));
var Profile = require(path.join(APP, 'core/profile.js'));
var Solver = require(path.join(APP, 'core/solver.js'));

function ing(id) { return INGREDIENTS.filter(function (i) { return i.id === id; })[0]; }

// ---------------- 场景网格 ----------------

var EQUIP = [
  ['炒锅'],
  ['炒锅', '汤锅'],
  ['不粘锅', '汤锅'],
  ['炒锅', '汤锅', '不粘锅', '蒸架'],
  ['炒锅', '汤锅', '不粘锅', '蒸架', '空气炸锅', '砂锅', '电饭煲', '烤箱', '电压力锅'],
];
var SPICY = [0, 1, 2, 3];
var TIME = [15, 20, 30, 45, 999];
var SERVINGS = [2, 3, 4, 6, 8, 12];
var BLACKLIST = [
  [],
  ['cilantro'],
  ['pork_belly', 'pork_mince'],                 // 不吃猪肉
  ['@category:内脏', 'cilantro', 'bitter_melon'],
];

function scenarios() {
  var out = [];
  EQUIP.forEach(function (eq) {
    SPICY.forEach(function (sp) {
      TIME.forEach(function (t) {
        SERVINGS.forEach(function (n) {
          BLACKLIST.forEach(function (bl) {
            out.push({ equipment: eq, maxSpicy: sp, maxActiveMinutes: t,
                       servings: n, blacklist: bl });
          });
        });
      });
    });
  });
  return out;
}

// ---------------- 营养核算 ----------------

/** 这一顿实际提供多少 kcal / 蛋白 / 蔬菜 —— 从食材字典算,不是菜谱上填的 */
function nutritionOf(variant) {
  var k = 0, p = 0, veg = 0;
  variant.ingredients.forEach(function (x) {
    var id = x.ids[0];
    var i = ing(id);
    if (!i) return;
    var g = x.grams;
    if (g == null && x.qty && x.unit && i.unitConv && i.unitConv[x.unit]) {
      g = x.qty * i.unitConv[x.unit];          // 计件的按单位换算折成克
    }
    if (g == null) return;
    if (i.per100g) {
      if (i.per100g.kcal) k += g * i.per100g.kcal / 100;
      if (i.per100g.protein) p += g * i.per100g.protein / 100;
    }
    if (i.countsAsVeg) veg += g;
  });
  return { kcal: Math.round(k), protein: Math.round(p), veg: Math.round(veg) };
}

// ---------------- 跑 ----------------

function pct(a, b) { return b ? (a / b * 100) : 0; }

function run(limit) {
  var all = scenarios();
  // 均匀抽样而不是取前 N —— 取前 N 会让某几维永远是同一个值
  var step = Math.max(1, Math.floor(all.length / (limit || all.length)));
  var cases = [];
  for (var i = 0; i < all.length && cases.length < (limit || all.length); i += step) {
    cases.push(all[i]);
  }

  db.staples = null;
  Pantry.ensureInit();

  var me = { sex: 'male', age: 32, heightCm: 175, weightKg: 72,
             activity: 'sedentary', goal: 'maintain', breakfast: 'normal' };
  var daily = Profile.dailyTargets(me);
  var target = Profile.perPlannedMeal(daily, me.breakfast);

  var stats = {
    n: 0, fail: 0, failReasons: {},
    waste: [], methods: [], missing: [], time: [],
    kcal: [], protein: [], veg: [],
    ingredientPicks: {}, recipePicks: {},
    slowest: 0,
  };
  var problems = [];

  cases.forEach(function (c) {
    var t0 = Date.now();
    var out = Solver.solve({
      servings: c.servings,
      constraints: { equipment: c.equipment, maxSpicy: c.maxSpicy,
                     maxActiveMinutes: c.maxActiveMinutes,
                     blacklist: Catalog.expandBlacklist(c.blacklist) },
      stock: {}, mustUse: [], stockDetail: [],
      target: target, seed: stats.n * 7919 + c.servings,
    });
    var ms = Date.now() - t0;
    stats.slowest = Math.max(stats.slowest, ms);
    stats.n++;

    if (!out.ok) {
      stats.fail++;
      stats.failReasons[out.reason || '?'] = (stats.failReasons[out.reason || '?'] || 0) + 1;
      return;
    }

    stats.waste.push(out.wasteRatio);
    stats.methods.push(out.stage2.methodCount / c.servings);
    stats.missing.push(out.stage2.missing / c.servings);

    out.shopping.buy.forEach(function (p) {
      stats.ingredientPicks[p.ingredientId] = (stats.ingredientPicks[p.ingredientId] || 0) + 1;
    });

    var maxT = 0;
    out.stage2.chosen.forEach(function (ch) {
      stats.recipePicks[ch.recipe.id] = (stats.recipePicks[ch.recipe.id] || 0) + 1;
      maxT = Math.max(maxT, ch.variant.activeMinutes || 0);
      var nu = Nutrition.ofMeal(ch.variant);
      stats.kcal.push(nu.kcal);
      stats.protein.push(nu.protein);
      stats.veg.push(nu.veg);
    });
    stats.time.push(maxT);

    // —— 逐条检查「合不合理」,不只统计
    if (maxT > c.maxActiveMinutes) {
      problems.push('耗时超限: 上限' + c.maxActiveMinutes + ' 实际' + maxT + '  ' + JSON.stringify(c));
    }
    if (out.wasteRatio > 0.35) {
      problems.push('生鲜浪费 ' + (out.wasteRatio * 100).toFixed(0) + '%  ' + JSON.stringify(c));
    }
    if (out.stage2.methodCount < 2 && c.servings >= 4) {
      problems.push('做法只有 ' + out.stage2.methodCount + ' 种  ' + JSON.stringify(c));
    }
    var names = out.stage2.chosen.map(function (x) { return x.recipe.id; });
    if (new Set(names).size !== names.length) {
      problems.push('同一轮出现重复菜  ' + JSON.stringify(c));
    }
  });

  // ---------------- 报告 ----------------

  function stat(arr) {
    if (!arr.length) return { avg: 0, p50: 0, p90: 0, max: 0 };
    var s = arr.slice().sort(function (a, b) { return a - b; });
    return {
      avg: arr.reduce(function (a, b) { return a + b; }, 0) / arr.length,
      p50: s[Math.floor(s.length * 0.5)],
      p90: s[Math.floor(s.length * 0.9)],
      max: s[s.length - 1],
    };
  }

  console.log('=== 跑了 ' + stats.n + ' 个场景(共 ' + all.length + ' 种组合)· 最慢 ' + stats.slowest + 'ms');
  console.log('失败 ' + stats.fail + ' 次 (' + pct(stats.fail, stats.n).toFixed(1) + '%)'
    + (Object.keys(stats.failReasons).length ? '  ' + JSON.stringify(stats.failReasons) : ''));

  var w = stat(stats.waste);
  console.log('\n生鲜浪费    平均 ' + (w.avg * 100).toFixed(1) + '%  中位 ' + (w.p50 * 100).toFixed(0)
    + '%  p90 ' + (w.p90 * 100).toFixed(0) + '%  最差 ' + (w.max * 100).toFixed(0) + '%');
  var m = stat(stats.methods);
  console.log('做法多样性  平均每顿 ' + m.avg.toFixed(2) + ' 种(1.0 = 顿顿不同做法)');
  var ms2 = stat(stats.missing);
  console.log('缺调料      平均每顿 ' + ms2.avg.toFixed(2) + ' 样  最差 ' + ms2.max.toFixed(1));

  console.log('\n=== 营养(目标:单顿 ' + target.kcal + ' kcal · 蛋白 ' + target.protein
    + 'g · 蔬菜 ' + target.veg + 'g)');
  var k = stat(stats.kcal), p = stat(stats.protein), v = stat(stats.veg);
  console.log('  实际 kcal   中位 ' + k.p50 + '  平均 ' + k.avg.toFixed(0)
    + '   达标率 ' + pct(stats.kcal.filter(function (x) { return x >= target.kcal * 0.8; }).length, stats.kcal.length).toFixed(0) + '%');
  console.log('  实际 蛋白   中位 ' + p.p50 + 'g  平均 ' + p.avg.toFixed(0)
    + 'g  达标率 ' + pct(stats.protein.filter(function (x) { return x >= target.protein * 0.8; }).length, stats.protein.length).toFixed(0) + '%');
  console.log('  实际 蔬菜   中位 ' + v.p50 + 'g  平均 ' + v.avg.toFixed(0)
    + 'g  达标率 ' + pct(stats.veg.filter(function (x) { return x >= target.veg * 0.8; }).length, stats.veg.length).toFixed(0) + '%');

  console.log('\n=== 单调性(总共选了多少种不同的东西)');
  var ip = Object.keys(stats.ingredientPicks).length;
  var rp = Object.keys(stats.recipePicks).length;
  console.log('  食材 ' + ip + ' 种被选过 · 菜 ' + rp + ' 道被排过(库里 512 道)');
  console.log('  最常被选的食材:');
  Object.keys(stats.ingredientPicks).sort(function (a, b) {
    return stats.ingredientPicks[b] - stats.ingredientPicks[a];
  }).slice(0, 10).forEach(function (id) {
    var i = ing(id);
    console.log('     ' + String(Math.round(pct(stats.ingredientPicks[id], stats.n))).padStart(3)
      + '%  ' + (i ? i.name : id));
  });
  console.log('  最常被排的菜:');
  Object.keys(stats.recipePicks).sort(function (a, b) {
    return stats.recipePicks[b] - stats.recipePicks[a];
  }).slice(0, 8).forEach(function (id) {
    var r = RECIPES.filter(function (x) { return x.id === id; })[0];
    console.log('     ' + String(Math.round(pct(stats.recipePicks[id], stats.n))).padStart(3)
      + '%  ' + (r ? r.name : id));
  });

  if (problems.length) {
    console.log('\n=== ⚠️ 具体问题 ' + problems.length + ' 条(前 20)');
    problems.slice(0, 20).forEach(function (p2) { console.log('   ' + p2); });
  } else {
    console.log('\n没有触发任何硬性检查。');
  }
  return { stats: stats, problems: problems };
}

run(parseInt(process.argv[2], 10) || 300);

// ============================================================
// 多轮模拟 —— 带库存结转。
//
// 单轮模拟有个根本缺陷:每次空库存开始,剩下的东西永远算纯损失。
// 但真实情况是剩菜进冰箱,下一轮被优先吃掉 —— 这才是「食材流转管理器」的意思。
// 只测单轮,等于把这个应用最核心的机制排除在测试之外。
// ============================================================

function multiRound(rounds, servingsPerRound, cfg, label) {
  db.pantryItems = [];
  db.staples = null;
  Pantry.ensureInit();

  var me = { sex: 'male', age: 32, heightCm: 175, weightKg: 72,
             activity: 'sedentary', goal: 'maintain', breakfast: 'normal' };
  var target = Profile.perPlannedMeal(Profile.dailyTargets(me), me.breakfast);

  var day = 0;
  var totalBought = 0, totalWasted = 0, totalEaten = 0;
  var wastedBy = {}, boughtBy = {};
  var seenRecipes = {}, repeats = 0, totalMeals = 0;
  var log = [];

  for (var r = 0; r < rounds; r++) {
    var nowIso = new Date(Date.parse('2026-01-01T00:00:00Z') + day * 864e5).toISOString();

    // 上一轮的冷却期
    var recent = {};
    log.slice(-2).forEach(function (L) {
      L.meals.forEach(function (m) { recent[m] = 1; });
    });

    var stock = {};
    Pantry.items().forEach(function (it) {
      stock[it.ingredientId] = (stock[it.ingredientId] || 0) + it.amount;
    });

    var out = Solver.solve({
      servings: servingsPerRound, constraints: cfg,
      stock: stock, mustUse: [],
      stockDetail: Pantry.stockSummary(nowIso),
      target: target, seed: r * 7919 + servingsPerRound,
      recentRecipeIds: recent,
    });
    if (!out.ok) { log.push({ fail: out.reason, meals: [] }); day += 7; continue; }

    // 买 → 入库
    out.shopping.buy.forEach(function (b) {
      if (!b.plan) return;
      totalBought += b.plan.total;
      boughtBy[b.ingredientId] = (boughtBy[b.ingredientId] || 0) + b.plan.total;
      Pantry.addFromPackage({ id: b.ingredientId, ingredientId: b.ingredientId,
                              netWeight: b.plan.total, unit: b.plan.option.unit }, nowIso);
    });

    // 做 → 扣减
    var meals = [];
    out.stage2.chosen.forEach(function (c) {
      meals.push(c.recipe.id);
      totalMeals++;
      if (seenRecipes[c.recipe.id]) repeats++;
      seenRecipes[c.recipe.id] = 1;
      c.variant.ingredients.forEach(function (x) {
        var g = Nutrition.gramsOf(x);
        if (g != null) { Pantry.consume(x.ids[0], g, nowIso); totalEaten += g; }
      });
    });

    day += 7;
    // 一周后:过期的算扔掉
    var later = new Date(Date.parse(nowIso) + 7 * 864e5).toISOString();
    var alive = [];
    Pantry.items().forEach(function (it) {
      if (it.expiresAt && Date.parse(it.expiresAt) < Date.parse(later)) {
        totalWasted += it.amount;
        wastedBy[it.ingredientId] = (wastedBy[it.ingredientId] || 0) + it.amount;
      } else alive.push(it);
    });
    db.pantryItems = alive;

    log.push({ meals: meals, buy: out.shopping.buy.length,
               waste: out.wasteRatio, carry: alive.length });
  }

  var fails = log.filter(function (L) { return L.fail; }).length;
  console.log('\n--- ' + label + '(' + rounds + ' 轮 × ' + servingsPerRound + ' 份)');
  console.log('    买入 ' + Math.round(totalBought / 1000) + 'kg · 吃掉 ' + Math.round(totalEaten / 1000)
    + 'kg · **过期扔掉 ' + Math.round(totalWasted / 1000) + 'kg ('
    + (totalBought ? (totalWasted / totalBought * 100).toFixed(1) : 0) + '%)**');
  console.log('    排了 ' + totalMeals + ' 顿 · 不同的菜 ' + Object.keys(seenRecipes).length
    + ' 道 · 重复 ' + repeats + ' 次 · 失败 ' + fails + ' 轮');
  console.log('    最后冰箱剩 ' + Pantry.items().length + ' 项');
  var top = Object.keys(wastedBy).sort(function (a2, b2) { return wastedBy[b2] - wastedBy[a2]; }).slice(0, 6);
  if (top.length) {
    console.log('    扔得最多的:');
    top.forEach(function (id) {
      var i = ing(id);
      var bought = boughtBy[id] || 0;
      console.log('       ' + (i ? i.name : id).padEnd(8) +
        '扔 ' + String(Math.round(wastedBy[id])).padStart(5) + 'g / 买 ' + String(Math.round(bought)).padStart(5) + 'g' +
        '  (' + (bought ? (wastedBy[id] / bought * 100).toFixed(0) : '?') + '%)' +
        '  最小包装 ' + (function () { var o = Packaging.smallest(id); return o ? o.netWeight + o.unit : '?'; })() +
        '  冷藏 ' + (i && i.shelfLifeDays ? i.shelfLifeDays + '天' : '?'));
    });
  }
  return { wasteRate: totalBought ? totalWasted / totalBought : 0, repeats: repeats };
}

console.log('\n\n============ 多轮结转模拟 ============');
var full = ['炒锅', '汤锅', '不粘锅', '蒸架', '空气炸锅', '砂锅', '电饭煲', '烤箱', '电压力锅'];
multiRound(12, 4, { equipment: full, maxSpicy: 2, maxActiveMinutes: 30, blacklist: [] }, '一人两天 · 全厨具');
multiRound(12, 2, { equipment: ['炒锅', '汤锅'], maxSpicy: 1, maxActiveMinutes: 20, blacklist: [] }, '一人一天 · 两口锅 · 20分钟');
multiRound(12, 8, { equipment: full, maxSpicy: 3, maxActiveMinutes: 45, blacklist: [] }, '两人两天 · 全厨具');
