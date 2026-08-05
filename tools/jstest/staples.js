// 回归测试:勾一样调料,它得留得住。
//
// 这条 bug 的形状值得记一笔:一次性迁移写成了每帧重算的形状推断,
// 而用户新存进去的数据恰好长成「待迁移」的样子,于是每次 render 都被抹掉。
// 表现出来是「点了没反应」,看代码看不出来,只有走一遍两次 render 才暴露。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.Store = {
  get: function (k, d) { return mem[k] === undefined ? d : mem[k]; },
  set: function (k, v) { mem[k] = JSON.parse(JSON.stringify(v)); },
};
global.INGREDIENTS = require(path.join(A, 'data', 'ingredients.js'));
global.RECIPES = require(path.join(A, 'data', 'recipes.js'));
var Pantry = require(path.join(A, 'core', 'pantry.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}

// --- 1. 全新用户:柜子是空的,不预勾 ---
mem = {};
Pantry.ensureInit();
ok(Pantry.staples().length === 0, '全新用户柜子为空(不预勾 11 样)');
ok(Pantry.confirmed() === false, '没确认过');

// --- 2. 勾一样,再 render 一次,得还在 ---
Pantry.toggleStaple('salt', null);
ok(Pantry.hasStaple('salt'), '勾上「食盐」');
Pantry.ensureInit();                     // 模拟第二次 render
ok(Pantry.hasStaple('salt'), '第二次 render 后还在  ← 这条以前是挂的');
Pantry.ensureInit();
Pantry.ensureInit();
ok(Pantry.hasStaple('salt'), '第四次 render 后还在');
ok(Pantry.stapleEntry('salt').addedAt === null,
   '清点勾上的不盖时间戳(「我有盐」≠「我今天买了盐」)');

// --- 3. 搜索加进来的,盖今天 ---
Pantry.toggleStaple('cumin');
ok(!!Pantry.stapleEntry('cumin').addedAt, '搜索加的记今天买入');

// --- 4. 旧用户迁移:自动注入的 11 样清掉,且只清一次 ---
mem = { staples: Pantry.STARTER.map(function (id) { return { id: id, openedAt: null }; }) };
Pantry.ensureInit();
ok(Pantry.staples().length === 0, '旧版自动注入的 11 样被清掉');
Pantry.toggleStaple('salt', null);
Pantry.ensureInit();
ok(Pantry.hasStaple('salt'), '迁移后再勾,留得住(迁移不重复跑)');

// --- 5. 用户动过的数据不许碰 ---
mem = { staples: [{ id: 'salt', addedAt: '2026-01-01T00:00:00.000Z', openedAt: null }] };
Pantry.ensureInit();
ok(Pantry.hasStaple('salt'), '用户填过买入时间的条目不被迁移清掉');

// --- 6. 字典里没有的也能记 ---
mem = {};
Pantry.ensureInit();
Pantry.addCustomStaple('我妈寄的辣椒酱');
var e = Pantry.stapleEntry('custom:我妈寄的辣椒酱');
ok(!!e, '自定义调料能加');
ok(Pantry.resolve(e).name === '我妈寄的辣椒酱', 'resolve 拿得到名字(不会被静默丢掉)');
ok(Pantry.resolve(e).shelfLifeDays === null, '自定义条目如实标「没有保质期数据」');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
