// 菜谱校准层。
//
// ⚠️ 这里最该防的不是「改不生效」,而是**只生效一半** ——
//    菜谱页显示你改的 40 分钟,求解器却还按库里的 25 分钟排。
//    那种不一致不报错,而且要等到排出一顿你根本做不完的菜才发现。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
};
global.INGREDIENTS = require(path.join(A, 'data', 'ingredients.js'));
global.RECIPES = require(path.join(A, 'data', 'recipes.js'));
global.Equipment = require(path.join(A, 'core', 'equipment.js'));
global.Timing = require(path.join(A, 'core', 'timing.js'));
var RecipeBook = require(path.join(A, 'core', 'recipebook.js'));
var Catalog = require(path.join(A, 'core', 'catalog.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}
function get(id) { return RECIPES.filter(function (r) { return r.id === id; })[0]; }

RecipeBook.init();
var target = RECIPES.filter(function (r) {
  return r.type !== 'prep' && r.variants[0].activeMinutes > 5;
})[0];
var origActive = target.variants[0].activeMinutes;
var origSpicy = target.spicy;

// --- 改动手时间 ---
RecipeBook.save(target.id, { activeMinutes: origActive + 20 }, target.variants[0].prepLevel);
ok(get(target.id).variants[0].activeMinutes === origActive + 20,
   target.name + '：动手 ' + origActive + ' → ' + (origActive + 20) + ' 分，全局 RECIPES 里读得到');
ok(RecipeBook.original(target.id).variants[0].activeMinutes === origActive,
   '库里的原值没被改掉（' + origActive + ' 分），随时能对照');

// --- 改了之后筛选也得跟着变，不能只有显示变 ---
var cfg = { equipment: ['炒锅', '汤锅', '不粘锅', '烤箱', '蒸锅', '空气炸锅'],
            maxActiveMinutes: origActive + 10, maxDifficulty: 5, blacklist: [] };
ok(Catalog.availableVariants(get(target.id), cfg).length === 0,
   '动手上限 ' + cfg.maxActiveMinutes + ' 分时这道被筛掉了 —— **筛选走的是校准后的值**');

// --- 辣度 ---
RecipeBook.save(target.id, { spicy: 3 });
ok(get(target.id).spicy === 3, '辣度改成重辣');
ok(Catalog.availableVariants(get(target.id), { equipment: cfg.equipment, maxSpicy: 1 }).length === 0,
   '「只吃微辣」时这道被筛掉 —— 辣度校准也进筛选');

// --- 克数：grams 和 qty 要一起改，只改一个会让显示和采购对不上 ---
var ing = target.variants[0].ingredients[0];
var g0 = ing.grams;
var gm = {}; gm[ing.ids[0]] = g0 + 50;
RecipeBook.save(target.id, { grams: gm }, target.variants[0].prepLevel);
var after = get(target.id).variants[0].ingredients[0];
ok(after.grams === g0 + 50, '克数 ' + g0 + ' → ' + (g0 + 50));
ok(after.qty === after.grams, 'qty 和 grams 一起改了（只改一个的话显示和采购会对不上）');

// --- 总时长不能小于动手时间 ---
RecipeBook.save(target.id, { activeMinutes: 60, totalMinutes: 10 }, target.variants[0].prepLevel);
var v2 = get(target.id).variants[0];
ok(v2.totalMinutes >= v2.activeMinutes,
   '总时长被顶到不小于动手时间（' + v2.totalMinutes + ' ≥ ' + v2.activeMinutes +
   '）—— 否则 Timing 会算出负的空等');

// --- 还原 ---
RecipeBook.reset(target.id);
ok(get(target.id).variants[0].activeMinutes === origActive &&
   get(target.id).spicy === origSpicy &&
   get(target.id).variants[0].ingredients[0].grams === g0,
   '还原之后完全回到库里的原值');
ok(RecipeBook.count() === 0, '校准记录清空了');

// --- 存的是 diff 不是整份拷贝 ---
RecipeBook.save(target.id, { difficulty: 1 });
var raw = JSON.stringify(mem.recipeOverrides);
ok(raw.length < 300, '存下来的是 diff（' + raw.length + ' 字节），不是整道菜的拷贝');
ok(raw.indexOf(target.name) < 0, 'diff 里不含菜名等原始数据 —— 菜谱库以后更新了，校准照样贴得上');

// --- 食材增删 ---
//
// ⚠️ 只给「改克数」是不够的。真实的调整多半是「这道我不放香菜」
//    「我做红烧肉会加土豆」—— 那是增删,不是改数。
RecipeBook.reset();
var t2 = RECIPES.filter(function (r) {
  return r.type !== 'prep' && r.variants[0].ingredients.length >= 3;
})[0];
var lvl = t2.variants[0].prepLevel;
var n0 = t2.variants[0].ingredients.length;
var dropId = t2.variants[0].ingredients[n0 - 1].ids[0];

RecipeBook.save(t2.id, { remove: [dropId] }, lvl);
var after1 = get(t2.id).variants[0].ingredients;
ok(after1.length === n0 - 1, t2.name + '：去掉一样食材（' + n0 + ' → ' + after1.length + '）');
ok(!after1.some(function (i) { return i.ids[0] === dropId; }), '去掉的那样真的不在了');

RecipeBook.save(t2.id, { add: [{ id: 'potato', grams: 120, role: 'side' }] }, lvl);
var after2 = get(t2.id).variants[0].ingredients;
var added = after2.filter(function (i) { return i.ids[0] === 'potato'; })[0];
ok(!!added, '加进一样食材（土豆）');
ok(!!added && added.grams === 120 && added.qty === 120,
   '加的那样 grams 和 qty 都填好了（采购清单按 grams 走,缺了就买不到）');
ok(!!added && added.userAdded === true, '标了 userAdded —— 界面上要能看出是你加的');

RecipeBook.save(t2.id, { add: [{ id: 'potato', grams: 200, role: 'side' }] }, lvl);
var pots = get(t2.id).variants[0].ingredients.filter(function (i) { return i.ids[0] === 'potato'; });
ok(pots.length === 1, '同一样不会被加两次');

// 提前准备可改 —— 用一道**真的**要隔夜的菜来测。
// ⚠️ 这里原本写死用蛋炒饭,后来发现它根本不该标隔夜(食材列已经是「隔夜饭[rice]」,
//    提前准备列又写一遍),改了数据源之后这条断言就挂了 —— 挂得对。
//    测试不该把某道菜的具体数据焊死在断言里,该从库里现找一个符合条件的。
var fan = RECIPES.filter(function (r) {
  return r.type !== 'prep' && (r.variants || []).some(function (v) {
    return Timing.ofMeal(v, null).overnight;
  });
})[0];
ok(!!fan, '库里有真要隔夜的菜(' + (fan ? fan.name : '?') + ')');
if (fan) {
  var lv = (fan.variants || []).filter(function (v) {
    return Timing.ofMeal(v, null).overnight;
  })[0];
  RecipeBook.save(fan.id, { aheadOfTime: null }, lv.prepLevel);
  var after = get(fan.id).variants.filter(function (v) { return v.prepLevel === lv.prepLevel; })[0];
  ok(Timing.ofMeal(after, null).overnight === false,
     '清掉「隔夜」之后,「不接受隔夜准备」那条约束就不再挡它了');
}

RecipeBook.reset();

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
