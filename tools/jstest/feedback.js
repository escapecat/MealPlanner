// 反馈 —— **唯一一次问得出来的时机**,过了这顿就想不起来了。
//
// ⚠️ FEATURES 第 24 条:**30 秒内填完**。填反馈一旦变成作业你就不填,
//    数据没了,整条学习链断掉。所以这个文件盯的不是「有没有反馈功能」,
//    是「**它会不会让人不想填**」。
//
// ⚠️ 还有一条更要紧:**能自动观测的绝不问用户**。
//    做没做成有 cooked、扔了多少库存里记了 —— 再问一遍就是在浪费那 30 秒。

var path = require('path');
var fs = require('fs');
var vm = require('vm');
var APP = path.join(__dirname, '..', '..', 'app');

function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.text = '';
}
Object.defineProperty(El.prototype, 'innerHTML',
  { get: function () { return ''; }, set: function () { this.children = []; } });
Object.defineProperty(El.prototype, 'textContent',
  { get: function () { return this.text; },
    set: function (v) { this.text = v; this.children = []; } });
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (k, f) { (this.handlers[k] = this.handlers[k] || []).push(f); };
El.prototype.removeEventListener = function () {};
El.prototype.focus = function () {}; El.prototype.select = function () {};
El.prototype.setSelectionRange = function () {};
El.prototype.all = function (out) {
  out = out || [];
  this.children.forEach(function (c) { out.push(c); c.all(out); });
  return out;
};
El.prototype.querySelector = function (sel) {
  var want = sel.replace(/^#/, ''), byId = sel[0] === '#';
  return this.all().filter(function (c) {
    return byId ? c.attrs.id === want : c.tagName === sel.toUpperCase();
  })[0] || null;
};

var mem = {}, NS = 'mealplanner:';
var body = new El('body'), appDiv = new El('div');
appDiv.attrs.id = 'app'; body.appendChild(appDiv);
var sandbox = {
  document: {
    body: body, documentElement: new El('html'), activeElement: null,
    createElement: function (t) { return new El(t); },
    createTextNode: function (t) { var n = new El('#text'); n.text = t; return n; },
    createDocumentFragment: function () { return new El('#frag'); },
    getElementById: function (id) { return id === 'app' ? appDiv : null; },
    querySelector: function (s) { return body.querySelector(s); },
    addEventListener: function () {}, removeEventListener: function () {},
  },
  console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
  Promise: Promise, Date: Date, Math: Math, JSON: JSON, Object: Object, Array: Array,
  String: String, Number: Number, isNaN: isNaN, parseInt: parseInt, parseFloat: parseFloat,
  RegExp: RegExp, Error: Error, encodeURIComponent: encodeURIComponent,
  localStorage: {
    getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; },
    key: function (i) { return Object.keys(mem)[i] || null; },
    get length() { return Object.keys(mem).length; },
  },
  location: { reload: function () {} },
};
sandbox.window = sandbox; sandbox.globalThis = sandbox;
mem[NS + 'profile'] = JSON.stringify({ sex: 'male', age: 30, heightCm: 175,
                                       activity: 'light', goal: 'cut', breakfast: 'light' });
mem[NS + 'weightLog'] = JSON.stringify([{ date: '2026-01-01T00:00:00.000Z', kg: 70 }]);
mem[NS + 'config'] = JSON.stringify({ equipment: ['炒锅', '空气炸锅', '电饭煲'], maxSpicy: 1,
                                      maxActiveMinutes: 45, maxDifficulty: 3, maxIdleWait: 60,
                                      allowOvernight: false, blacklist: [] });
mem[NS + 'staples'] = JSON.stringify(['salt', 'cooking_oil', 'light_soy_sauce', 'rice']
                                     .map(function (id) { return { id: id }; }));
mem[NS + 'staplesMigrated'] = 'true';
mem[NS + 'staplesConfirmed'] = 'true';

var ctx = vm.createContext(sandbox);
fs.readFileSync(path.join(APP, 'index.html'), 'utf8')
  .replace(/src="([^"]+\.js)"/g, function (_, f) {
    vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
    return _;
  });

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function deep(el) {
  if (el.tagName === '#TEXT') return el.text || '';
  return (el.text || '') + el.children.map(deep).join('');
}
function click(root, re) {
  var hit = root.all().filter(function (el) {
    return (el.handlers.click || []).length && re.test(deep(el));
  })[0];
  if (hit) hit.handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
  return !!hit;
}

// 走完整条真实路径:建轮 → 生成 → 开做 → 每道点做了 → 结束
var node = new El('div');
ctx.RoundsUI.mount(node);
click(node, /这次要做饭/);
click(node, /记下这一次/);
click(node, /生成采购清单/);
click(node, /买齐了|开始做饭/);

