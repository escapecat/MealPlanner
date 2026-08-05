// Modal 冒烟测试 —— 用最小 DOM 桩,不引 jsdom(这个项目零依赖,要保持双击能跑)。
//
// 值得测,是因为这几个弹层现在挡在所有破坏性操作前面:
// 清空重来、删除轮次、记一笔浪费。confirm 要是永远 resolve(true),
// 用户点「取消」就会把数据删掉,而且不报错。

var path = require('path');

// ---- 最小 DOM 桩 ----
function El(tag) {
  this.tagName = tag.toUpperCase();
  this.children = []; this.attrs = {}; this.handlers = {};
  this.className = ''; this.style = {}; this.value = ''; this.textContent = '';
  this.parentNode = null;
}
El.prototype.appendChild = function (c) { c.parentNode = this; this.children.push(c); return c; };
El.prototype.removeChild = function (c) {
  this.children = this.children.filter(function (x) { return x !== c; }); c.parentNode = null;
};
El.prototype.setAttribute = function (k, v) { this.attrs[k] = v; };
El.prototype.addEventListener = function (k, fn) { (this.handlers[k] = this.handlers[k] || []).push(fn); };
El.prototype.focus = function () {}; El.prototype.select = function () {};
El.prototype.all = function (out) {
  out = out || [];
  this.children.forEach(function (c) { out.push(c); c.all(out); });
  return out;
};
El.prototype.querySelector = function (sel) {
  return this.all().filter(function (c) { return c.tagName === sel.toUpperCase(); })[0] || null;
};
/** 按可见文字找按钮并点它 —— 测试要模拟的是用户点了哪个字。
 *  文字可能埋在按钮的子孙节点里(选项按钮是 label + hint 两层),所以查整棵子树。 */
El.prototype.text_ = function () {
  return (this.text || '') + this.all().map(function (n) { return n.text || ''; }).join('');
};
El.prototype.click = function (label) {
  var hit = this.all().filter(function (c) {
    return (c.handlers.click || []).length && c.text_().indexOf(label) >= 0;
  })[0];
  if (!hit) throw new Error('找不到按钮:' + label);
  hit.handlers.click.forEach(function (f) { f({ target: hit }); });
};

var body = new El('body');
global.document = {
  createElement: function (t) { return new El(t); },
  createTextNode: function (t) { var n = new El('#text'); n.text = t; n.textContent = t; return n; },
  body: body,
  addEventListener: function () {}, removeEventListener: function () {},
};

var Modal = require(path.join(__dirname, '..', '..', 'app', 'ui', 'modal.js'));

var fails = 0, pending = [];
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}
function sheet() { return body.children[body.children.length - 1]; }

// --- confirm:点「取消」必须是 false ---
pending.push(
  (function () {
    var p = Modal.confirm({ title: '清空所有数据?', ok: '我确定,清空' });
    sheet().click('取消');
    return p.then(function (v) { ok(v === false, 'confirm 点「取消」→ false(不会误删)'); });
  })()
);

// --- confirm:点确定是 true ---
pending.push(
  (function () {
    var p = Modal.confirm({ title: '删掉这一轮?', ok: '删掉' });
    sheet().click('删掉');
    return p.then(function (v) { ok(v === true, 'confirm 点「删掉」→ true'); });
  })()
);

// --- pick:返回选中的 key,不是数字 ---
pending.push(
  (function () {
    var p = Modal.pick({
      title: '食盐',
      options: [{ key: 'bought', label: '改买入时间' }, { key: 'used', label: '用完了' }],
    });
    sheet().click('用完了');
    return p.then(function (v) { ok(v === 'used', 'pick 返回 key「used」(以前是让人输数字)'); });
  })()
);

// --- pick:取消返回 null ---
pending.push(
  (function () {
    var p = Modal.pick({ title: 'x', options: [{ key: 'a', label: 'A' }] });
    sheet().click('取消');
    return p.then(function (v) { ok(v === null, 'pick 取消 → null'); });
  })()
);

// --- ask:拿到输入值 ---
pending.push(
  (function () {
    var p = Modal.ask({ title: '扔了多少?', type: 'number', value: 300, ok: '记一笔浪费' });
    var s = sheet();
    s.querySelector('input').value = '120';
    s.click('记一笔浪费');
    return p.then(function (v) { ok(v === '120', 'ask 拿到输入值'); });
  })()
);

// --- ask:空值不提交(且不弹二次警告) ---
pending.push(
  (function () {
    var p = Modal.ask({ title: '多少?', type: 'number', value: '', ok: '记下' });
    var s = sheet();
    s.querySelector('input').value = '';
    s.click('记下');                      // 应该没反应
    s.click('取消');
    return p.then(function (v) { ok(v === null, 'ask 空值不提交,只有取消能关'); });
  })()
);

// --- ask allowEmpty:「不记得了」返回 '' 而不是 null ---
//     这个区分是有意义的:'' = 「确实不知道买入时间」,null = 「我没改」。
pending.push(
  (function () {
    var p = Modal.ask({ title: '什么时候买的?', type: 'date', value: '2026-01-01',
                        allowEmpty: true, emptyLabel: '不记得了' });
    sheet().click('不记得了');
    return p.then(function (v) {
      ok(v === '', 'allowEmpty 时「不记得了」→ 空串(区别于取消的 null)');
    });
  })()
);

Promise.all(pending).then(function () {
  console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
  process.exit(fails ? 1 : 0);
});
