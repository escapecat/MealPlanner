// 拼音搜索。
//
// 值得单独测,因为「搜不到」在界面上和「库里没有」长得一模一样 ——
// 而这一页最重要的职责就是回答「收录了没有」。匹配器悄悄漏一种打法,
// 用户得到的结论是「这道菜没收录」,而不是「搜索坏了」。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');

global.PINYIN = require(path.join(A, 'data', 'pinyin.js'));
var Pinyin = require(path.join(A, 'core', 'pinyin.js'));
var RECIPES = require(path.join(A, 'data', 'recipes.js'));
var dishes = RECIPES.filter(function (r) { return r.type !== 'prep'; });

var fails = 0;
function ok(cond, msg) {
  console.log((cond ? '  ok   ' : '  FAIL ') + msg);
  if (!cond) fails++;
}
function hits(q) {
  return dishes.filter(function (r) { return Pinyin.match(r.name, q); });
}
function has(q, name) {
  return hits(q).some(function (r) { return r.name === name; });
}

// 四种打法都得认 —— 人不会只用一种
ok(has('hongshaorou', '红烧肉'), '全拼    hongshaorou → 红烧肉');
ok(has('hsr', '红烧肉'), '首字母  hsr → 红烧肉');
ok(has('hongsr', '红烧肉'), '混着打  hongsr → 红烧肉');
ok(has('hongsh', '红烧肉'), '打一半  hongsh → 红烧肉');
ok(has('xjszf', '新疆手抓饭'), '首字母  xjszf → 新疆手抓饭');
ok(has('gongbaojiding', '宫保鸡丁'), '全拼    gongbaojiding → 宫保鸡丁');

// 多音字:同一个字的两个读音都该能搜到。
// ⚠️ 用库里真有的菜来测。我第一版写的是「重庆辣子鸡」—— 库里根本没这道菜,
//    而拼音表只收数据里出现过的字,「庆」不在表里,于是测试挂了。
//    挂得对:表本来就不该收用不到的字(全量表 500KB+)。错的是测试。
ok(has('gali', '咖喱鸡胸饭'), '多音字  gali → 咖喱鸡胸饭(咖 = ka|ga|jia)');
ok(has('kali', '咖喱鸡胸饭'), '多音字  kali → 同一道也认另一个读音');
ok(has('ganbian', '干煸四季豆'), '多音字  ganbian → 干煸四季豆(干 = gan|an)');

// 名字里混了非汉字的不能崩(库里有韩文、日文、法文、括号)
ok(Pinyin.match('韩式蛋卷(계란말이)', 'hanshi'), '混排    hanshi → 韩式蛋卷(계란말이)');
var weird = dishes.filter(function (r) { return /[^一-鿿]/.test(r.name); });
var crashed = false;
try { weird.forEach(function (r) { Pinyin.match(r.name, 'abc'); }); }
catch (e) { crashed = true; }
ok(!crashed, '含非汉字的 ' + weird.length + ' 道菜名不会让匹配器崩');

// 不是拼音的查询不该走拼音分支(否则「红烧」会被当成字母乱匹)
ok(Pinyin.match('红烧肉', '红烧') === false, '汉字查询不走拼音分支(交给调用方做字面匹配)');
ok(Pinyin.looksPinyin('hsr') === true && Pinyin.looksPinyin('红烧') === false,
   'looksPinyin 分得清');

// ⚠️ 「zzz 命中 2 道」曾被我当成误伤,其实是对的:
//    西洋菜蜜枣猪展汤 的「枣猪展」三个字首字母正好都是 z。
//    连续同声母是真事,不该为了让测试好看去砍掉首字母匹配。
ok(has('zzz', '西洋菜蜜枣猪展汤'), 'zzz → 枣猪展(连续同声母是真的,不是误伤)');

// 全表跑一遍,确认没有性能塌方(界面上是每敲一个字母跑一次)
var t0 = Date.now();
['a', 'hongshaorou', 'zzz', 'xjszf', 'qwertyuiop'].forEach(function (q) { hits(q); });
var ms = Date.now() - t0;
ok(ms < 500, '512 道菜 × 5 个查询耗时 ' + ms + 'ms(输入框每敲一下都会跑)');

console.log(fails ? '\n' + fails + ' 条挂了' : '\n全过');
process.exit(fails ? 1 : 0);
