// 份量缩放 —— 顺序错了不会报错,只会让热量永远降不下来。
var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');
global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));
global.PACKAGES = require(path.join(APP, 'data/packages.js'));
var db = {};
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
var T = { kcal: 832, protein: 59, veg: 200 };
function byName(n) { return RECIPES.filter(function (r) { return r.name === n; })[0]; }

// ① 主食**无条件**归一化,不是等超标了才缩。
//    第一版只在超标时缩,紫菜包饭从 1117 缩到 1044 就停手 —— 刚压进宽容带,
//    可米饭还是 250g。宽容带是「多吃点没关系」,不是「250g 大米是对的」。
var kb = byName('韩式紫菜包饭(김밥)');
var kv = kb.variants[0];
var sc = Nutrition.portionScale(kv, Nutrition.ofMeal(kv), T);
ok(sc && sc.cuts.some(function (c) { return c.to <= 100; }),
   '紫菜包饭的 250g 米饭没被归一化(' + (sc ? JSON.stringify(sc.cuts) : 'null') + ')');

// ② **不能有「蛋白不许跌破目标」的护栏。**
//    这一步跑在加量之前,那时紫菜包饭蛋白才 40g、目标 59g ——
//    护栏一算「已经欠 19g」就全额否决,连 865 kcal 的米饭都不让动,
//    于是一道都缩不下来,整个功能等于没有。
ok(sc && sc.protein > 0, '缩份量居然没减少任何蛋白 —— 多半是护栏又被加回来了');

// ③ 蔬菜和香料不许缩 —— 缩它们省不下热量,只是让你少吃菜。
//
// ⚠️ **只看 removed > 0 的。** cuts 现在是双向的:第三刀会把整道菜
//    按目标放大,放大项也走 cuts,removed 取负。不分方向的话,
//    「青菜 200→280g」会被判成「缩了蔬菜」—— 正好反了。
RECIPES.slice(0, 200).forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    var s = Nutrition.portionScale(v, Nutrition.ofMeal(v), T);
    if (!s) return;
    s.cuts.forEach(function (c) {
      if (c.removed <= 0) return;                    // 负数 = 加量,不在这条管辖内
      var i = Catalog.ingredient(c.ingredientId);
      ok(!(i && i.countsAsVeg), r.name + ' 缩了蔬菜「' + c.name + '」');
    });
  });
});

// ④ **顺序:缩在加量之前。** portionBoost 有一条「热量没空间就不加」,
//    所以先加量的话,一顿 1117 kcal 的紫菜包饭永远加不动量(蛋白 40g 也加不了),
//    只能靠补充项挂一样额外的东西,热量还是超着。
//    检验方式:排出来的计划里,**同一顿既缩了主食又加了主料**必须出现过。
var CONS = { equipment: ['炒锅', '空气炸锅', '电饭煲'], maxSpicy: 1, maxActiveMinutes: 45,
             maxDifficulty: 3, maxIdleWait: 60, allowOvernight: false, blacklist: [] };
var both = 0, scaled = 0, overBand = 0, meals = 0;
for (var s = 0; s < 20; s++) {
  var o = Solver.solve({ servings: 4, constraints: CONS, stock: {}, mustUse: [],
                         target: T, recentRecipeIds: {}, seed: s });
  if (!o.ok) continue;
  o.stage2.chosen.forEach(function (c) {
    meals++;
    if (c.scale) scaled++;
    if (c.scale && c.boost) both++;
    if (c.nutrition && c.nutrition.kcal > T.kcal * 1.25) overBand++;
  });
}
ok(scaled > 0, '20 轮里一顿都没缩过份量 —— solver 没接上 portionScale');
ok(both > 0, '没有任何一顿是「先缩主食再加主料」—— 顺序多半被改反了');

// ⑤ 缩完之后超宽容带的顿数得压得住。加缩放前是 22%,这里留出余量卡 30%。
//    (不卡死在 18% —— 那样每次调权重都得改测试,变成橡皮图章。)
ok(overBand / meals < 0.30,
   '超宽容带的顿数 ' + Math.round(overBand / meals * 100) + '%,超过 30%');

console.log(fail ? '份量缩放 ' + fail + ' 处不对'
                 : '  份量缩放 ok(' + meals + ' 顿里缩了 ' + scaled
                   + ' 顿,其中 ' + both + ' 顿又加了主料,超带 '
                   + Math.round(overBand / meals * 100) + '%)');
process.exit(fail ? 1 : 0);
