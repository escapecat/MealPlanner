// 主食轮换 —— 「写了没接上」的第 N 次:ofMeal(v, stapleId) 一直支持传主食,
// 从来没人传过,于是 80% 的顿自动配白米饭、34/100 轮四顿全白米。
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
var daily = Profile.dailyTargets({ sex: 'male', age: 30, heightCm: 175, weightKg: 70,
                                   activity: 'light', goal: 'cut' });
var T = Profile.perPlannedMeal(daily, 'light');
var CONS = { equipment: ['炒锅', '空气炸锅', '电饭煲'], maxSpicy: 1, maxActiveMinutes: 45,
             maxDifficulty: 3, maxIdleWait: 60, allowOvernight: false, blacklist: [] };

function run(staples) {
  db = staples ? { staples: staples.map(function (id) { return { id: id }; }),
                   staplesMigrated: true, staplesConfirmed: true } : {};
  Pantry.invalidate && Pantry.invalidate();
  var kinds = {}, allSame = 0, rounds = 0;
  for (var s = 0; s < 30; s++) {
    var o = Solver.solve({ servings: 4, constraints: CONS, stock: {}, mustUse: [],
                           target: T, recentRecipeIds: {}, seed: s });
    if (!o.ok) continue;
    rounds++;
    var mine = {};
    o.stage2.chosen.forEach(function (c) {
      var st = c.nutrition && c.nutrition.staple;
      if (!st) return;
      kinds[st.name] = (kinds[st.name] || 0) + 1;
      mine[st.ingredientId] = 1;
    });
    if (Object.keys(mine).length === 1) allSame++;
  }
  return { kinds: kinds, allSame: allSame, rounds: rounds };
}

// ① 什么都没勾 → 还是白米。**不替用户假设他有糙米。**
//    「替用户假设他有什么」是这个项目开箱即勾 11 样调料时犯过的错。
var a = run(null);
ok(Object.keys(a.kinds).length === 1 && a.kinds['大米'],
   '储物柜空的时候配了白米以外的东西:' + JSON.stringify(a.kinds));

// ② 勾了几样 → 真的轮换起来。这一条挂了就说明 solver 又没把 staple 传下去。
var b = run(['rice', 'brown_rice', 'foxtail_millet', 'sweet_potato']);
ok(Object.keys(b.kinds).length >= 3,
   '勾了 4 样主食,排出来只有 ' + Object.keys(b.kinds).length + ' 种:' + JSON.stringify(b.kinds));
ok(b.allSame < b.rounds * 0.2,
   b.allSame + '/' + b.rounds + ' 轮四顿还是同一种主食 —— 轮换没生效');

// ③ 换主食要**按热量折算**,不能照抄 90g。
//    红薯 86 kcal/100g,照抄 90g 只有 77 kcal —— 等于这顿没有主食。
var g = Nutrition.stapleGramsFor('sweet_potato', T);
ok(g > 250, '红薯只配了 ' + g + 'g(' + Math.round(g * 0.86) + ' kcal)—— 没按热量折算');
var gr = Nutrition.stapleGramsFor('rice', T);
ok(gr >= 80 && gr <= 100, '白米算出来 ' + gr + 'g,和原来的 90g 对不上');

// ④ 菜谱自带主食的不许动 —— 把手抓饭的米换成红薯就不是手抓饭了。
var pilaf = RECIPES.filter(function (r) { return r.name === '新疆手抓饭'; })[0];
if (pilaf) {
  var n = Nutrition.ofMeal(pilaf.variants[0]);
  ok(!n.staple, '手抓饭自带主食,却被判成「要另外配一份」');
}

console.log(fail ? '主食轮换 ' + fail + ' 处不对'
                 : '  主食轮换 ok(空储物柜=白米;勾 4 样→' + Object.keys(b.kinds).length + ' 种轮换)');
process.exit(fail ? 1 : 0);
