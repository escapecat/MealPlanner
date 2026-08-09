// 页面显示的数字,和求解器实际按什么排的、清单实际按什么买的,必须是同一个数。
//
// ⚠️ 这一条以前**完全没人测**,而它已经出过一次:
//    portionScale 加进求解器之后,rounds.js 里 `scale` 出现 0 次 ——
//    求解器按 90g 米排、清单按 90g 买,页面却重算出「米饭 250g · 1303 kcal」。
//    页面不报错、清单不报错,只是两边说的不是一回事,而**页面在骗人**。
//    主食轮换同样:页面 ofMeal() 重算时又变回白米。
//
// 这类故障的形状是固定的:求解器算出新东西 → 忘了存 → 页面重算 → 显示旧值。
// 所以这里测的不是某个数,是「**求解器产出的每一项调整,页面都得知道**」。
var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');
global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));
global.PACKAGES = require(path.join(APP, 'data/packages.js'));
// ⚠️ 主食走 grainPrefs(「我愿意吃哪些」),不是调料柜 —— 那条路已经改掉了。
//    继续写在 staples 里的话这个夹具就是空的,「换过主食」永远是 0,
//    而这条测试正好是防「页面重算时主食又变回白米」的:**夹具一空,它就白跑**。
var db = { staples: [], staplesMigrated: true, staplesConfirmed: true,
           grainsSplitMigrated: true,
           grainPrefs: ['rice', 'brown_rice', 'sweet_potato'] };
global.Store = { get: function (k, f) { return db[k] !== undefined ? db[k] : (f === undefined ? null : f); },
                 set: function (k, v) { db[k] = v; } };
global.Equipment = require(path.join(APP, 'core/equipment.js'));
global.Timing = require(path.join(APP, 'core/timing.js'));
global.Catalog = require(path.join(APP, 'core/catalog.js'));
global.Packaging = require(path.join(APP, 'core/packaging.js'));
global.Pantry = require(path.join(APP, 'core/pantry.js'));
global.Nutrition = require(path.join(APP, 'core/nutrition.js'));
global.Meal = require(path.join(APP, 'core/meal.js'));
var Profile = require(path.join(APP, 'core/profile.js'));
var Solver = require(path.join(APP, 'core/solver.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
var daily = Profile.dailyTargets({ sex: 'male', age: 30, heightCm: 175, weightKg: 70,
                                   activity: 'light', goal: 'cut' });
var T = Profile.perPlannedMeal(daily, 'light');
var CONS = { equipment: ['炒锅', '空气炸锅', '电饭煲'], maxSpicy: 1, maxActiveMinutes: 45,
             maxDifficulty: 3, maxIdleWait: 60, allowOvernight: false, blacklist: [] };

// rounds.js 存下来的字段(和 generate() 里那段保持一致)。
// 少存一样,下面的重算就会和求解器对不上 —— 这正是要抓的。
function persist(c) {
  return {
    scale: c.scale ? { cuts: c.scale.cuts, kcal: c.scale.kcal, protein: c.scale.protein } : null,
    staple: (c.nutrition && c.nutrition.staple) ? c.nutrition.staple : null,
    boost: c.boost, topUp: c.topUp, side: c.side, variant: c.variant,
  };
}

// 页面的重算路径(rounds.js:854 起那几行的等价物)
function redisplay(m) {
  var nu = Nutrition.ofMeal(m.variant);
  if (m.staple && nu.staple && m.staple.ingredientId !== nu.staple.ingredientId) {
    nu = Nutrition.swapStaple(nu, m.staple.ingredientId, m.staple.grams);
  }
  var sideNu = (m.side && m.side._cand) ? Nutrition.ofVariant(m.side._cand.variant) : null;
  var k = (m.topUp ? m.topUp.kcal : 0) + (m.boost ? m.boost.kcal : 0) - (m.scale ? m.scale.kcal : 0);
  var p = (m.topUp ? m.topUp.protein : 0) + (m.boost ? m.boost.protein : 0)
        - (m.scale ? m.scale.protein : 0);
  return { kcal: nu.kcal + (sideNu ? sideNu.kcal : 0) + k,
           protein: nu.protein + (sideNu ? sideNu.protein : 0) + p };
}

var checked = 0, worstK = 0, worstP = 0, worstWhat = '', sawScale = 0, sawSwap = 0;
for (var s = 0; s < 30; s++) {
  var o = Solver.solve({ servings: 4, constraints: CONS, stock: {}, mustUse: [],
                         target: T, recentRecipeIds: {}, seed: s });
  if (!o.ok) continue;
  o.stage2.chosen.forEach(function (c) {
    if (!c.nutrition) return;
    var shown = redisplay(persist(c));
    checked++;
    if (c.scale) sawScale++;
    if (c.nutrition.staple && c.nutrition.staple.ingredientId !== 'rice') sawSwap++;
    var dk = Math.abs(shown.kcal - c.nutrition.kcal);
    var dp = Math.abs(shown.protein - c.nutrition.protein);
    if (dk > worstK) { worstK = dk; worstWhat = c.recipe.name; }
    if (dp > worstP) worstP = dp;
  });
}

// 允许几卡的四舍五入误差,但不允许量级差异。
ok(worstK <= 5, '页面算出来的热量和求解器差 ' + worstK + ' kcal(' + worstWhat + ')');
ok(worstP <= 3, '页面算出来的蛋白和求解器差 ' + worstP + 'g');

// 前提:样本里得真的出现过缩放和换主食,否则上面两条是空过。
ok(sawScale > 0, '30 轮里一顿都没缩过份量 —— 这条测试等于没测');
ok(sawSwap > 0, '30 轮里一顿都没换过主食 —— 这条测试等于没测');

// ---- 界面上不许出现没取整的数 ----
//
// ⚠️ 真出过:计划页营养那行印的是「蛋白 67.075g · 986.9 kcal」。
//    原因是配菜走 Nutrition.ofVariant,它返回**没四舍五入的累加器**
//    (只有 ofMeal 取整),拼文案时直接相加就带出小数。
//    这不是精度问题是**可信度问题** —— 一份用小数点后三位报蛋白的计划,
//    没人会信它算得准,只会觉得这软件不像给人用的。
var dirty = [];
RECIPES.slice(0, 120).forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    var n = Nutrition.ofMeal(v);
    ['kcal', 'protein', 'carb', 'veg'].forEach(function (k) {
      if (n[k] != null && n[k] !== Math.round(n[k])) {
        dirty.push('ofMeal(' + r.name + ').' + k + ' = ' + n[k]);
      }
    });
    var b = Nutrition.portionBoost(v, n, T);
    if (b && (b.protein !== Math.round(b.protein) || b.kcal !== Math.round(b.kcal))) {
      dirty.push('portionBoost(' + r.name + ') 没取整');
    }
    var sc = Nutrition.portionScale(v, n, T);
    if (sc && (sc.kcal !== Math.round(sc.kcal) || sc.protein !== Math.round(sc.protein))) {
      dirty.push('portionScale(' + r.name + ') 没取整');
    }
  });
});
ok(dirty.length === 0, '会显示到界面上的营养字段没取整:' + dirty.slice(0, 4).join(' · '));

