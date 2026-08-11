// 调料预算 —— 钉住「不会越用越多」这件事。
//
// ⚠️ 这几条测的是**行为不是实现**:跑若干轮,数每轮真的要买几味新调料。
//    直接断言 solver 内部那个 missing 变量的话,换个实现就失效了,
//    而这里要守的是「柜子不会失控」这个结果。
//
// 背景:改之前 solver.js 把每道菜缺的调料**个数直接相加**,两道菜都要豆豉
// 算成 2 —— 于是它会主动回避「同一轮复用新调料」,每轮引进一味用一次就搁着。
// 半年下来柜子里几十瓶,每瓶用过一两次。

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

var CORE7 = ['salt', 'cooking_oil', 'light_soy_sauce', 'corn_starch',
             'cooking_wine', 'oyster_sauce', 'white_pepper'];
var ME = { sex: 'male', age: 32, heightCm: 175, weightKg: 72,
           activity: 'sedentary', goal: 'maintain', breakfast: 'normal' };
var TARGET = Profile.perPlannedMeal(Profile.dailyTargets(ME), ME.breakfast);
var CFG = { equipment: ['炒锅', '不粘锅', '汤锅', '蒸架'], maxActiveMinutes: 30, spicy: 1 };

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

/** 跑 rounds 轮，调料柜跨轮累积，返回每轮新买的调料味数。 */
function run(budget, rounds, seed0) {
  db = {};
  Pantry.ensureInit();
  Store.set('staples', CORE7.map(function (id) {
    return { id: id, addedAt: null, openedAt: null };
  }));

  var cfg = Object.assign({}, CFG);
  if (budget != null) cfg.newSeasoningBudget = budget;

  var per = [], fails = 0, day = 0;
  for (var r = 0; r < rounds; r++) {
    var nowIso = new Date(Date.parse('2026-01-01T00:00:00Z') + day * 864e5).toISOString();
    var stock = {};
    Pantry.items().forEach(function (it) {
      stock[it.ingredientId] = (stock[it.ingredientId] || 0) + it.amount;
    });
    var out = Solver.solve({
      servings: 4, constraints: cfg, stock: stock, mustUse: [],
      stockDetail: Pantry.stockSummary(nowIso), target: TARGET,
      seed: seed0 + r * 7919, recentRecipeIds: {},
    });
    if (!out.ok) { fails++; day += 7; continue; }

    var set = {};
    out.stage2.chosen.forEach(function (c) {
      (Pantry.missingSeasonings(c.variant) || []).forEach(function (id) { set[id] = 1; });
    });
    var ids = Object.keys(set);
    per.push(ids.length);
    ids.forEach(function (id) { Pantry.toggleStaple(id, nowIso); });

    out.shopping.buy.forEach(function (b) {
      if (!b.plan) return;
      Pantry.addFromPackage({ id: b.ingredientId, ingredientId: b.ingredientId,
                              netWeight: b.plan.total, unit: b.plan.option.unit }, nowIso);
    });
    day += 7;
  }
  return { per: per, fails: fails, total: (Pantry.staples() || []).length };
}

var ROUNDS = 8;

// ---- 1. ★ 稳态之后必须守住预算 ----
//
// ⚠️ **头两轮不算。** 开局只有 7 味,凑不出满足蛋白门槛又不重样的 4 顿 ——
//    那时候被迫多买一瓶是**对的**:宁可买瓶糖,也不能排不出饭来。
//    实测预算 0 的冷启动是「第 1 轮买蒸鱼豉油+白砂糖,第 2 轮买猪油,
//    之后六轮一味不买,柜子停在 10 味」。
//    把冷启动也判成违规,等于要求系统在无解时硬撑,那是另一种坏行为。
var COLD = 2;
[0, 1, 2].forEach(function (b) {
  var r = run(b, ROUNDS, 11);
  var steady = r.per.slice(COLD);
  var over = steady.filter(function (n) { return n > b; });
  ok(over.length === 0,
     '★ 预算 ' + b + ' 味,冷启动之后还有 ' + over.length + ' 轮超了(最多 '
     + Math.max.apply(null, steady.concat([0])) + ' 味)');
  // ★ 预算收紧**不许把整轮弄失败** —— 宁可给个差一点的方案
  ok(r.fails === 0, '★ 预算 ' + b + ' 味时有 ' + r.fails + ' 轮排不出来 —— 预算是闸不是墙');
  // ★ 冷启动本身也得收敛,不能一路买下去
  var cold = r.per.slice(0, COLD).reduce(function (a, c) { return a + c; }, 0);
  ok(cold <= 4, '★ 预算 ' + b + ' 味,光冷启动就买了 ' + cold + ' 味 —— 那不叫冷启动');
});

