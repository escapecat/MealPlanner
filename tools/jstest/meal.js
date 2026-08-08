// 配菜位的规矩 —— 这几条坏了不会报错,只会让计划变得不像人吃的。
var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');
global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));
global.Nutrition = require(path.join(APP, 'core/nutrition.js'));
global.Catalog = require(path.join(APP, 'core/catalog.js'));
var Meal = require(path.join(APP, 'core/meal.js'));

var fail = 0;
function ok(cond, msg) { if (!cond) { console.log('  FAIL ' + msg); fail++; } }
var T = { kcal: 832, protein: 59, veg: 200 };

// ① 配菜位不能出现荤菜。
//    空炸黑椒牛肉粒 150g 牛瘦肉 = 32g 蛋白,压在门槛(35g)下面又有 150g 菜,
//    于是被当成「配的那份青菜」挂到咸鱼蒸肉饼后面 —— 一顿两道肉。
//    判据必须是「有没有荤主料」,不是蛋白数字。
var meaty = [];
RECIPES.forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    if (!Meal.isSimpleSide(v, Nutrition.ofVariant(v), T, null)) return;
    (v.ingredients || []).forEach(function (it) {
      if (it.role !== 'main' && it.role !== 'side') return;
      var i = Catalog.ingredient(it.ids[0]);
      if (i && ['畜肉', '禽肉', '水产', '加工肉', '内脏', '蛋'].indexOf(i.category) >= 0) {
        meaty.push(r.name + ' ← ' + i.name);
      }
    });
  });
});
ok(meaty.length === 0, '配菜位混进荤菜:' + meaty.slice(0, 5).join(' · '));

// ② 但也不能把配菜全滤没了 —— 一刀切「不许有肉」很容易顺手把整个池子清空,
//    表现出来是「蔬菜只有 30g 的那顿死活配不上青菜」,而不是报错。
var n = 0;
RECIPES.forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    if (Meal.isSimpleSide(v, Nutrition.ofVariant(v), T, null)) n++;
  });
});
ok(n >= 20, '能当配菜的只剩 ' + n + ' 个变体,池子被滤空了');

// ③ 动手预算必须作数 —— 主菜 45 分 + 配菜 10 分会突破用户设的上限。
var any = null;
RECIPES.forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    if (!any && Meal.isSimpleSide(v, Nutrition.ofVariant(v), T, null) && v.activeMinutes > 3) any = v;
  });
});
ok(any && !Meal.isSimpleSide(any, Nutrition.ofVariant(any), T, 0),
   '剩余动手时间为 0 时还能挂上配菜');

console.log(fail ? '配菜位 ' + fail + ' 处不对' : '  配菜位 ok(' + n + ' 个变体可用)');
process.exit(fail ? 1 : 0);
