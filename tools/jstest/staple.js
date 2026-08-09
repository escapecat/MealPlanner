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

/** @param prefs   「我愿意吃哪些主食」—— 十样一个模型,大米也在里面
 *  @param fridge  冰箱里现有的克数
 *  @param cupboard 柜子里还留着什么(老数据没迁干净、或手动加进去的) */
function run(prefs, fridge, cupboard) {
  db = { staples: (cupboard || []).map(function (id) { return { id: id }; }),
         staplesMigrated: true, staplesConfirmed: true,
         grainsSplitMigrated: true, grainPrefs: prefs || [] };
  db.pantryItems = Object.keys(fridge || {}).map(function (id, i) {
    return { id: 'p' + i, ingredientId: id, amount: fridge[id],
             addedAt: '2026-08-01T00:00:00.000Z', location: 'fridge' };
  });
  Pantry.invalidate && Pantry.invalidate();
  var kinds = {}, allSame = 0, rounds = 0, buy = {};
  for (var s = 0; s < 30; s++) {
    var o = Solver.solve({ servings: 4, constraints: CONS, stock: fridge || {}, mustUse: [],
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
    (o.shopping.buy || []).forEach(function (b) {
      buy[b.ingredientId] = (buy[b.ingredientId] || 0) + b.needGrams;
    });
    if (Object.keys(mine).length === 1) allSame++;
  }
  return { kinds: kinds, allSame: allSame, rounds: rounds, buy: buy };
}

// ⓪ 两份清单必须一模一样。
//    Pantry.ALL_GRAINS 是**你能有的**,Nutrition.STAPLE_CHOICES 是**排菜会用的**。
//    这儿多一样 → 有了不生效;那儿多一样 → 排出来的东西你哪儿都弄不进来。
//    各写各的是迟早出事的写法。
var a1 = Pantry.ALL_GRAINS.slice().sort().join(',');
var a2 = Nutrition.STAPLE_CHOICES.slice().sort().join(',');
ok(a1 === a2, '能有的主食和排菜会用的对不上 —— 你的[' + a1 + '] 排菜[' + a2 + ']');

// ⓪a 干货和鲜的不许有交集,也不许漏 —— 漏掉的那样两个页面都不管,
//     它就成了「排菜会用、但你无论如何弄不进来」的幽灵。
var both = Pantry.GRAINS_DRY.filter(function (id) {
  return Pantry.GRAINS_FRESH.indexOf(id) >= 0;
});
ok(both.length === 0, '同一样主食既算干货又算鲜的:' + both.join(' '));

// ⓪c 分类判据不是我随口分的,是 tier —— **柜子里只能放放得住的东西**。
//     红薯玉米保质 4-30 天,「你平时常备玉米吗」不是一句能回答的话。
var notDry = Pantry.GRAINS_DRY.filter(function (id) {
  var i = Catalog.ingredient(id); return !i || i.tier !== 'staple';
});
ok(notDry.length === 0, '柜子里放了放不住的东西(tier 不是 staple):' + notDry.join(' '));
var notFresh = Pantry.GRAINS_FRESH.filter(function (id) {
  var i = Catalog.ingredient(id); return !i || i.tier === 'staple';
});
ok(notFresh.length === 0, '当鲜主食的其实是干货,应该放柜子:' + notFresh.join(' '));

// ⓪b 主食不能同时算蔬菜 —— 否则同一样东西两头计,蔬菜达标率凭空虚高。
//     南瓜(26 kcal)和莲藕的 countsAsVeg 就是 true,所以主食用的是贝贝南瓜。
var vegAlso = Nutrition.STAPLE_CHOICES.filter(function (id) {
  var i = Catalog.ingredient(id);
  return i && i.countsAsVeg;
});
ok(vegAlso.length === 0, '这些主食同时算蔬菜,会两头计:' + vegAlso.join(' '));

// ① 什么都没勾 → 还是白米。**不替用户假设他有糙米。**
//    「替用户假设他有什么」是这个项目开箱即勾 11 样调料时犯过的错。
var a = run(null);
ok(Object.keys(a.kinds).length === 1 && a.kinds['大米'],
   '什么都没勾的时候配了白米以外的东西:' + JSON.stringify(a.kinds));

// ② 勾几样 → 真的轮换起来。这一条挂了就说明 solver 又没把 staple 传下去。
var b = run(['rice', 'brown_rice', 'foxtail_millet', 'quinoa']);
ok(Object.keys(b.kinds).length >= 3,
   '勾了 4 样主食,排出来只有 ' + Object.keys(b.kinds).length + ' 种:' + JSON.stringify(b.kinds));
ok(b.allSame < b.rounds * 0.2,
   b.allSame + '/' + b.rounds + ' 轮四顿还是同一种主食 —— 轮换没生效');

// ②a **大米也得上采购清单。** 这是用户直接要的:
//     「我希望大米这种也跟红薯玉米一样,勾了就出现在采购单,
//       我选采购了多少加到冰箱,然后每次再扣」
//
// ⚠️ 以前大米走的是调料柜那条路(勾 = 我家常备),而 staple 档**不进每周清单**。
//    后果:勾上那天起大米永远不会再出现在采购清单上 —— 柜子没有克数、
//    Pantry.consume 也只动冰箱,系统就一直认为你有米,直到你自己发现米缸空了。
//    实测那时候是 20 轮上清单 0 次。
ok((b.buy.rice || 0) > 0,
   '勾了大米却一次都没上采购清单 —— 那米吃完了系统永远不知道');

// ⚠️ 而且**柜子里还留着一条「大米」也不行**。
//    这条才真正咬住那条规则:solver 以前是「tier=staple 且柜子里有 → 跳过」,
//    米也是 staple 档,于是柜子里有米就永远不上清单。
//    上面那条夹具的柜子是空的,两种规则跑出来一样,**测不出退化**——
//    我第一版就是那么写的,把跳过规则改回去照样绿。
var b2 = run(['rice'], {}, ['rice', 'salt']);
ok((b2.buy.rice || 0) > 0,
   '柜子里留着一条「大米」,它就再也不上采购清单了 —— ' +
   '主食按克算,不该走调料那条「有就跳过」的路');

// ②b 冰箱里够的话就**不该**再上清单 —— 一袋 5kg 能顶几十顿,
//     天天挂在清单上就是噪音。这条和上一条是一对,少哪个都不对。
var f = run(['rice'], { rice: 5000 });
ok(!(f.buy.rice > 0),
   '冰箱里有 5kg 米还在清单上要你买 —— 「不该天天出现」得是算出来的');
ok(f.kinds['大米'] > 0, '冰箱里有米却没排米饭:' + JSON.stringify(f.kinds));

// ②c **说了愿意吃就得真排上 —— 而且不用先有。**
//
// ⚠️ 这条是补给我自己造的一个洞。我一度把判据写成「冰箱里有才算」,
//    听着很对(食材流转嘛),可它是个**死循环**:
//    红薯不被排成主食 → 不会进采购清单 → 冰箱里永远没有 → 永远不会被排。
//    而且是静默的:主食悄悄退回全白米,页面上一个字都不会提。
//    「愿意吃」是偏好,「冰箱里有」是库存,两个都得算数。
var c = run(['rice', 'sweet_potato']);
ok(c.kinds['红薯'] > 0,
   '勾了「愿意吃红薯」却一顿都没排上 —— 不排就不会买,不买就更不会排:' +
   JSON.stringify(c.kinds));

// ②d 冰箱里有就更该排上,**跟勾没勾过没关系** —— 那是这个 app 的立身之本
var e = run(['rice'], { sweet_potato: 600 });
ok(e.kinds['红薯'] > 0,
   '冰箱里躺着 600g 红薯,一顿都没排上:' + JSON.stringify(e.kinds));

// ②e 反过来:既没勾、冰箱里也没有 → 不许排。不替你假设。
var d = run(['rice']);
ok(!d.kinds['红薯'] && !d.kinds['玉米'],
   '没勾、冰箱里也没有,却排了它 —— 那是替用户假设:' + JSON.stringify(d.kinds));

// ②f 迁移:老用户在柜子里勾过的主食要**挪进偏好**,不是删掉。
//     ⚠️ 第一版我写的是直接删,理由是「不知道有几克,不能编数进库存」——
//        理由对,结论错:那个勾从来就不是「我有几克」,是「我愿意吃它」。
//        删掉就是把用户说过的话扔了,而且正好掉进上面那个死循环。
//     ⚠️ 但**确实不给它编一份库存**:挪完冰箱是空的,下一轮它自己会
//        出现在采购清单上,你填实际克数 —— 账目自己就理顺了。
db = { staples: [{ id: 'rice' }, { id: 'sweet_potato' }, { id: 'salt' }],
       staplesMigrated: true, staplesConfirmed: true, pantryItems: [] };
Pantry.invalidate && Pantry.invalidate();
Pantry.ensureInit();
ok(!Pantry.hasStaple('sweet_potato') && !Pantry.hasStaple('rice'),
   '主食没从柜子里迁走 —— 调料柜里还会冒出「大米」「红薯」,而且永远不上清单');
ok(Pantry.wantsGrain('sweet_potato') && Pantry.wantsGrain('rice'),
   '迁移把「我愿意吃这个」这句话弄丢了');
ok(Pantry.hasStaple('salt'), '迁移把调料也删了');
ok(Pantry.totalOf('rice') === 0, '迁移给大米编了一份库存出来 —— 那个数是假的');
ok(Pantry.availableGrains().indexOf('sweet_potato') >= 0 &&
   Pantry.availableGrains().indexOf('rice') >= 0, '迁移完主食排不上了');

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
