// 按钮层级 —— **一屏只能有一个主按钮。**
//
// ⚠️ 真出过,而且一眼就看得出来:计划页顶上「＋ 这次要做饭了」是绿实心,
//    卡片里「生成采购清单和菜」也是绿实心,两个上下叠着。
//    你不知道该点哪个 —— 而正确答案是下面那个,上面那个只是「还想再开一轮」。
//
// 三级:
//    .btn         主操作,一屏一个。绿实心,48 高
//    .btn.ghost   次操作。描边
//    .link        三级(取消 / 删除 / 重新生成)。无边框,小字
//
// 三个都做成整宽大按钮堆着,等于没有层级。
var path = require('path');
var fs = require('fs');
var vm = require('vm');
var ROOT = path.join(__dirname, '..', '..');
var APP = path.join(ROOT, 'app');

// 复用 boot.js 那套 DOM 桩(照抄比 require 稳 —— boot.js 是个跑完就 exit 的脚本)
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
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
html.replace(/src="([^"]+\.js)"/g, function (_, f) {
  vm.runInContext(fs.readFileSync(path.join(APP, f), 'utf8'), ctx, { filename: f });
  return _;
});

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function deep(el) {
  if (el.tagName === '#TEXT') return el.text || '';
  return (el.text || '') + el.children.map(deep).join('');
}
function primaries(root) {
  return root.all().filter(function (el) {
    var cls = (el.className || el.attrs.class || '').split(/\s+/);
    // .btn 且不带 ghost/danger —— 就是绿实心那一档
    return cls.indexOf('btn') >= 0 && cls.indexOf('ghost') < 0 && cls.indexOf('danger') < 0;
  });
}
function click(root, re) {
  var hit = root.all().filter(function (el) {
    return (el.handlers.click || []).length && re.test(deep(el));
  })[0];
  if (hit) hit.handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
  return !!hit;
}

// ---- 空状态:唯一的主按钮就是「开始」 ----
var node = new El('div');
ctx.RoundsUI.mount(node);
var p0 = primaries(node);
ok(p0.length === 1, '空状态有 ' + p0.length + ' 个主按钮(应该只有「＋ 这次要做饭了」):' +
   p0.map(deep).join(' / '));

// ---- 建了一轮还没生成:主按钮该是「生成」,顶上那个要退成描边 ----
click(node, /这次要做饭/);
click(node, /记下这一次/);
var p1 = primaries(node);
ok(p1.length === 1, '有待办轮次时出现了 ' + p1.length + ' 个主按钮:' + p1.map(deep).join(' / '));
if (p1.length === 1) {
  ok(/生成采购清单/.test(deep(p1[0])),
     '唯一的主按钮应该是「生成采购清单和菜」,实际是「' + deep(p1[0]) + '」');
}

// ---- 生成之后:主按钮该是「开始做饭」 ----
click(node, /生成采购清单/);
var p2 = primaries(node);
ok(p2.length === 1, '排完之后出现了 ' + p2.length + ' 个主按钮:' + p2.map(deep).join(' / '));
if (p2.length === 1) {
  ok(/开始做饭/.test(deep(p2[0])),
     '排完之后唯一的主按钮应该是「开始做饭」,实际是「' + deep(p2[0]) + '」');
}

// ---- 做完一轮之后,不能是死胡同 ----
//
// ⚠️ 真出过:结束之后整屏唯一能点的是**红色的「删除这一轮」**,
//    而且四张菜卡还全铺着(1530 字)。
//    「做完一轮」的下一步显然是「再排一轮」,不是「把它删了」——
//    那条记录正是这个 app 的立身之本(攒多了才看得出「总剩菠菜」)。
vm.runInContext('(function(){var rs=Store.get("rounds",[]);' +
                'rs[0].status="done";Store.set("rounds",rs);})()', ctx);
var node2 = new El('div');
ctx.RoundsUI.mount(node2);
var p3 = primaries(node2);
ok(p3.length >= 1, '一轮结束之后一个主按钮都没有 —— 流程走到死胡同了');
ok(p3.some(function (b) { return /再排一轮|这次要做饭/.test(deep(b)); }),
   '结束之后的主按钮应该是「再排一轮」,实际是:' + p3.map(deep).join(' / '));

