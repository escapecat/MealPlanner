// 备份 —— **这是唯一一个丢了就找不回来的东西。**
//
// ⚠️ 导出一直有,导入 `Store.importAll` 也一直有,**就是界面上没接**。
//    而旁边就摆着「清空重来」:能删不能恢复,这是最危险的组合。
//    换手机、清缓存、误点清空,任何一个都能让几个月的记录消失。
//
// ⚠️ 导入是这个 app 里唯一**不可撤销**的写操作,所以规矩是:
//    **先全验完,再一次性写**。边验边写的话,验到一半抛异常你的数据
//    就是半新半旧的 —— 那比彻底失败还糟,因为你不知道坏在哪儿。

var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');

var mem = {};
global.localStorage = {
  getItem: function (k) { return mem[k] === undefined ? null : mem[k]; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; },
  key: function (i) { return Object.keys(mem)[i] || null; },
  get length() { return Object.keys(mem).length; },
};
var Store = require(path.join(APP, 'lib/store.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

// ---- 1. 坏输入一个都不许放过 ----
[
  [null,                              '不是对象'],
  [{},                                '空对象'],
  [{ version: 1 },                    '缺 data'],
  [{ data: {} },                      '缺 version'],
  [{ version: 99, data: {} },         '版本比我新'],
  [{ version: 1, data: { rounds: 'x' } },      'rounds 不是数组'],
  [{ version: 1, data: { pantryItems: {} } },  'pantryItems 不是数组'],
].forEach(function (t) {
  var r = Store.inspectImport(t[0]);
  ok(!r.ok, '这份坏备份被放过了(' + t[1] + ')');
});

// ---- 2. 正常的要能过,而且要说清楚里面有什么 ----
var good = { version: 1, exportedAt: '2026-08-09T00:00:00.000Z',
             data: { rounds: [1, 2, 3], pantryItems: [1], staples: [], wasteLog: [1, 2] } };
var g = Store.inspectImport(good);
ok(g.ok, '正常的备份被拒了:' + g.why);
ok(g.summary && g.summary.rounds === 3 && g.summary.waste === 2,
   '摘要数不对 —— 覆盖前得让人看清要盖掉什么:' + JSON.stringify(g.summary));

// ---- 3. **验不过就一个字节都不许写** ----
// 这条是这个文件的核心。半新半旧的数据比彻底失败糟得多。
Store.set('rounds', ['原来的']);
Store.set('profile', { sex: 'male' });
var before = JSON.stringify(Store.exportAll().data);
try { Store.importAll({ version: 1, data: { rounds: 'x', profile: { sex: 'female' } } }); }
catch (e) { /* 意料之中 */ }
ok(JSON.stringify(Store.exportAll().data) === before,
   '导入失败之后数据被改动了 —— 必须全验完再写,不能边验边写');

// ---- 4. 导出 → 导入 一个来回不掉东西 ----
Store.set('rounds', [{ id: 'r1', status: 'done' }]);
Store.set('pantryItems', [{ id: 'p1', amount: 500 }]);
Store.set('wasteLog', [{ id: 'w1' }]);
var dump = JSON.parse(JSON.stringify(Store.exportAll()));   // 模拟写进文件再读回来
mem = {};                                                    // 换了台设备
Store.importAll(dump);
ok((Store.get('rounds', []) || []).length === 1, '来回一趟之后 rounds 没了');
ok((Store.get('pantryItems', []) || []).length === 1, '来回一趟之后 pantryItems 没了');
ok((Store.get('wasteLog', []) || []).length === 1, '来回一趟之后 wasteLog 没了');

// ---- 5. 界面上真的有那个按钮 ----
// ⚠️ 这条是给「写了没接上」准备的 —— 这个仓库里已经犯过至少五次:
//    target 没传、maxDifficulty 没设、carbCapKcal 算了没用、
//    scale 没存、seed 没传。核心写好了不等于用户点得到。
var fs = require('fs');
var ui = fs.readFileSync(path.join(APP, 'ui/settings.js'), 'utf8');
ok(/导入备份/.test(ui), '设置页里没有「导入备份」按钮 —— importAll 又是写了没接上');
ok(/inspectImport/.test(ui), '界面没调 inspectImport —— 覆盖前没验就是耍流氓');
ok(/type: 'file'/.test(ui), '没有文件选择器 —— 用户拿什么把备份喂进来');

console.log(fail ? '备份 ' + fail + ' 处不对'
                 : '  备份 ok(7 种坏输入拦住 · 失败不写 · 来回不掉东西 · 界面接上了)');
process.exit(fail ? 1 : 0);
