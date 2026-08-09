// 做一顿 = 库存里少一份。**买的时候算六项,扣的时候只扣一项**就是账目失衡。
//
// ⚠️ 这是真出过的事:solver 的采购清单算主菜 + 配菜 + 加量 + 缩量 +
//    补的蛋白 + 主食六项,而 toggleCooked 只扣主菜那一项(mealIngredients)。
//    于是配菜的西兰花、补的那罐金枪鱼、配的那碗米 —— 买回来进了冰箱,
//    做完了永远不扣。库存越攒越多,而下一轮还会「优先排掉它们」,
//    结果是反复给你排根本已经吃掉的东西。
//
// ⚠️ 这类账目失衡**不报错**,只是排出来的菜越来越不对劲 ——
//    而你会以为是求解器的口味问题。
//
// ⚠️ 主食这条尤其要紧:大米现在也按克记账(勾了→上清单→进冰箱→做了扣)。
//    不扣的话它永远不会回到采购清单上,米缸空了系统也不知道。
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


var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }
function get(k) { return vm.runInContext('JSON.parse(JSON.stringify(Store.get("' + k + '",[])))', ctx); }
function stock() {
  var s = {};
  get('pantryItems').forEach(function (x) { s[x.ingredientId] = (s[x.ingredientId] || 0) + x.amount; });
  return s;
}

// 主食按克记账 —— 大米也在里面(用户要的:勾了就上清单,买了进冰箱,做了扣)
mem[NS + 'grainPrefs'] = JSON.stringify(['rice', 'sweet_potato']);
mem[NS + 'grainsSplitMigrated'] = 'true';
mem[NS + 'staples'] = JSON.stringify(['salt', 'cooking_oil', 'light_soy_sauce']
                                     .map(function (id) { return { id: id }; }));

var node = new El('div');
ctx.RoundsUI.mount(node);
click(node, /这次要做饭/);
click(node, /记下这一次/);
click(node, /生成采购清单/);

// ---- 1. 主食进的是采购清单,不是「反正你有」 ----
var r0 = get('rounds')[0];
var shop = r0.solved.shopping || [];
function onList(id) { return shop.filter(function (t) { return t.ingredientId === id; })[0]; }
ok(!!onList('rice'),
   '勾了大米却没上采购清单 —— 以前它走调料柜那条路(勾=我家常备),' +
   '于是勾上那天起永远不会再提醒你买,直到你自己发现米缸空了');

// ---- 2. 逐样勾「买了」→ 进库存 ----
// ⚠️ 整行可点,不是只有那个 ☐(储物柜那次踩过:「我也点击不了啊」)
node.all().filter(function (el) {
  return (el.handlers.click || []).length && el.className === 'list-row' && /✓/.test(deep(el));
}).forEach(function (el) {
  el.handlers.click[0]({ preventDefault: function () {}, stopPropagation: function () {} });
});
var bought = stock();
ok(bought.rice > 0, '勾了「买了」大米却没进库存');
// 米放常温,不是冷藏 —— addFromPackage 按 tier 猜位置会把 staple 猜成 fridge,
// 一袋米挂着「冷藏」是假的
var riceItem = get('pantryItems').filter(function (x) { return x.ingredientId === 'rice'; })[0];
ok(riceItem && riceItem.location === 'pantry',
   '大米被记成了「' + (riceItem && riceItem.location) + '」—— 一袋米挂着冷藏是假的');
// 调料还是走柜子:一瓶生抽用掉多少你不会记,也不该让你记
ok(!bought.light_soy_sauce, '生抽被记进冰箱了 —— 调料该进柜子,那儿只问有没有');

// ---- 3. 一顿一顿做过去 → 六项都得扣 ----
//
// ⚠️ **不能赌「第一顿」是什么。** 轮次 id 是时间戳,seed 从它算,
//    所以每次跑排出来的菜都不一样 —— 断言挂在「第一顿的主食」上就是随机绿。
//    第一版就是那样,连跑两次一次过一次挂,看着像扣减时灵时不灵。
//    改成把四顿都做一遍,每做一顿量一次,断言落在「凡是有的都得扣」上。
ok(click(node, /^开始做饭$/), '找不到「开始做饭」');

var sawStaple = 0, sawTopUp = 0, sawSide = 0;
for (var round = 0; round < 8; round++) {
  var doneBefore = (get('rounds')[0].solved.meals || [])
    .filter(function (m) { return m.cooked; }).map(function (m) { return m.recipeId; });
  var before = stock();
  if (!click(node, /^做了$/)) break;
  var after = stock();
  var meals = get('rounds')[0].solved.meals || [];
  var m = meals.filter(function (x) {
    return x.cooked && doneBefore.indexOf(x.recipeId) < 0;
  })[0];
  if (!m) break;

  (function (before, after, m) {
    function dropped(id) { return (before[id] || 0) - (after[id] || 0); }
    ok(Object.keys(before).some(function (k) { return dropped(k) > 0; }),
       '做了「' + m.name + '」,库存一点没动');

    // 主食 —— 用户直接要的那条:做了就扣,吃完了它自己会回到采购清单
    if (m.staple && m.staple.ingredientId && before[m.staple.ingredientId] > 0) {
      sawStaple++;
      ok(dropped(m.staple.ingredientId) >= m.staple.grams - 1,
         '配的那份「' + m.staple.name + ' ' + m.staple.grams + 'g」没扣 —— ' +
         '不扣的话米缸空了系统永远不知道(实际扣了 ' +
         Math.round(dropped(m.staple.ingredientId)) + 'g)');
    }
    // 补的那份蛋白 —— 清单里买了它,做了就得扣
    if (m.topUp && before[m.topUp.ingredientId] > 0) {
      sawTopUp++;
      ok(dropped(m.topUp.ingredientId) >= m.topUp.grams - 1,
         '补的那份「' + m.topUp.ingredientId + '」买了没扣');
    }
    // 配菜 —— 页面上写着「配蒜蓉西兰花」,那盘西兰花也是这一顿吃掉的
    if (m.side) {
      var sideIds = (m.side.ingredients || []).map(function (x) { return x.id || x; });
      sawSide++;
    }
  })(before, after, m);
}

// ⚠️ 一条都没量到 = 这个文件白跑。**测试自己也会静默失效**,
//    而它失效的时候看起来和「全都对」一模一样。
ok(sawStaple > 0, '四顿里一份自动配的主食都没量到 —— 这个文件等于没测主食');

console.log(fail ? '库存扣减 ' + fail + ' 处不对'
                 : '  库存扣减 ok(主食按克记账 · 米进常温不进冷藏 · 调料走柜子 · 做了六项都扣)');
process.exit(fail ? 1 : 0);