// 结束了的轮次该折起来 —— 它是历史,不是工作台
var t2 = deep(node2);
ok(t2.length < 900,
   '结束之后那一屏还有 ' + t2.length + ' 个字(菜卡多半没折起来)');

// ---- 攒了很多轮之后,这一页不能越来越长 ----
//
// ⚠️ 真出过:**每一轮都完整渲染,永远累积**。每周做一次的话,
//    两个月就是 8 张卡、3272 个字、113 个可点区域,而且全是已经结束的。
//    你打开 app 是想看这周吃什么,不是复习两个月前做过啥。
//
// 这类退化**不报错也不白屏** —— 只是用得越久越难用,而且是慢慢变糟的,
// 等你察觉的时候已经忍了很久了。所以得有个数盯着。
vm.runInContext('(function(){' +
  'var rs=Store.get("rounds",[]);var one=rs[0];var out=[];' +
  'for(var i=0;i<12;i++){var c=JSON.parse(JSON.stringify(one));' +
  'c.id="h"+i;c.status="done";out.push(c);}' +
  'Store.set("rounds",out);})()', ctx);
var node3 = new El('div');
ctx.RoundsUI.mount(node3);
var t3 = deep(node3);
ok(t3.length < 1200,
   '攒了 12 轮之后这一页有 ' + t3.length + ' 个字 —— 历史该收成一行一条,不是全铺开');
// ⚠️ 判据是**行为**不是措辞:改一次分组标题的文案不该让测试挂。
//    (「以前的」改成「做过的」时它就挂了一次 —— 测的是字面,不是事实。)
//    真正要的是:12 轮之后,页面上出现的可点行数量和轮次数量对得上,
//    说明它们被收成了一行一条,而不是每条铺开成一张卡。
var rows3 = node3.all().filter(function (el) {
  return (el.className || '').indexOf('list-row') >= 0 && /月.*日/.test(deep(el));
});
ok(rows3.length >= 10,
   '12 轮只找到 ' + rows3.length + ' 条历史行 —— 历史没有收成一行一条');

// 但历史不能藏死:点开得看得到
var row = node3.all().filter(function (el) {
  return (el.handlers.click || []).length &&
         (el.className || '').indexOf('list-row') >= 0 && /月.*日/.test(deep(el));
})[0];
ok(!!row, '历史里找不到可点开的那一行');
if (row) {
  row.handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
  ok(deep(node3).length > t3.length, '点开一条历史之后内容没变多 —— 展不开等于看不了');
}

// ---- 「重新生成」得真的换一批 ----
//
// ⚠️ 真出过,而且藏了很久:Solver 的默认种子是 `servings * 7919`(一个常数),
//    而 rounds.js **从来没传过 seed** —— 于是整个求解是完全确定性的:
//    配置不变、冰箱不变,连点五次「重新生成」给你的是同一份菜,
//    下一周开新一轮排出来的也还是那四道。
//
// ⚠️ 为什么一直没发现:**100 轮模拟一直在传 `seed: s`** ——
//    测的是一个线上不存在的用法。和 boot.js 的键少了命名空间前缀是同一类错:
//    **测试跑的路径和真实路径不是同一条。**
//    所以这条必须**照 UI 的方式**调(走 RoundsUI,不直接调 Solver)。
vm.runInContext('Store.set("rounds", [])', ctx);
var node4 = new El('div');
ctx.RoundsUI.mount(node4);
click(node4, /这次要做饭/);
click(node4, /记下这一次/);
var seenPlans = {};
for (var g = 0; g < 5; g++) {
  click(node4, /生成采购清单|重新生成/);
  var rs4 = vm.runInContext('JSON.parse(JSON.stringify(Store.get("rounds",[])))', ctx);
  var got = ((rs4[0] || {}).solved || {}).meals || [];
  seenPlans[got.map(function (m) { return m.name; }).join('|')] = 1;
}
ok(Object.keys(seenPlans).length >= 4,
   '连点 5 次「重新生成」只得到 ' + Object.keys(seenPlans).length +
   ' 种结果 —— seed 多半又没传下去(默认是常数)');

console.log(fail ? '按钮层级 ' + fail + ' 处不对'
                 : '  流程/层级 ok(四状态各一主按钮 · 结束不死胡同 · 12 轮不涨页 · 重排真换菜)');
process.exit(fail ? 1 : 0);