// ---- 0. 点完「做了」要**自动翻到下一顿** ----
//
// ⚠️ 这条一直是「碰巧对」的:openMeal 初值 null 时展开哪一顿由
//    `firstTodo` 自动算,做掉一顿自然就轮到下一顿。可**你一旦手点过
//    某张卡的标题**,openMeal 就被钉死在那个 key 上,自动规则从此失效 ——
//    点完「做了」原地不动:刚做完的卡还整屏摊着(配料、备注、搜做法),
//    下一顿还收着一行。而这时候要做什么根本没有歧义。
//    所以测之前必须**先手点一张卡**,把这条路走到真实状态里去,
//    否则测的是那个碰巧对的分支。
function mealHeads(root) {
  return root.all().filter(function (el) {
    var d = deep(el);
    return (el.handlers.click || []).length && /[▸▴]$/.test(d) &&
           !/采购清单|这几天做什么|做过这些/.test(d);
  });
}
var heads0 = mealHeads(node);
ok(heads0.length >= 3, '菜卡少于 3 张,这条测不出东西(实际 ' + heads0.length + ')');
var openName = deep(heads0[1]).replace(/[▸▴]/g, '').trim();
heads0[1].handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
ok(/▴$/.test(deep(mealHeads(node)[1])), '手点标题都没展开这一顿');

ok(click(node, /^做了$/), '展开的那顿上找不到「做了」');
var openNow = mealHeads(node).filter(function (el) { return /▴$/.test(deep(el)); });
ok(openNow.length === 1,
   '做完一顿之后摊开的卡有 ' + openNow.length + ' 张 —— 灶台前一次只该看一顿');
ok(openNow.length === 1 && deep(openNow[0]).indexOf(openName) < 0,
   '做完之后还停在刚做完的「' + openName + '」上 —— ' +
   '你已经说了这道做完了,下一步是什么没有歧义,不该再让人手动收一张点一张');
// ⚠️ 光展开不够:上面那张卡从整屏塌成一行,页面凭空缩掉十几屏,
//    人原地不动就被甩到下一顿**下面**去了。得有个锚点能滚过去。
ok(node.all().some(function (el) { return el.attrs.id === 'open-meal'; }),
   '摊开的菜卡没有滚动锚点 —— 翻是翻了,屏幕不动等于没翻');

for (var i = 0; i < 8; i++) click(node, /^做了$/);
ok(click(node, /结束这一轮|全做完了/), '找不到「结束这一轮」');

var t = deep(node);
// ---- 1. 结束前必须问一次 —— 这是唯一问得出来的时机 ----
ok(/好吃/.test(t) && /不想再做/.test(t), '结束时没有问好不好吃 —— 那是 app 永远猜不到的');
ok(/不够/.test(t) || /吃不完/.test(t), '没有问够不够吃');

// ---- 1b. 反馈是**单独一屏**,不是接在做菜那页屁股后面 ----
// ⚠️ 第一版就是后者:点完「结束这一轮」,反馈长在整页最底下,
//    上面压着采购清单、四张菜卡、一堆提示 —— 你得先划过一整页
//    **已经不需要再看的东西**才够得着它。30 秒就是这么没的。
ok(!/采购清单|搜做法/.test(t),
   '反馈还和做菜那页挤在一起 —— 换屏才是「结束这一轮」该有的样子');
ok(/回去|返回/.test(t),
   '整页接管却没有不改状态的退路 —— 误点「结束这一轮」就出不去了');

// ---- 2. 耗时:**不许假装自己测到了** ----
// ⚠️ FEATURES 写的是「点开始/点做完自动记」,而只做了一半:
//    cookedAt 只有做完的时刻,没有开始 —— 耗时根本算不出来。
//    所以要么老实问,要么别提。这里查的是「问的是相对准不准」,
//    而不是编一个绝对分钟数出来。
ok(/比说的快|比说的久/.test(t),
   '没问时间估得准不准 —— 而 cookedAt 只有做完时刻,绝对耗时是算不出来的');

// ---- 3. **不填也能结束**。逼着填就是把它变成作业,那正是第 24 条要防的 ----
ok(/跳过/.test(t), '没有「跳过」的出口 —— 逼着填反馈,下次你就不做饭了');

// ---- 4. 30 秒填得完吗:点的次数得有个上限 ----
var taps = node.all().filter(function (el) {
  return (el.handlers.click || []).length && /^(好吃|一般|不想再做|吃不完|正好|不够|比说的快|差不多|比说的久)$/
    .test(deep(el).trim());
}).length;
ok(taps > 0, '一个可点的评价都没有');
ok(taps <= 40, '反馈页有 ' + taps + ' 个点选项 —— 四顿饭最多 36 个(3 组 × 3 档 × 4 顿)');

// ---- 5. 点一下就存,不等你按结束 ----
// 填到一半切走不该白填 —— 而这正是「30 秒」最容易断的地方。
click(node, /^好吃$/);
var rs = vm.runInContext('JSON.parse(JSON.stringify(Store.get("rounds",[])))', ctx);
var ratings = ((rs[0] || {}).log || {}).ratings || {};
ok(Object.keys(ratings).length > 0, '点了「好吃」但没存下来 —— 填到一半切走就白填了');

// ---- 6. 结束之后评价还在 ----
click(node, /结束这一轮|跳过/);
var rs2 = vm.runInContext('JSON.parse(JSON.stringify(Store.get("rounds",[])))', ctx);
ok(rs2[0].status === 'done', '点了结束但状态没变成 done');
ok(Object.keys((rs2[0].log || {}).ratings || {}).length > 0, '结束之后评价丢了');
ok((rs2[0].log || {}).cookedCount != null, '没记 cookedCount —— 统计层要靠它算完成率');

console.log(fail ? '反馈 ' + fail + ' 处不对'
                 : '  反馈 ok(' + taps + ' 个点选项 · 随手就存 · 可跳过 · 不假装测到耗时)');
process.exit(fail ? 1 : 0);
