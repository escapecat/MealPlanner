// 统计 —— **诊断式,不做称号**(FEATURES 第 28 条)。
//
// 这个文件盯三件事,每一件都是这类功能最容易烂掉的地方:
//
//  1. **样本不够时一个数都不给。**
//     第 27 条说「冷启动别给空页面,给进度」—— 但那不等于「可以给假结论」。
//     一两轮数据照样能算出「叶菜浪费 100%」这种漂亮数字,而你会照着它改设置。
//     **半成品的结论比没有更糟。**
//
//  2. **每个指标背后要能接一个动作**(第 26 条)。
//     「累计做了 47 道菜」接不上动作,是虚荣指标,看两次就腻。
//
//  3. **不许照着「不够吃」去调高总热量**(第 19 条)。
//     减脂目标下「不够吃」是常态,跟着它涨的话目标会一路漂,减脂就白做了。
//     份量反馈只能改**构成**。

var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');
global.INGREDIENTS = require(path.join(APP, 'data/ingredients.js'));
global.RECIPES = require(path.join(APP, 'data/recipes.js'));

var db = {};
global.Store = {
  get: function (k, f) { return db[k] !== undefined ? db[k] : (f === undefined ? null : f); },
  set: function (k, v) { db[k] = v; },
};
var Stats = require(path.join(APP, 'core/stats.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function byId(id) { return Stats.all().filter(function (o) { return o.id === id; })[0]; }

// ---- 1. 空数据:全部 not ready,而且**一个数都不给** ----
db = { rounds: [], wasteLog: [] };
var cold = Stats.all();
ok(cold.length > 0, '统计一条都没有');
ok(cold.every(function (o) { return !o.ready; }), '空数据时居然有「准备好」的洞察');
ok(cold.every(function (o) { return !o.detail; }),
   '空数据时给了数字 —— 半成品的结论比没有更糟,你会照着它改设置');
ok(cold.every(function (o) { return o.need > 0 && o.have === 0; }),
   '没给出「还差多少」的进度(第 27 条:冷启动给进度,不给空页面)');

// ---- 2. 一轮数据还是不够 ----
function mkRound(id, meals, ratings, status) {
  return {
    id: id, status: status || 'done',
    input: { days: 2, perDay: 2, meals: meals.length },
    solved: { meals: meals },
    log: { ratings: ratings || {}, cookedCount: meals.filter(function (m) { return m.cooked; }).length },
  };
}
var m4 = [
  { recipeId: 'A', name: '甲', cooked: true },
  { recipeId: 'B', name: '乙', cooked: true },
  { recipeId: 'C', name: '丙', cooked: false },
  { recipeId: 'D', name: '丁', cooked: false },
];
db = { rounds: [mkRound('r1', m4)], wasteLog: [] };
ok(!byId('completion').ready, '只有一轮就敢下「执行率」的结论了');

// ---- 3. 够了才说话,而且说的是**能接动作的那种** ----
db = { rounds: [mkRound('r1', m4), mkRound('r2', m4)], wasteLog: [] };
var c = byId('completion');
ok(c.ready, '两轮了还不给执行率');
ok(/8 顿里做了 4 顿/.test(c.detail || ''), '执行率数字不对:' + c.detail);
ok(!!c.action, '执行率 50% 却没给动作 —— 不接动作的指标是虚荣指标');

// 执行率高的时候**不该唠叨**。80% 以上是正常波动。
var allCooked = m4.map(function (m) { return { recipeId: m.recipeId, name: m.name, cooked: true }; });
db = { rounds: [mkRound('r1', allCooked), mkRound('r2', allCooked)], wasteLog: [] };
ok(!byId('completion').action, '全做完了还在给建议 —— 没事找事说的话,有事说的时候你就不看了');

// ---- 4. 浪费:只认亲手点的「扔了」 ----
db = { rounds: [], wasteLog: [] };
ok(!byId('wasted').ready, '一条浪费记录都没有就开始报「什么总是剩」');
db.wasteLog = [
  { ingredientId: 'spinach', name: '菠菜', grams: 100 },
  { ingredientId: 'spinach', name: '菠菜', grams: 80 },
  { ingredientId: 'spinach', name: '菠菜', grams: 120 },
  { ingredientId: 'onion', name: '洋葱', grams: 50 },
  { ingredientId: 'onion', name: '洋葱', grams: 30 },
];
var w = byId('wasted');
ok(w.ready && /菠菜/.test(w.detail), '没认出反复扔的是菠菜:' + w.detail);
ok(!!w.action, '菠菜扔了三次却没给动作');

// ---- 5. 份量:**不许建议调高总热量** ----
// 这条是这个文件里最要紧的一条。减脂目标下「不够吃」是常态,
// 照着它加总量的话目标会一路往上漂,减脂就白做了。
var hungry = {};
['A', 'B', 'C', 'D'].forEach(function (k) { hungry[k] = { fill: 'more' }; });
db = { rounds: [mkRound('r1', m4, hungry), mkRound('r2', m4, hungry)], wasteLog: [] };
var p = byId('portion');
ok(p.ready, '八条份量反馈了还不给结论');
ok(!!p.action, '一多半说不够吃,却什么都不说');
// ⚠️ 判据必须是**语义**,不是字面。
//    第一版写的是「不许出现『调高目标』四个字」—— 结果把
//    「**别急着**调高目标」也判成违规,而那句话的意思正好相反。
//    按关键词查文案,迟早会把正确的说法也拦下来。
//    真正要防的是「建议里只有加量、没有调构成」,所以正着测:
//    必须提到构成(蔬菜/蛋白/比例),而且必须带一句劝阻。
ok(/蔬菜|蛋白|比例|构成/.test(p.action || ''),
   '「不够吃」的建议里没提调构成 —— 只会让人去调高目标,' +
   '而减脂目标下那样会一路漂移(第 19 条)。实际是:' + p.action);
ok(/别|不是|先/.test(p.action || ''),
   '没有劝阻「直接加总量」的意思 —— 实际是:' + p.action);

// ---- 6. 不想再做的:动作要能一键做掉 ----
var bad = { A: { like: 'bad' }, B: { like: 'bad' }, C: { like: 'good' },
            D: { like: 'ok' }, E: { like: 'ok' }, F: { like: 'ok' } };
var m6 = m4.concat([{ recipeId: 'E', name: '戊', cooked: true },
                    { recipeId: 'F', name: '己', cooked: true }]);
db = { rounds: [mkRound('r1', m6, bad)], wasteLog: [] };
var d = byId('disliked');
ok(d.ready, '六条评分了还不给「不想再做」');
ok(d.actionKind === 'exclude' && (d.payload || []).length === 2,
   '「不想再做」没给出可一键排除的清单 —— 那就只是让你看着难受');

console.log(fail ? '统计 ' + fail + ' 处不对'
                 : '  统计 ok(样本不够不给数 · 指标都接得上动作 · 不拿反馈调总量)');
process.exit(fail ? 1 : 0);
