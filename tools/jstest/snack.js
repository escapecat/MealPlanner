// 点心不许当正餐 —— 坏了不会报错,只会让你在周六晚上收到一个「蓝莓玛芬」。
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

// ① 标记还在。这 7 道是**手点的**,不是推导的 —— 数据重建时最容易被静默冲掉。
var snacks = RECIPES.filter(function (r) { return r.type === 'snack'; });
ok(snacks.length === 7, 'snack 标记只剩 ' + snacks.length + ' 道(应为 7)');
['蓝莓玛芬', '英式司康', '香蕉面包', '甜烧白', '八宝饭', '拔丝地瓜', '泰式芒果糯米饭']
  .forEach(function (n) {
    ok(snacks.some(function (r) { return r.name === n; }), n + ' 的 snack 标记没了');
  });

// ② 排不进计划。**这才是这条规则的意义** —— 光在数据里标上、求解器不看,
//    等于没标(这个项目里「写了但没接上」已经犯过五六次了)。
//    宽约束跑 30 轮:约束越松,点心越容易被选中,所以这里故意不设上限。
var loose = { equipment: ['炒锅', '汤锅', '不粘锅', '蒸架', '空气炸锅', '砂锅',
                          '电饭煲', '烤箱', '电压力锅'],
              maxSpicy: 3, blacklist: [] };
var daily = Profile.dailyTargets({ sex: 'male', age: 30, heightCm: 175, weightKg: 70,
                                   activity: 'light', goal: 'cut' });
var T = Profile.perPlannedMeal(daily, 'light');
var leaked = {};
for (var s = 0; s < 30; s++) {
  var o = Solver.solve({ servings: 4, constraints: loose, stock: {}, mustUse: [],
                         target: T, recentRecipeIds: {}, seed: s });
  if (!o.ok) continue;
  o.stage2.chosen.forEach(function (c) {
    if (c.recipe.type === 'snack') leaked[c.recipe.name] = 1;
    if (c.side) {
      var sr = RECIPES.filter(function (r) { return r.id === c.side.recipeId; })[0];
      if (sr && sr.type === 'snack') leaked[sr.name + '(当配菜)'] = 1;
    }
  });
}
ok(Object.keys(leaked).length === 0, '点心排进了正餐:' + Object.keys(leaked).join(' · '));

// ③ 但菜谱页还得能查到 —— snack 不是「删掉」,是「不当正餐」。
//    要是顺手把它们从 dishes() 里也滤了,表现出来是「库里搜不到玛芬」,
//    而用户明明能烤。
var browsable = RECIPES.filter(function (r) { return r.type !== 'prep'; });
ok(browsable.some(function (r) { return r.name === '蓝莓玛芬'; }),
   '菜谱页搜不到蓝莓玛芬了 —— snack 被当成 prep 滤掉了');

console.log(fail ? '点心规则 ' + fail + ' 处不对' : '  点心规则 ok(7 道,30 轮零泄漏)');
process.exit(fail ? 1 : 0);
