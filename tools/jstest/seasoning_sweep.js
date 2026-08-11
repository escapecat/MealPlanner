// 调料权重扫描 —— 「家里为什么全是调味料」这个问题的量化版。
//
// ⚠️ 这不是回归测试,是**定权重用的**。和 extraItems 那组权重一样,
//    这个项目的规矩是扫过再定,不拍脑袋。跑法:
//        node tools/jstest/seasoning_sweep.js
//
// 为什么必须多轮结转:调料柜是**跨轮累积**的。单轮看不出问题 ——
// 单轮只买 1~2 味,看着完全合理;要跑满半年才看得见柜子被堆成什么样。
//
// 模拟的是真实使用:开局只有核心 7 味,每轮把要买的新调料**真的加进柜子**,
// 下一轮它就成了「已有」。这样柜子只增不减,和现实一致。

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
// ⚠️ **Meal 必须加载。** solver.js 里配菜、主菜蛋白门槛、
//    portionScale/portionBoost 全在 `if (typeof Meal !== 'undefined')` 里面 ——
//    不加就**整块静默跳过**，模拟出来的是一个残缺的求解器：
//    一道素菜能单独成顿、蔬菜 0g 也不配青菜、份量一律不缩不加。
//    这条漏了的后果不是报错，是数字看着都对 —— 最难查的那种。
var Profile = require(path.join(APP, 'core/profile.js'));
global.Meal = require(path.join(APP, 'core/meal.js'));
var Solver = require(path.join(APP, 'core/solver.js'));

// 开局的调料柜 —— 和采购清单给的第一批一致
var CORE7 = ['salt', 'cooking_oil', 'light_soy_sauce', 'corn_starch',
             'cooking_wine', 'oyster_sauce', 'white_pepper'];

var ME = { sex: 'male', age: 32, heightCm: 175, weightKg: 72,
           activity: 'sedentary', goal: 'maintain', breakfast: 'normal' };
var TARGET = Profile.perPlannedMeal(Profile.dailyTargets(ME), ME.breakfast);

/** 跑一条时间线:rounds 轮，每轮 servings 顿，调料柜跨轮累积。
 *  budget = 本轮最多引入几味新调料(null = 不限)。 */
function timeline(weights, rounds, servings, cfg0, seed0, budget) {
  var cfg = Object.assign({}, cfg0);
  if (budget !== undefined) cfg.newSeasoningBudget = budget;
  db = {};
  Pantry.ensureInit();
  Store.set('staples', CORE7.map(function (id) {
    return { id: id, addedAt: null, openedAt: null };
  }));

  var day = 0, fails = 0, newPerRound = [];
  var bought = 0, wasted = 0;
  var recipesSeen = {}, mealCount = 0, log = [];

  for (var r = 0; r < rounds; r++) {
    var nowIso = new Date(Date.parse('2026-01-01T00:00:00Z') + day * 864e5).toISOString();
    var recent = {};
    log.slice(-2).forEach(function (L) { L.forEach(function (m) { recent[m] = 1; }); });

    var stock = {};
    Pantry.items().forEach(function (it) {
      stock[it.ingredientId] = (stock[it.ingredientId] || 0) + it.amount;
    });

    var out = Solver.solve({
      servings: servings, constraints: cfg, stock: stock, mustUse: [],
      stockDetail: Pantry.stockSummary(nowIso), target: TARGET,
      seed: seed0 + r * 7919, recentRecipeIds: recent, weights: weights,
    });
    if (!out.ok) { fails++; day += 7; log.push([]); continue; }

    // 本轮要新买的调料 —— **去重**,两道菜都要豆豉只买一瓶
    var newSeas = {};
    out.stage2.chosen.forEach(function (c) {
      (Pantry.missingSeasonings(c.variant) || []).forEach(function (id) { newSeas[id] = 1; });
    });
    var ids = Object.keys(newSeas);
    newPerRound.push(ids.length);
    // 买了 → 进柜子,下一轮就是「已有」
    ids.forEach(function (id) { Pantry.toggleStaple(id, nowIso); });

    var names = [];
    out.stage2.chosen.forEach(function (c) {
      names.push(c.recipe.id);
      recipesSeen[c.recipe.id] = 1; mealCount++;
    });
    log.push(names);

    out.shopping.buy.forEach(function (b) {
      if (!b.plan) return;
      bought += b.plan.total;
      if (b.ing.tier === 'fresh') wasted += Math.max(0, b.plan.total - b.needGrams);
      Pantry.addFromPackage({ id: b.ingredientId, ingredientId: b.ingredientId,
                              netWeight: b.plan.total, unit: b.plan.option.unit }, nowIso);
    });
    out.stage2.chosen.forEach(function (c) {
      (c.variant.ingredients || []).forEach(function (it) {
        if (it.grams) Pantry.consume(it.ids[0], it.grams, nowIso);
      });
    });
    day += 7;
  }

  var finalStaples = (Pantry.staples() || []).length;
  return {
    finalStaples: finalStaples,
    added: finalStaples - CORE7.length,
    perRound: newPerRound.length
      ? (newPerRound.reduce(function (a, b) { return a + b; }, 0) / newPerRound.length) : 0,
    variety: Object.keys(recipesSeen).length,
    meals: mealCount,
    wasteRatio: bought ? wasted / bought : 0,
    fails: fails,
  };
}