// ⚠️ ofVariant **故意**不取整(它是中间量,叠加时要精度)——
//    所以调用方拼文案前必须自己 round。这条钉住这个约定:
//    哪天有人「顺手」把 ofVariant 也取整了,叠四五项的误差会悄悄变大。
var anyRaw = false;
RECIPES.slice(0, 60).forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    var n = Nutrition.ofVariant(v);
    if (n.kcal !== Math.round(n.kcal) || n.protein !== Math.round(n.protein)) anyRaw = true;
  });
});
ok(anyRaw, 'ofVariant 现在返回整数了 —— 它是中间量,取整会让叠加误差变大;' +
           '要取整该在拼文案的地方做');

// ---- 食材克数:页面上写的必须是**实际要用的** ----
//
// ⚠️ 真出过:同一张卡片上,食材标签写「猪肉末 100g」,下面一行写
//    「按你的蛋白目标加了量:猪肉末 100g → 150g」,而采购清单按 150g 买。
//    **站在灶台前你读的就是那几个标签** —— 读到的是错的,
//    做出来的量不对、吃掉的量不对、剩下的记账也跟着错。
//
// 这里不依赖 UI 代码,直接查规则:凡是 boost/scale 动过的食材,
// 「页面该显示的克数」必须等于调整后的值,不是菜谱原值。
var wrong = [];
for (var s3 = 0; s3 < 20; s3++) {
  var o3 = Solver.solve({ servings: 4, constraints: CONS, stock: {}, mustUse: [],
                          target: T, recentRecipeIds: {}, seed: s3 });
  if (!o3.ok) continue;
  o3.stage2.chosen.forEach(function (c) {
    if (!c.boost && !c.scale) return;
    var adj = {};
    if (c.boost) adj[c.boost.ingredientId] = c.boost.to;
    if (c.scale) c.scale.cuts.forEach(function (x) { adj[x.ingredientId] = x.to; });
    (c.variant.ingredients || []).forEach(function (it) {
      var to = adj[it.ids[0]];
      if (to == null) return;
      // 菜谱原值和调整值必须不同(否则这条调整本身就是空的),
      // 而页面该显示的是后者
      if (it.grams != null && it.grams === to) {
        wrong.push(c.recipe.name + ' 的 ' + it.names[0] + ' 调整前后一样(' + to + 'g)');
      }
    });
  });
}
ok(wrong.length === 0, '份量调整是空的:' + wrong.slice(0, 3).join(' · '));

console.log(fail ? '页面/求解器对账 ' + fail + ' 处不对'
                 : '  页面/求解器对账 ok(' + checked + ' 顿,缩过 ' + sawScale
                   + ' 顿,换过主食 ' + sawSwap + ' 顿,最大差 ' + worstK + ' kcal)');
process.exit(fail ? 1 : 0);