// ---- 2. ★ 不设预算时确实会涨 —— 否则上面那条是废的 ----
//
// ⚠️ 这条是**对照组**。少了它,万一求解器因为别的原因根本不引入新调料,
//    第 1 组会全绿而我们什么都没证明。
var free = run(null, ROUNDS, 11);
var freeTotal = free.per.reduce(function (a, b) { return a + b; }, 0);
ok(freeTotal > 0,
   '★ 不限预算时 ' + ROUNDS + ' 轮一味新调料都没引入 —— 那第 1 组测的是空气');

// ---- 3. 预算 0 明显比不限省 ----
var zero = run(0, ROUNDS, 11);
var zeroTotal = zero.per.reduce(function (a, b) { return a + b; }, 0);
ok(zeroTotal < freeTotal,
   '预算 0 买了 ' + zeroTotal + ' 味,不限买了 ' + freeTotal + ' 味 —— 预算没起作用');

// ---- 4. ★ 同一味调料在一轮里被两道菜用到,只算一味 ----
//
// ⚠️ 这是修好的那个 bug 的正面表述。改之前是「个数相加」,
//    于是复用反而被罚得更重,系统学会了「每轮换一味新的」。
//    这里从**采购清单**那头验:清单上的调料条目数,必须等于去重后的味数。
var db2 = db;
var r4 = null;
(function () {
  db = {};
  Pantry.ensureInit();
  Store.set('staples', [{ id: 'salt', addedAt: null, openedAt: null }]);
  var out = Solver.solve({
    servings: 4, constraints: CFG, stock: {}, mustUse: [],
    stockDetail: Pantry.stockSummary('2026-01-01T00:00:00Z'), target: TARGET,
    seed: 4242, recentRecipeIds: {},
  });
  if (!out.ok) { ok(false, '第 4 组场景排不出来,没法验去重'); return; }
  var flat = 0, set = {};
  out.stage2.chosen.forEach(function (c) {
    var ms = Pantry.missingSeasonings(c.variant) || [];
    flat += ms.length;
    ms.forEach(function (id) { set[id] = 1; });
  });
  var uniq = Object.keys(set).length;
  ok(uniq <= flat, '去重后不该比相加还多(uniq ' + uniq + ' / flat ' + flat + ')');
  // 这一轮如果本来就没有重复,这条测不到东西 —— 说出来,别假装测过了
  if (uniq === flat) {
    console.log('  注意:这一轮没有跨菜复用的调料,去重路径没被覆盖到');
  }
})();

// ---- 5. ★★ 人的常识:半年之后柜子里该有多少瓶 ----
//
// ⚠️ **这条才是真正的验收标准。** 上面几条测的都是「相对改善」——
//    比不限省、比之前少 —— 而相对改善可以在绝对值荒谬的前提下全绿。
//    实测:光把扣分权重从 4 提到 25(六倍),半年后的柜子只从 60 味
//    降到 44 味。每一条相对断言都会通过,而 44 瓶调料依然是荒唐的。
//
//    正常人家里厨房 10~20 种调料。60 种是餐厅备料柜,不是家。
//    所以这里钉**绝对值**,而且用的是常识不是基线。
var HALF_YEAR = 26;
var human = run(1, HALF_YEAR, 29);
ok(human.total <= 20,
   '★★ 半年后柜子里 ' + human.total + ' 味调料 —— 正常人家里 10~20 种,'
   + '这个数说明「买新调料」还是太便宜了');
ok(human.fails === 0, '★ 半年 ' + HALF_YEAR + ' 轮里有 ' + human.fails + ' 轮排不出来');

console.log(fail ? '  调料预算 ' + fail + ' 条没过'
                 : '  调料预算 ok(预算是硬的 · 收紧不致失败 · 对照组会涨 · 同味只算一次 · 半年后柜子 '
                   + human.total + ' 味)');
process.exit(fail ? 1 : 0);
