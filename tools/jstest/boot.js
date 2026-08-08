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

  // ⚠️ **光测「挂载后有内容」是不够的。**
  //    上一版只测到这里,结果菜谱页点开分组照样白屏 —— 因为渲染列表用的
  //    dishRow / renderSearch 也在同一次改动里被弄丢了,而首屏根本不调它们。
  //    首屏画得出来 ≠ 能用。每个页面至少要走一条**真实交互路径**。
  function clickable(root, label) {
    return root.all().filter(function (c) {
      return (c.handlers.click || []).length && txt(c).indexOf(label) >= 0;
    })[0] || null;
  }
  function txt(n) {
    return (n.text || '') + n.all().map(function (c) { return c.text || ''; }).join('');
  }
  function fire(n) { n.handlers.click.forEach(function (f) { f({ target: n }); }); }

  (function () {
    var node = new El('div');
    ctx.RecipesUI.mount(node);
    var g = clickable(node, '家常基础');
    ok(!!g, '菜谱页:找得到「家常基础」分组');
    if (!g) return;
    try {
      fire(g);
      var rows = node.all().filter(function (c) {
        return (c.handlers.click || []).length && txt(c).indexOf('▾') >= 0;
      });
      ok(rows.length > 1, '展开分组后列出了 ' + (rows.length - 1) + ' 道菜');
      fire(rows[1]);
      ok(node.all().length > 0, '点开一道菜没有崩(展开详情)');
    } catch (e) {
      ok(false, '菜谱页交互抛异常:' + e.message);
      console.log('         ' + (e.stack || '').split(String.fromCharCode(10))[1]);
    }
  })();

  (function () {
    var node = new El('div');
    ctx.RecipesUI.mount(node);
    try {
      var inp = node.querySelector('#rec-q');
      ok(!!inp, '菜谱页:搜索框在');
      if (inp) {
        inp.value = '红烧肉';
        inp.handlers.input[0]({ target: inp });
        ok(node.all().length > 0, '搜索「红烧肉」没有崩');
      }
    } catch (e) {
      ok(false, '搜索抛异常:' + e.message);
      console.log('         ' + (e.stack || '').split(String.fromCharCode(10))[1]);
    }
  })();

  // 菜谱页的「排除的 · 看原因」是另一条渲染路径,首屏不走它
  (function () {
    var node = new El('div');
    ctx.RecipesUI.mount(node);
    try {
      var b = clickable(node, '排除的');
      ok(!!b, '菜谱页:找得到「排除的 · 看原因」');
      if (b) {
        fire(b);
        var t = txt(node);
        ok(t.indexOf('厨具不够') >= 0 || t.indexOf('难度') >= 0,
           '切到「排除的」列出了原因分组');
        var grp = clickable(node, '厨具不够');
        if (grp) {
          fire(grp);
          ok(txt(node).length > 0, '展开一个原因分组没有崩');
          // ⚠️ 排除页的菜也要能点开看详情 —— 光看见「难度 5,超过 3」
          //    却点不进去是死胡同。这条路径第一版没有。
          var rows = node.all().filter(function (c) {
            return (c.handlers.click || []).length && txt(c).indexOf('做不了') >= 0;
          });
          ok(rows.length > 0, '排除页里的菜是可点的(' + rows.length + ' 行)');
          if (rows.length) {
            fire(rows[0]);
            ok(txt(node).indexOf('搜做法') >= 0 || txt(node).indexOf('按我的情况改') >= 0,
               '点开之后能看到详情和「按我的情况改」');
          }
        }
      }
    } catch (e) {
      ok(false, '「排除的」视图抛异常:' + e.message);
      console.log('         ' + (e.stack || '').split(String.fromCharCode(10))[1]);
    }
  })();

  (function () {
    var node = new El('div');
    ctx.PantryUI.mount(node);
    try {
      var t = clickable(node, '调料柜');
      if (t) fire(t);
      ok(true, '库存页:切到调料柜没有崩');
    } catch (e) {
      ok(false, '库存页切标签抛异常:' + e.message);
    }
  })();

  (function () {
    var node = new El('div');
    ctx.SettingsUI.mount(node);
    try {
      var sec = clickable(node, '厨房与口味');
      ok(!!sec, '我的页:找得到「厨房与口味」');
      if (sec) { fire(sec); ok(node.all().length > 0, '展开设置分区没有崩'); }
    } catch (e) {
      ok(false, '设置页展开分区抛异常:' + e.message);
      console.log('         ' + (e.stack || '').split(String.fromCharCode(10))[1]);
    }
  })();

  // 校准层必须真的合并进全局 RECIPES —— 漏了这一步是「显示改了但求解器没改」
  ok(Array.isArray(ctx.RECIPES) && ctx.RECIPES.length > 500,
     'RecipeBook.init() 之后 RECIPES 还在(' + (ctx.RECIPES || []).length + ' 条)');
}

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
