// 设置页的「当前配置可做 N 道」必须真的跟着每一项变。
//
// ⚠️ 这条 bug 不报错,而且比不显示还糟:
//    它用一个**假数字**告诉你「你的选择没有代价」。
//    根因是 kitchenSection 和 costOf 各自手抄了一份约束字段列表,
//    后来加的 maxDifficulty / maxIdleWait / allowOvernight 谁都没补上。
//    手抄的字段列表一定会漏 —— 所以现在只有 constraintsOf 一处。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

global.INGREDIENTS = require(path.join(A, 'data', 'ingredients.js'));
global.RECIPES = require(path.join(A, 'data', 'recipes.js'));
global.Equipment = require(path.join(A, 'core', 'equipment.js'));
global.Timing = require(path.join(A, 'core', 'timing.js'));
var Catalog = require(path.join(A, 'core', 'catalog.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}

var BASE = { equipment: ['炒锅', '汤锅', '不粘锅'], blacklist: [], maxSpicy: 3,
             maxActiveMinutes: 45, maxDifficulty: 3, maxIdleWait: 120,
             allowOvernight: false };
var base = Catalog.countAvailable(BASE).dishes;

// 每一条约束单独改动,可做数都必须变 —— 不变就说明这条没被传进去
[['maxDifficulty', 5], ['maxDifficulty', 2],
 ['maxActiveMinutes', 20], ['maxIdleWait', 30],
 ['allowOvernight', true], ['maxSpicy', 0]].forEach(function (t) {
  var cfg = Object.assign({}, BASE);
  cfg[t[0]] = t[1];
  var n = Catalog.countAvailable(cfg).dishes;
  ok(n !== base, t[0] + ' = ' + t[1] + ' → ' + base + ' 变成 ' + n + ' 道');
});

// 设置页必须走同一个入口拼约束,不许再手抄字段
var src = require('fs').readFileSync(path.join(A, 'ui', 'settings.js'), 'utf8');
var handRolled = (src.match(/Catalog\.countAvailable\(\{/g) || []).length;
ok(handRolled === 0,
   'settings.js 里没有手抄的 countAvailable({...})' +
   (handRolled ? '(还有 ' + handRolled + ' 处)' : '，全走 constraintsOf'));
ok(/function constraintsOf/.test(src), 'constraintsOf 还在');
// ⚠️ 这里故意用 indexOf 而不是正则:
//    heredoc 会把 \s 吃成 \s,再进 RegExp 就成了字面的 s,断言永远失败。
//    这个坑在这个项目里已经踩过三次(build_data.py 两次、boot.js 一次)。
['maxDifficulty', 'maxIdleWait', 'allowOvernight', 'maxSpicy', 'maxActiveMinutes']
  .forEach(function (f) {
    ok(src.indexOf(f + ': cfg.' + f) >= 0, 'constraintsOf 带上了 ' + f);
  });


// --- 厨具替代:蒸和焖饭最不挑锅,别把人卡死 ---
//
// ⚠️ 蒸架第一版在替代矩阵里**整条都没有** —— 45 道菜要它,却没写谁能顶。
//    而「蒸」这件事家里但凡有个带盖的锅都能干:汤锅架个碗、炒锅加盖、
//    电饭煲自带蒸格。厨具是排除菜谱的第一大原因(165 道),这种漏写代价很大。
global.Equipment = require(path.join(A, 'core', 'equipment.js'));
var steamed = RECIPES.filter(function (r) {
  return (r.equipmentRequired || []).indexOf('蒸架') >= 0 && r.method === '蒸';
})[0];
ok(!!steamed, '库里有要蒸架的蒸菜(' + (steamed ? steamed.name : '?') + ')');
if (steamed) {
  ['汤锅', '炒锅', '电饭煲'].forEach(function (pot) {
    var e = Equipment.check(steamed, [pot]);
    ok(e.ok, '只有' + pot + '也能蒸');
    var sub = (e.subs || []).filter(function (x) { return x.need === '蒸架'; })[0];
    ok(!!(sub && sub.note), '而且带出了注意事项(' + pot + ')');
  });
}

// 电饭煲能顶汤锅炖汤 —— 现在的电饭煲基本都有煲汤模式
ok(Equipment.satisfy('汤锅', ['电饭煲'], '炖').ok, '电饭煲能顶汤锅炖');
ok(Equipment.satisfy('蒸架', ['电饭煲'], '蒸').ok, '电饭煲能顶蒸架蒸');
// 但爆炒没得顶 —— 这条硬要求不能被顺手放开
ok(!Equipment.satisfy('炒锅', ['汤锅'], '爆').ok, '爆炒仍然非炒锅不可');

var pots = { equipment: ['炒锅', '汤锅'] };
var withPots = Catalog.countAvailable(Object.assign({}, BASE, pots)).dishes;
ok(withPots > 340, '只有炒锅+汤锅时可做 ' + withPots + ' 道(补矩阵前是 306)');


// 电压力锅是**省时间的工具,不是必需品** —— 炖焖煮普通锅都能干,只是慢。
// ⚠️ 但替代之后库里的时间就偏乐观了(那是按压力锅估的),
//    所以 note 必须把这条说出来。测试钉住「不许悄悄替代」。
ok(Equipment.satisfy('电压力锅', ['汤锅'], '炖').ok, '没有压力锅,汤锅也能炖');
var ps = Equipment.satisfy('电压力锅', ['汤锅'], '炖');
ok(!!ps.note && ps.note.indexOf('时间') >= 0,
   '而且说明里点出了「时间要长得多」—— 不能悄悄替代');
ok(!Equipment.satisfy('电压力锅', ['不粘锅'], '炖').ok,
   '不粘锅不给顶压力锅(浅、涂层不耐久炖)');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
