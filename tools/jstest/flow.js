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
// ⚠️ Timing / Meal / Schedule **必须在这里就加载全**,不能等用到再 require。
//
//    以前它们散在文件中段(Meal 在 163 行),而前七条测试在那之前就跑完了 ——
//    于是那七条测的是一个**线上不存在的求解器**:solver 里
//    `if (typeof Meal !== 'undefined')` 整块被静默跳过,没有配菜、没有主料加量、
//    没有蛋白补充项、连主菜门槛都不生效。
//    发现它是因为「传 target 后最差一顿蛋白更高」挂了,查下去才知道
//    两边都没跑加量 —— 测试green 过的那段时间里,它根本没在测该测的东西。
//
//    浏览器里 index.html 是一次性全部加载的,测试也必须照着来。
global.Timing = require(path.join(A, 'core', 'timing.js'));
global.Meal = require(path.join(A, 'core', 'meal.js'));
global.Schedule = require(path.join(A, 'core', 'schedule.js'));
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

// --- 7. 营养目标必须真的影响排菜 ---
//
// ⚠️ 这条是补给一个已经发生过的事故:solver 里那条 `- short * 120` 写好了、
//    注释也写了,但 rounds.js 从来没传 target,于是整项恒等于 0 —— **写了没接上**。
//    线上表现:排出「晚饭 = 400g 青菜 + 一碗饭,442 kcal / 蛋白 18g」。
//    这种「功能存在但没通电」的故障不会报错,只能靠对比测出来。

var FULL = { equipment: ['炒锅', '汤锅', '不粘锅', '烤箱', '蒸锅', '空气炸锅'],
             maxActiveMinutes: 45, maxDifficulty: 4, blacklist: [] };
// ⚠️ 目标得**真的有要求**,不然这条测不出东西来。
//    原来用的是 protein 38 —— 后来 Meal.canBeMain 加了「不传 target 时按 22g 兜底」,
//    而 38×0.6 = 23g,和兜底几乎一样。于是两边排出**一模一样的计划**,
//    断言 w2 > w1 挂了,看起来像求解器坏了,其实是这条测试自己失去了分辨力。
//    换成 65g(减脂男性的真实量级):门槛 39g,和兜底拉开差距,才测得出接线在不在。
var TGT = { kcal: 900, protein: 65, veg: 250 };
// ⚠️ 量的是 **c.nutrition(你实际吃到的)**,不是 ofMeal(菜谱原始值)。
//    这两个数在加了「主料加量 + 蛋白补充项」之后就分家了:
//    土豆 gnocchi 生蛋白 20g,求解器照样选它,然后加量+补一份把这顿补到 58g。
//    按原始值量的话,传不传 target 都是 20g,断言挂掉 —— 看着像求解器坏了,
//    其实是**量错了地方**:没人吃「菜谱原始值」,吃的是最后端上桌的那份。
function worstProtein(res) {
  return res.stage2.chosen.reduce(function (m, c) {
    return Math.min(m, (c.nutrition || Nutrition.ofMeal(c.variant)).protein);
  }, 999);
}
var noT = Solver.solve(Object.assign({}, BASE, { constraints: FULL }));
var wiT = Solver.solve(Object.assign({}, BASE, { constraints: FULL, target: TGT }));
ok(noT.ok && wiT.ok, '两种都能排出来');
ok((noT.stage2.nutritionShortfall || 0) === 0, '不传 target 时营养项确实是 0(说明它靠 target 通电)');
ok((wiT.stage2.nutritionShortfall || 0) > 0, '传了 target 营养项就活了 —— **接线没断**');
var w1 = worstProtein(noT), w2 = worstProtein(wiT);
ok(w2 > w1, '传 target 后最差一顿的蛋白更高(' + w1 + 'g → ' + w2 + 'g)');

// --- 8. 一顿必须是完整的一顿 ---
//
// ⚠️ 原来的模型是「一道菜 = 一顿饭」,可库里 17% 的菜蛋白低于 20g ——
//    宁式烤菜(上海青 400g,蛋白 18g)能名正言顺地当一顿晚饭。
//    加打分权重只是让它不容易被选中,没从根上排除。
var full = Solver.solve(Object.assign({}, BASE, { constraints: FULL, target: TGT }));
ok(full.ok, '加了主菜门槛还能排出来');

var minP = full.stage2.chosen.reduce(function (m, c) {
  return Math.min(m, c.nutrition.protein);
}, 999);
ok(minP >= Meal.proteinFloor(TGT) * 0.9,
   '最差一顿蛋白 ' + minP + 'g,不低于门槛 ' + Meal.proteinFloor(TGT) + 'g');

var minV = full.stage2.chosen.reduce(function (m, c) {
  return Math.min(m, c.nutrition.veg);
}, 999);
ok(minV >= Meal.vegFloor(TGT), '最差一顿蔬菜 ' + minV + 'g,不低于门槛 ' + Meal.vegFloor(TGT) + 'g');

// 配菜必须简单 —— 你要的是「再弄个青菜」,不是再做一道正经菜
var sides = full.stage2.chosen.filter(function (c) { return c.side; });
ok(sides.every(function (c) { return c.side.activeMinutes <= 12; }),
   sides.length + ' 道配菜动手都 ≤12 分(' +
   sides.map(function (c) { return c.side.name + ' ' + c.side.activeMinutes + '分'; }).join(' · ') + ')');

// 配菜的食材必须进采购清单 —— 页面写着配西兰花、清单里却没有,到超市才发现买不齐
var listed = {};
full.shopping.buy.forEach(function (b) { listed[b.ing.id] = 1; });
(full.stage2.chosen[0].side ? [full.stage2.chosen[0]] : []).forEach(function (c) {
  var v = c.side._cand.variant;
  var mains = (v.ingredients || []).filter(function (x) { return x.role === 'main'; });
  ok(mains.every(function (x) { return x.ids.some(function (i2) { return listed[i2]; }); }),
     '配菜「' + c.side.name + '」的主料在采购清单里');
});

// ⚠️ 超标也得罚。第一版 shortfall 只算「不够」,红烧肉那顿 1581 kcal(目标 700)
//    在分数上和刚好达标一样 —— 减脂目标的人排出两倍热量,系统一声不吭。
var fat = { kcal: 1600, protein: 40, veg: 200 };
var justRight = { kcal: 700, protein: 40, veg: 200 };
ok(Nutrition.shortfall(fat, TGT) > Nutrition.shortfall(justRight, TGT),
   '1600 kcal 的一顿比 700 kcal 的扣分多(超标不再免费)');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);