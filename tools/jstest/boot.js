// 开机冒烟测试 —— 按 index.html 的顺序把所有脚本真跑一遍,然后挂载每个页面。
//
// ⚠️ 为什么必须有这个:`node --check` 只查语法。
//    白屏是**运行时**抛异常 —— 少一个全局、模块顺序反了、某个函数名打错,
//    语法全都合法,check.sh 全绿,可页面一片空白,而且控制台之外没有任何提示。
//    这是所有故障里最糟的一种:功能全在,你什么都看不见。
//
// 用最小 DOM 桩,不引 jsdom(项目零依赖,双击 index.html 要能跑)。

var fs = require('fs');
var path = require('path');
var vm = require('vm');

var ROOT = path.join(__dirname, '..', '..');
var APP = path.join(ROOT, 'app');

// ---- 最小 DOM 桩 ----
function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.text = '';
  this.parentNode = null;
}
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return ''; },
  set: function () { this.children = []; },
});
Object.defineProperty(El.prototype, 'textContent', {
  get: function () { return this.text; },
  set: function (v) { this.text = v; this.children = []; },
});
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; });
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.getAttribute = function (k) { return this.attrs[k]; };
El.prototype.addEventListener = function (k, fn) { (this.handlers[k] = this.handlers[k] || []).push(fn); };
El.prototype.removeEventListener = function () {};
El.prototype.focus = function () {}; El.prototype.select = function () {};
El.prototype.setSelectionRange = function () {};
El.prototype.all = function (out) {
  out = out || [];
  this.children.forEach(function (c) { out.push(c); c.all(out); });
  return out;
};
El.prototype.querySelector = function (sel) {
  var want = sel.replace(/^#/, '');
  var byId = sel[0] === '#';
  return this.all().filter(function (c) {
    return byId ? c.attrs.id === want : c.tagName === sel.toUpperCase();
  })[0] || null;
};

var mem = {};
function makeSandbox() {
  var body = new El('body');
  var appDiv = new El('div');
  appDiv.attrs.id = 'app';
  body.appendChild(appDiv);
  var doc = {
    body: body,
    documentElement: new El('html'),
    activeElement: null,
    createElement: function (t) { return new El(t); },
    createTextNode: function (t) { var n = new El('#text'); n.text = t; return n; },
    createDocumentFragment: function () { return new El('#frag'); },
    getElementById: function (id) { return id === 'app' ? appDiv : null; },
    querySelector: function (s) { return body.querySelector(s); },
    addEventListener: function () {}, removeEventListener: function () {},
  };
  var sandbox = {
    document: doc,
    console: console,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    Promise: Promise, Date: Date, Math: Math, JSON: JSON, Object: Object,
    Array: Array, String: String, Number: Number, isNaN: isNaN,
    parseInt: parseInt, parseFloat: parseFloat, RegExp: RegExp, Error: Error,
    encodeURIComponent: encodeURIComponent,
    localStorage: {
      getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
      setItem: function (k, v) { mem[k] = String(v); },
      removeItem: function (k) { delete mem[k]; },
      key: function (i) { return Object.keys(mem)[i] || null; },
      get length() { return Object.keys(mem).length; },
    },
    location: { reload: function () {} },
  };
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  return sandbox;
}

// index.html 里 <script src> 的顺序就是真实加载顺序 —— 照抄,不自己排
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var srcs = [];
html.replace(/src="([^"]+\.js)"/g, function (_, s) { srcs.push(s); return _; });

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}

var ctx = vm.createContext(makeSandbox());
var loaded = 0;
for (var i = 0; i < srcs.length; i++) {
  var f = path.join(APP, srcs[i]);
  try {
    vm.runInContext(fs.readFileSync(f, 'utf8'), ctx, { filename: srcs[i] });
    loaded++;
  } catch (e) {
    ok(false, '加载 ' + srcs[i] + ' 时抛异常:' + e.message);
    console.log('         ' + (e.stack || '').split('\n')[1]);
    break;
  }
}
ok(loaded === srcs.length, 'index.html 里的 ' + srcs.length + ' 个脚本全部加载通过');

if (loaded === srcs.length) {
  // app.js 是 IIFE,加载时就已经 render 过一次(冷启动页)
  var appDiv = ctx.document.getElementById('app');
  ok(appDiv.children.length > 0, '冷启动:#app 里渲染出内容了(不是白屏)');

  // 填一份 profile 让它跳过 onboarding,然后逐页挂载
  mem.profile = JSON.stringify({ sex: 'male', age: 30, heightCm: 175, activity: 'light',
                                 goal: 'maintain', breakfast: 'normal' });
  mem.weightLog = JSON.stringify([{ date: '2026-01-01T00:00:00.000Z', kg: 70 }]);
  mem.config = JSON.stringify({ equipment: ['炒锅', '汤锅', '不粘锅'], maxSpicy: 3,
                                maxActiveMinutes: 45, maxIdleWait: 120,
                                allowOvernight: false, blacklist: [] });

  [['RoundsUI', '记录'], ['RecipesUI', '菜谱'], ['PantryUI', '库存'], ['SettingsUI', '我的']]
    .forEach(function (p) {
      var node = new El('div');
      try {
        ctx[p[0]].mount(node);
        ok(node.children.length > 0, p[1] + '页挂载后有内容');
      } catch (e) {
        ok(false, p[1] + '页挂载时抛异常:' + e.message);
        console.log('         ' + (e.stack || '').split('\n').slice(1, 3).join('\n         '));
      }
    });

  // 校准层必须真的合并进全局 RECIPES —— 漏了这一步是「显示改了但求解器没改」
  ok(Array.isArray(ctx.RECIPES) && ctx.RECIPES.length > 500,
     'RecipeBook.init() 之后 RECIPES 还在(' + (ctx.RECIPES || []).length + ' 条)');
}

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
