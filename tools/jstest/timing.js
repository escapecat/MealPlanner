// 「多久能吃上」的测试。
//
// 这一条值得单独测,因为错了不会报错,只会让你按 20 分钟安排晚饭、
// 结果 50 分钟才开饭。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

global.RECIPES = require(path.join(A, 'data', 'recipes.js'));
global.INGREDIENTS = require(path.join(A, 'data', 'ingredients.js'));
var Timing = require(path.join(A, 'core', 'timing.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}
function byName(n) {
  return RECIPES.filter(function (r) { return r.name === n; })[0];
}

// ⚠️ 库里的「总分钟」不含提前准备。木耳炒蛋写 20 分,实际要先泡发 30 分钟。
//    页面写 20 分而你 50 分钟才吃上,骗的正好是最要紧的那个决定:
//    「今天还来得及做这个吗」。
var muer = byName('木耳炒蛋');
ok(!!muer, '库里有木耳炒蛋');
if (muer) {
  var tm = Timing.ofMeal(muer.variants[0], null);
  ok(tm.eatIn === muer.variants[0].totalMinutes + 30,
     '木耳炒蛋:库里写 ' + muer.variants[0].totalMinutes + ' 分,实际 ' +
     Timing.fmt(tm.eatIn) + '(含泡发 30 分)');
}

var fan = byName('蛋炒饭');
if (fan) {
  ok(Timing.ofMeal(fan.variants[0], null).overnight,
     '蛋炒饭标出「要隔夜」—— 今天想吃是来不及的');
}

ok(Timing.parseAhead('糯米泡2小时').minutes === 120, '「2小时」解析成 120 分');
ok(Timing.parseAhead('腌 15分钟').minutes === 15, '「15分钟」解析成 15 分');
ok(Timing.parseAhead('焯水').minutes === 0, '纯动作(焯水)记 0,不瞎猜时长');
ok(Timing.parseAhead('—').minutes === 0, '破折号记 0');
ok(Timing.parseAhead('腌隔夜').overnight === true, '「腌隔夜」判成隔夜,不是 0');
ok(Timing.fmt(115) === '1 小时 55 分', '115 分读成「1 小时 55 分」');
ok(Timing.fmt(45) === '45 分', '不到一小时不写「0 小时」');

// 配菜是并行做的,不是接在主菜后面 —— 一个人在厨房当然是穿插着来的
var a = { totalMinutes: 60, activeMinutes: 25, aheadOfTime: null };
var b = { totalMinutes: 10, activeMinutes: 8, aheadOfTime: null };
var both = Timing.ofMeal(a, b);
ok(both.eatIn === 60, '主菜 60 分 + 配菜 10 分 → 能吃上还是 60 分(并行)');
ok(both.active === 33, '但动手要相加 25+8=33 分(那是真要多站的)');


// 「等」有两种,不能合成一个数
var mengfan = byName('新疆手抓饭');
if (mengfan) {
  var mt = Timing.ofMeal(mengfan.variants[0], null);
  ok(mt.active === 25 && mt.idle === 55,
     '新疆手抓饭：动手 ' + mt.active + ' 分、空等 ' + mt.idle +
     ' 分（泡米 20 + 焖 35）—— 两个数分开算');
  ok(mt.eatIn === mt.active + mt.idle, '能吃上 = 动手 + 空等');
}
var idleOnly = Timing.ofMeal({ totalMinutes: 90, activeMinutes: 10, aheadOfTime: null }, null);
ok(idleOnly.idle === 80,
   '动手 10 分、锅里焖 90 分 → 空等 80 分（动手上限拦不住它）');

// 全库统计 —— 这些数字是「等太久」这条约束的依据
var n = 0, over60 = 0, overnight = 0, withAhead = 0;
RECIPES.filter(function (r) { return r.type !== 'prep'; }).forEach(function (r) {
  (r.variants || []).forEach(function (v) {
    var t = Timing.ofMeal(v, null);
    n++;
    if (t.overnight) overnight++;
    if (t.ahead > 0) withAhead++;
    if (t.eatIn > 60) over60++;
  });
});
console.log('       全库 ' + n + ' 个变体:要隔夜 ' + overnight +
            ' · 要提前准备 ' + withAhead + ' · 超过 1 小时才能吃上 ' + over60);
ok(overnight > 0 && over60 > 0, '统计跑得出来');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
