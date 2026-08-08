// 备注里不许出现建库笔记。
//
// ⚠️ 1149 条备注里混着两种完全不同的东西:
//     做法提示  「炒糖色到枣红立刻下肉,全程不加生水」
//     建库笔记  「牺牲:肥瘦比例由厂家定…单位成本约为自炖的 2 倍。
//                主表备注写的『只适合有空的周末』这条限制被解除」
//
//    第二种是建库时写给自己看的设计理由和数据加工说明,引用「本文件」「附录」
//    「主表」和反引号里的 id —— 全是内部产物。出现在做饭页面上,读起来就像
//    app 在跟你解释它自己的实现。
//
//    markdown 正本一个字不动,拆分在 build_data.py 里做:
//    note 只留做法提示,其余进 devNote(留在数据里,界面不显示)。

var path = require('path');
var RECIPES = require(path.join(__dirname, '..', '..', 'app', 'data', 'recipes.js'));

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}

var MARKERS = ['本文件', '附录', '主表', '牺牲', '换来的是', '单位成本',
               '原值', '这一档', '这一行', '障碍是'];

var shown = [], dev = 0, leaked = [];
RECIPES.forEach(function (r) {
  var all = [{ w: r.id, n: r.note, d: r.devNote }];
  (r.variants || []).forEach(function (v) {
    all.push({ w: r.id + '/' + v.prepLevel, n: v.note, d: v.devNote });
  });
  all.forEach(function (x) {
    if (x.d) dev++;
    if (!x.n) return;
    shown.push(x.n);
    if (MARKERS.some(function (m) { return x.n.indexOf(m) >= 0; }) || x.n.indexOf('⚠️') >= 0) {
      leaked.push(x.w + ': ' + x.n.slice(0, 40));
    }
  });
});

ok(leaked.length === 0,
   '显示出去的 ' + shown.length + ' 条备注里没有建库笔记' +
   (leaked.length ? '\n         漏了:' + leaked.slice(0, 3).join('\n         ') : ''));
ok(dev > 0, '建库笔记没被删掉,进了 devNote(' + dev + ' 条)');

// 反引号里的 id 是内部产物,不该出现在做饭提示里
var backtick = shown.filter(function (n) { return n.indexOf('`') >= 0; });
ok(backtick.length === 0,
   '做法提示里没有反引号包的食材 id' +
   (backtick.length ? '(漏了 ' + backtick.length + ' 条:' + backtick[0].slice(0, 40) + ')' : ''));

// 长度。
// ⚠️ 这里**不追求全部压到一行**。剩下的几条长备注里是真做菜建议
//    (「钠高得多,用它做 risotto 要减盐」「烤焦洋葱这一步留着,省了它就不是 phở」),
//    按字数一刀切会把它们连同编辑口吻一起删掉。
//    分类只负责踢掉建库笔记;长度交给界面折叠(菜卡上先显示一行,点开看全)。
var tooLong = shown.filter(function (n) { return n.length > 120; });
ok(tooLong.length === 0,
   '没有超过 120 字的做法提示' +
   (tooLong.length ? '(还有 ' + tooLong.length + ' 条,最长 ' +
    Math.max.apply(null, tooLong.map(function (n) { return n.length; })) + ' 字)' : ''));
var longish = shown.filter(function (n) { return n.length > 60; });
console.log('       超过 60 字、界面要折叠的:' + longish.length + ' 条');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
