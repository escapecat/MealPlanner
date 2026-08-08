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

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