// ---------------- 扫 ----------------

var FAST = !!process.env.SWEEP_FAST;
var ROUNDS = FAST ? 6 : 26;              // 半年
var SERVINGS = 4;             // 一周 4 顿 —— 周末两天
var ALL_SCENARIOS = [
  { name: '一口不粘炒锅', cfg: { equipment: ['炒锅', '不粘锅'], maxActiveMinutes: 30, spicy: 1 } },
  { name: '+汤锅蒸架',   cfg: { equipment: ['炒锅', '不粘锅', '汤锅', '蒸架'], maxActiveMinutes: 30, spicy: 1 } },
  { name: '全套厨具',     cfg: { equipment: ['炒锅', '汤锅', '不粘锅', '蒸架', '空气炸锅', '砂锅', '电饭煲', '烤箱'], maxActiveMinutes: 45, spicy: 2 } },
];
var SCENARIOS = FAST ? [ALL_SCENARIOS[1]] : ALL_SCENARIOS;
var SEEDS = FAST ? [11] : [11, 29, 53];
var WEIGHTS = FAST ? [4, 25] : [4, 8, 12, 20, 25, 30, 40];

console.log('调料权重扫描 —— ' + ROUNDS + ' 轮 × ' + SERVINGS + ' 顿 × '
  + SCENARIOS.length + ' 场景 × ' + SEEDS.length + ' 组种子 = '
  + (ROUNDS * SCENARIOS.length * SEEDS.length) + ' 轮 / 每个权重');
console.log('开局 7 味,每轮买的新调料真的进柜子(跨轮累积)\n');
console.log('权重   半年后柜子   新增   每轮新增   菜品种类   浪费率   失败');
console.log('----------------------------------------------------------------');

var rows = [];
WEIGHTS.forEach(function (w) {
  var acc = { finalStaples: 0, added: 0, perRound: 0, variety: 0, wasteRatio: 0, fails: 0 };
  var n = 0;
  SCENARIOS.forEach(function (sc) {
    SEEDS.forEach(function (sd) {
      var r = timeline({ missing: w }, ROUNDS, SERVINGS, sc.cfg, sd);
      acc.finalStaples += r.finalStaples; acc.added += r.added;
      acc.perRound += r.perRound; acc.variety += r.variety;
      acc.wasteRatio += r.wasteRatio; acc.fails += r.fails;
      n++;
    });
  });
  var row = {
    w: w,
    staples: (acc.finalStaples / n).toFixed(1),
    added: (acc.added / n).toFixed(1),
    per: (acc.perRound / n).toFixed(2),
    variety: (acc.variety / n).toFixed(1),
    waste: (acc.wasteRatio / n * 100).toFixed(1),
    fails: acc.fails,
  };
  rows.push(row);
  console.log(String(row.w).padStart(4)
    + String(row.staples).padStart(12) + ' 味'
    + String(row.added).padStart(7)
    + String(row.per).padStart(10)
    + String(row.variety).padStart(11) + ' 道'
    + String(row.waste).padStart(8) + '%'
    + String(row.fails).padStart(7));
});

console.log('\n（菜品种类 = 半年里吃到过多少道不同的菜，越高越不单调；'
  + '浪费率和失败数是护栏，不能为了少买调料把它们弄坏）');

// ---------------- 第二张表:预算 ----------------
//
// ⚠️ **权重和预算不是同一种东西,别指望调权重能替代预算。**
//    上面那张表说明了:权重从 4 提到 25(六倍),半年后的柜子只从 60 味
//    降到 44 味 —— 因为扣分只是让「买新调料」变得不划算,
//    只要那道菜别的方面够好,它照样被选中。
//
// 检验标准是**人的常识**,不是相对改善:正常人家里厨房 10~20 种调料,
// 60 种是餐厅备料柜。所以这里看的是绝对值能不能落进那个区间。

console.log('\n\n============ 预算维度(权重固定 20) ============');
console.log('预算     半年后柜子   新增   每轮新增   菜品种类   浪费率   失败');
console.log('----------------------------------------------------------------');

[0, 1, 2, null].forEach(function (b) {
  var acc = { finalStaples: 0, added: 0, perRound: 0, variety: 0, wasteRatio: 0, fails: 0 };
  var n = 0;
  SCENARIOS.forEach(function (sc) {
    SEEDS.forEach(function (sd) {
      var r = timeline({ missing: 20 }, ROUNDS, SERVINGS, sc.cfg, sd, b);
      acc.finalStaples += r.finalStaples; acc.added += r.added;
      acc.perRound += r.perRound; acc.variety += r.variety;
      acc.wasteRatio += r.wasteRatio; acc.fails += r.fails;
      n++;
    });
  });
  var label = (b === null ? '不限' : b + ' 味');
  console.log(label.padEnd(8)
    + (acc.finalStaples / n).toFixed(1).padStart(10) + ' 味'
    + (acc.added / n).toFixed(1).padStart(7)
    + (acc.perRound / n).toFixed(2).padStart(10)
    + (acc.variety / n).toFixed(1).padStart(11) + ' 道'
    + (acc.wasteRatio / n * 100).toFixed(1).padStart(8) + '%'
    + String(acc.fails).padStart(7));
});

console.log('\n（验收标准:半年后柜子落在 10~20 味 —— 正常人家里的量。'
  + '60 味是餐厅备料柜,不是家）');
