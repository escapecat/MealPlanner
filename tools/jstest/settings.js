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

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
