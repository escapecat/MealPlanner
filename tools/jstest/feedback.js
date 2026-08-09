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
for (var i = 0; i < 8; i++) click(node, /^做了$/);
ok(click(node, /结束这一轮|全做完了/), '找不到「结束这一轮」');

var t = deep(node);
// ---- 1. 结束前必须问一次 —— 这是唯一问得出来的时机 ----
ok(/好吃/.test(t) && /不想再做/.test(t), '结束时没有问好不好吃 —— 那是 app 永远猜不到的');
ok(/不够/.test(t) || /吃不完/.test(t), '没有问够不够吃');

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
