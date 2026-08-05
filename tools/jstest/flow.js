// 「换掉这道菜」的核心保证:换掉的菜不能再排出来。
//
// UI 那层要 DOM,测不了;但这条保证落在求解器的 recentRecipeIds 上,
// 是纯函数,能测。UI 只负责把「本轮换掉的 + 永久排除的」并进去。
//
// 值得测是因为失败是**静默**的:排除没生效的话,你点了「换掉」,
// 它重新生成一遍、又给你排了同一道菜,而且没有任何报错。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
};
global.INGREDIENTS = require(path.join(A, 'data', 'ingredients.js'));
global.RECIPES = require(path.join(A, 'data', 'recipes.js'));
global.PACKAGES = require(path.join(A, 'data', 'packages.js'));
global.Equipment = require(path.join(A, 'core', 'equipment.js'));
global.Catalog = require(path.join(A, 'core', 'catalog.js'));
global.Pantry = require(path.join(A, 'core', 'pantry.js'));
global.Packaging = require(path.join(A, 'core', 'packaging.js'));
global.SpecPriority = (function () {
  try { return require(path.join(A, 'core', 'specpriority.js')); } catch (e) { return null; }
})();
global.Nutrition = require(path.join(A, 'core', 'nutrition.js'));
var Solver = require(path.join(A, 'core', 'solver.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}

var BASE = {
  servings: 4,
  constraints: { equipment: ['炒锅', '汤锅', '不粘锅'], maxActiveMinutes: 45, maxDifficulty: 4,
                 blacklist: [] },
  stock: {}, mustUse: [], stockDetail: [], recentRecipeIds: {},
};

// --- 1. 能排出来 ---
var r1 = Solver.solve(BASE);
ok(r1.ok, '基线能排出四顿');
var names = r1.stage2.chosen.map(function (c) { return c.recipe.name; });
console.log('       排出来:' + names.join(' · '));

// --- 2. 把排出来的第一道排除掉,它不能再出现 ---
var victim = r1.stage2.chosen[0].recipe;
var r2 = Solver.solve(Object.assign({}, BASE, {
  recentRecipeIds: (function () { var m = {}; m[victim.id] = 1; return m; })(),
}));
ok(r2.ok, '换掉一道之后还能排出来');
var again = r2.stage2.chosen.some(function (c) { return c.recipe.id === victim.id; });
ok(!again, '被换掉的「' + victim.name + '」没有再排出来');

// --- 3. 拉黑一样食材,所有非它不可的菜都不该出现 ---
//     竹笋是用户举的例子,库里正好有。
var BAN = 'bamboo_shoot';
var banned = RECIPES.filter(function (rec) {
  return rec.type !== 'prep' && (rec.variants || []).some(function (v) {
    return (v.ingredients || []).some(function (it) {
      return it.ids.length === 1 && it.ids[0] === BAN;
    });
  });
});
console.log('       库里非「竹笋」不可的菜:' + banned.length + ' 道');
var r3 = Solver.solve(Object.assign({}, BASE, {
  constraints: Object.assign({}, BASE.constraints, { blacklist: [BAN] }),
}));
ok(r3.ok, '拉黑竹笋之后还能排出来');
var leaked = r3.stage2.chosen.filter(function (c) {
  return (c.variant.ingredients || []).some(function (it) {
    return it.ids.length === 1 && it.ids[0] === BAN;
  });
});
ok(leaked.length === 0, '拉黑之后没有一道菜非竹笋不可' +
   (leaked.length ? '(漏了:' + leaked.map(function (c) { return c.recipe.name; }).join() + ')' : ''));

// --- 4. 「或」组不该被误伤 ---
//     只有全部选项都被拉黑才算做不了 —— 这条在 Catalog 里,顺手确认没被改坏。
var orGroup = { ingredients: [{ ids: ['bamboo_shoot', 'shiitake'], names: ['竹笋', '香菇'] }] };
ok(Catalog.variantHasBlacklisted(orGroup, [BAN]) === false,
   '「竹笋或香菇」拉黑竹笋后仍然能做');
ok(Catalog.variantHasBlacklisted(orGroup, [BAN, 'shiitake']) === true,
   '两样都拉黑才算做不了');

// --- 5. 做了一顿要能从库存扣掉 ---
mem = {};
Pantry.addFromPackage({ id: 'chicken_breast', ingredientId: 'chicken_breast',
                        netWeight: 400, unit: 'g' }, new Date(0).toISOString());
var res = Pantry.consume('chicken_breast', 150, new Date(0).toISOString());
ok(Math.round(Pantry.totalOf('chicken_breast')) === 250, '做掉一顿后库存从 400g 扣到 250g');
ok(res.shortfall === 0, '够用时 shortfall 为 0');
var res2 = Pantry.consume('chicken_breast', 999, new Date(0).toISOString());
ok(res2.shortfall > 0, '不够用时如实报缺口,不静默补零');

// --- 6. 排期:最容易坏的排前面 ---
//     这条没测的话失败也是静默的:顺序看起来「有」,只是排错了,
//     而后果要到第四天打开冰箱才发现。
global.Schedule = require(path.join(A, 'core', 'schedule.js'));

var meals = r1.stage2.chosen.map(function (c) {
  return { recipeId: c.recipe.id, prepLevel: c.variant.prepLevel, name: c.recipe.name };
});
var plan = Schedule.assign(meals, 2, 2);
ok(plan.length === meals.length, '排期不丢菜');
var seq = plan.map(function (p) { return p.shelfLifeDays == null ? 9999 : p.shelfLifeDays; });
var sorted = seq.every(function (v, i) { return i === 0 || seq[i - 1] <= v; });
ok(sorted, '保质期短的排在前面(' +
   plan.map(function (p) {
     return p.meal.name + '=' + (p.shelfLifeDays == null ? '不怕放' : p.shelfLifeDays + '天');
   }).join(' · ') + ')');
ok(plan[0].day === 1 && plan[plan.length - 1].day === 2, '2 天 × 2 顿铺满两天');

// 不改传进来的数组 —— 排期是派生数据,存下来就会变成对不上的旧账
var before = meals.map(function (m) { return m.recipeId; }).join();
Schedule.assign(meals, 2, 2);
ok(meals.map(function (m) { return m.recipeId; }).join() === before,
   'assign 不改传进来的 meals');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);