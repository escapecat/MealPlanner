// 页面渲染出来到底长什么样 —— **看得见才改得动。**
//
// 之前改 UX 全靠读代码猜界面,结果只能改到「间距对不对齐」这种能算出来的东西,
// 看不见「这一屏信息挤在一起」「主操作埋在第三屏」这类真问题。
//
// 复用 boot.js 那套最小 DOM 桩(项目零依赖,不能引 jsdom),
// 把渲染结果打成缩进树,顺便标出每个节点是不是可点、文字有多长。
//
// 用法:node tools/view.js [页面]    页面 = rounds | pantry | recipes | settings | recipe-detail

var fs = require('fs');
var path = require('path');
var vm = require('vm');
var ROOT = path.join(__dirname, '..');
var APP = path.join(ROOT, 'app');

function El(tag) {
  this.tagName = String(tag).toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.text = '';
  this.parentNode = null;
}
Object.defineProperty(El.prototype, 'innerHTML', {
  get: function () { return ''; }, set: function () { this.children = []; },
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
  var want = sel.replace(/^#/, ''), byId = sel[0] === '#';
  return this.all().filter(function (c) {
    return byId ? c.attrs.id === want : c.tagName === sel.toUpperCase();
  })[0] || null;
};

var mem = {};
var body = new El('body');
var appDiv = new El('div'); appDiv.attrs.id = 'app'; body.appendChild(appDiv);
var doc = {
  body: body, documentElement: new El('html'), activeElement: null,
  createElement: function (t) { return new El(t); },
  createTextNode: function (t) { var n = new El('#text'); n.text = t; return n; },
  createDocumentFragment: function () { return new El('#frag'); },
  getElementById: function (id) { return id === 'app' ? appDiv : null; },
  querySelector: function (s) { return body.querySelector(s); },
  addEventListener: function () {}, removeEventListener: function () {},
};
var sandbox = {
  document: doc, console: console, setTimeout: setTimeout, clearTimeout: clearTimeout,
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

// 一份真实配置 —— 空状态看不出布局问题。
// ⚠️ 键必须带 Store 的命名空间前缀(store.js: NS = 'mealplanner:')。
//    少了它,app 读到的是空配置,求解直接 no-candidates ——
//    而失败提示走 Modal 挂在 body 上,#app 里什么都看不到,
//    表现成「点了没反应」。查了三轮才发现是工具自己的锅。
var NS = 'mealplanner:';
mem[NS + 'profile'] = JSON.stringify({ sex: 'male', age: 30, heightCm: 175, activity: 'light',
                               goal: 'cut', breakfast: 'light' });
mem[NS + 'weightLog'] = JSON.stringify([{ date: '2026-01-01T00:00:00.000Z', kg: 70 }]);
mem[NS + 'config'] = JSON.stringify({ equipment: ['炒锅', '空气炸锅', '电饭煲'], maxSpicy: 1,
                              maxActiveMinutes: 45, maxDifficulty: 3, maxIdleWait: 60,
                              allowOvernight: false,
                              blacklist: ['bitter_melon', 'okra', 'zucchini'] });
mem[NS + 'staples'] = JSON.stringify(['salt', 'cooking_oil', 'light_soy_sauce', 'rice', 'brown_rice']
                             .map(function (id) { return { id: id }; }));
mem[NS + 'staplesMigrated'] = 'true';
mem[NS + 'staplesConfirmed'] = 'true';

var ctx = vm.createContext(sandbox);
var html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
var srcs = [];
html.replace(/src="([^"]+\.js)"/g, function (_, s) { srcs.push(s); return _; });
srcs.forEach(function (s) {
  vm.runInContext(fs.readFileSync(path.join(APP, s), 'utf8'), ctx, { filename: s });
});

// ---- 把渲染树打出来 ----
var BOX = { card: '▣', note: '▤', btn: '▶', chips: '◇', tag: '·', seg: '▭' };

function label(el) {
  var cls = (el.className || el.attrs.class || '').trim();
  var mark = '';
  Object.keys(BOX).forEach(function (k) {
    if (!mark && cls.split(/\s+/).indexOf(k) >= 0) mark = BOX[k];
  });
  if (!mark && el.tagName === 'BUTTON') mark = '▶';
  var tappable = (el.handlers.click && el.handlers.click.length) || el.tagName === 'BUTTON';
  var t = (el.text || '').replace(/\s+/g, ' ').trim();
  var out = (mark || ' ') + ' ' + el.tagName.toLowerCase() + (cls ? '.' + cls.replace(/\s+/g, '.') : '');
  if (tappable) out += '  [可点]';
  if (t) out += '   「' + (t.length > 46 ? t.slice(0, 46) + '…' : t) + '」';
  return out;
}

var stats = { nodes: 0, tappable: 0, text: 0, chars: 0, depth: 0 };
function walk(el, d, lines) {
  if (el.tagName === '#TEXT') {
    var t = (el.text || '').replace(/\s+/g, ' ').trim();
    if (t) {
      stats.text++; stats.chars += t.length;
      lines.push('  '.repeat(d) + '  ' + (t.length > 54 ? t.slice(0, 54) + '…' : t));
    }
    return;
  }
  stats.nodes++;
  stats.depth = Math.max(stats.depth, d);
  if ((el.handlers.click && el.handlers.click.length) || el.tagName === 'BUTTON') stats.tappable++;
  lines.push('  '.repeat(d) + label(el));
  el.children.forEach(function (c) { walk(c, d + 1, lines); });
}

var page = process.argv[2] || 'rounds';
if (page === 'recipes') {
  mem[NS + 'tab'] = 'recipes';
  RECIPES_OPEN = (process.argv[3] || '') === 'open';   // recipes-open
}
var RECIPES_OPEN = false;
if (page === 'pantry') {
  mem[NS + 'tab'] = 'pantry';
  // 空状态看不出布局问题 —— 塞几样真库存进去
  mem[NS + 'pantryItems'] = JSON.stringify([
    { id: 'p1', ingredientId: 'chicken_breast', amount: 500, unit: 'g',
      addedAt: '2026-08-06T00:00:00.000Z', source: 'manual' },
    { id: 'p2', ingredientId: 'spinach', amount: 300, unit: 'g',
      addedAt: '2026-08-07T00:00:00.000Z', source: 'manual' },
    { id: 'p3', ingredientId: 'egg', amount: 500, unit: 'g',
      addedAt: '2026-08-01T00:00:00.000Z', source: 'manual' },
  ]);
}
if (page === 'settings') { mem[NS + 'tab'] = 'settings'; }

// 排一轮出来,不然计划页是空的 —— 空状态看不出真实密度
if (page === 'rounds') {
  mem[NS + 'tab'] = 'rounds';
  
  // ⚠️ 走**真实交互路径**:挂载 → 点「＋ 这次要做饭了」→ 点 sheet 里的确认。
  //    手工造 round 对象会漏字段,看到的就不是真界面 —— 而这个工具的全部意义
  //    就是「看到真的那一屏」。
  vm.runInContext('RoundsUI.mount(document.getElementById("app"))', ctx);
  // ⚠️ 按钮文字挂在**子文本节点**上,不在元素自己的 .text ——
  //    直接测 el.text 会一个都匹配不到,而且**静悄悄地匹配不到**(没有报错),
  //    看起来就像「点了没反应」。得取整棵子树的文字。
  function deepText(el) {
    if (el.tagName === '#TEXT') return el.text || '';
    return (el.text || '') + el.children.map(deepText).join('');
  }
  function clickByText(re) {
    var hit = appDiv.all().filter(function (el) {
      return el.handlers.click && el.handlers.click.length && re.test(deepText(el));
    })[0];
    if (!hit) { console.log('(点不到:' + re + ')'); return false; }
    try {
      hit.handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
    } catch (e) {
      console.log('(点「' + re + '」时抛异常:' + e.message + ')');
      console.log('   ' + (e.stack || '').split(String.fromCharCode(10))[1]);
    }
    return true;
  }
  if (!clickByText(/这次要做饭/)) console.log('(没找到「这次要做饭了」按钮)');
  clickByText(/记下这一次/);
  clickByText(/生成采购清单/);
  // 第二个参数 = 走到哪个阶段:shop(默认,待采购)| cook(已开做)
  var stage = process.argv[3] || '';
  if (stage === 'cook' || stage === 'done') clickByText(/买齐了|开始做饭/);
  if (stage === 'done') {
    // 把每道菜都点「做了」,再结束这一轮 —— 看看走到底是什么样
    for (var q = 0; q < 6; q++) clickByText(/^做了$/);
    // Modal.confirm 是 Promise,桩里没法自动确认 —— 直接改状态,
    // 反正要看的是「结束之后长什么样」
    vm.runInContext('(function(){var rs=Store.get("rounds",[]);rs[0].status="done";' +
                    'rs[0].finishedAt=new Date().toISOString();Store.set("rounds",rs);})()', ctx);
  }
  if (stage === 'hist') {
    // 结束之后,把那条历史点开 —— 看看里面是回执还是工作台
    vm.runInContext('(function(){var rs=Store.get("rounds",[]);rs[0].status="done";' +
                    'Store.set("rounds",rs);})()', ctx);
    appDiv.children = [];
    vm.runInContext('RoundsUI.mount(document.getElementById("app"))', ctx);
    clickByText(/月.*日/);
  }
  if (stage === 'many') {
    // 攒了 8 轮之后这一页有多长 —— 每周一轮的话两个月就到这儿
    vm.runInContext('(function(){var rs=Store.get("rounds",[]);var one=rs[0];' +
                    'var out=[];for(var i=0;i<8;i++){var c=JSON.parse(JSON.stringify(one));' +
                    'c.id="r"+i;c.status="done";out.push(c);}Store.set("rounds",out);})()', ctx);
  }
  // ⚠️ 失败提示走 Modal,而 Modal 挂在 document.body 上不在 #app 里 ——
  //    只看 #app 的话,「排不出来」表现成「点了没反应」,查半天。
  body.children.forEach(function (c) {
    if ((c.className || '').indexOf('modal') < 0) return;
    var t = deepText(c).replace(/\s+/g, ' ').trim();
    if (t) console.log('【弹层】' + t.slice(0, 160));
  });
  if (false) {
    var btns = appDiv.all().filter(function (el) {
      return el.tagName === 'BUTTON' && (el.className || '').indexOf('btn') >= 0;
    });
    var last = btns[btns.length - 1];
    if (last && last.handlers.click) last.handlers.click[0]({ preventDefault: function () {} });
  }
}

appDiv.children = [];
var MOUNT = { rounds: 'RoundsUI', pantry: 'PantryUI', recipes: 'RecipesUI', settings: 'SettingsUI' };
var mod = MOUNT[page] || 'Rounds';
try {
  vm.runInContext(mod + '.mount(document.getElementById("app"))', ctx);
} catch (e) {
  console.log('挂载 ' + mod + ' 失败:' + e.message);
  console.log((e.stack || '').split('\n').slice(0, 3).join('\n'));
  process.exit(1);
}

var lines = [];
appDiv.children.forEach(function (c) { walk(c, 0, lines); });
console.log('════ ' + page + ' ════');
console.log(lines.join('\n'));
console.log('\n节点 ' + stats.nodes + ' · 可点 ' + stats.tappable +
            ' · 文字块 ' + stats.text + ' · 总字数 ' + stats.chars +
            ' · 最深嵌套 ' + stats.depth);
