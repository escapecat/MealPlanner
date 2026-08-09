// 轮次 id 必须唯一 —— **不能靠时间保证**。
//
// ⚠️ 原来是 `r` + 日期 + 时分,注释写着「同一天多开一轮时加后缀」——
//    意图写了,实现没做到:那个「后缀」就是时分本身,不是计数器。
//    **同一分钟内建两轮,id 一模一样。**
//
// ⚠️ 后果比「重名难看」严重得多,因为代码里到处是
//    `findIndex(function (x) { return x.id === r.id; })`:
//      · 第二轮点「生成采购清单和菜」,结果**写进第一轮**把它覆盖掉;
//        第二轮自己永远停在 planning,点多少次都没反应
//      · seed = hashStr(r.id) + solveCount,同 id 就同种子,排出一模一样的菜
//      · 「做了」「删除这一轮」也都作用在第一条上
//    一个错都不报 —— 你只会觉得「这个按钮点了没用」。
//
// ⚠️ 这是写测试的时候撞出来的:两轮在同一分钟内建起来,第二轮怎么点都不动。
//    一个人手动操作确实很难在同一分钟连开两轮,但「周中一轮 + 周末一轮」
//    是这个 app 预期的用法,而失败方式是静默的。

var path = require('path');
var A = path.join(__dirname, '..', '..', 'app');
global.Store = { get: function (k, d) { return d; }, set: function () {} };
var Round = require(path.join(A, 'core', 'round.js'));

var fail = 0;
function ok(c, m) { if (!c) { console.log('  FAIL ' + m); fail++; } }

var NOW = '2026-08-09T09:49:12.345Z';
var CFG = { equipment: [], maxSpicy: 1, maxActiveMinutes: 45, blacklist: [] };
var IN = { days: 2, perDay: 2, diners: 1 };

// 同一分钟连建三轮 —— 三个 id 必须互不相同
var rs = [];
for (var i = 0; i < 3; i++) rs.push(Round.create(IN, CFG, NOW, rs));
var ids = rs.map(function (r) { return r.id; });
ok(new Set(ids).size === 3, '同一分钟建三轮,id 撞了:' + ids.join(' '));

// 第一条仍是干净的老格式 —— 已有数据的 id 不许因为这个改动变样
ok(/^r\d{8}-\d{4}$/.test(ids[0]), '第一条 id 的格式变了:' + ids[0]);

// 可排序、可复现:同样的输入序列给同样的 id(不许掺随机数)
var rs2 = [];
for (var j = 0; j < 3; j++) rs2.push(Round.create(IN, CFG, NOW, rs2));
ok(rs2.map(function (r) { return r.id; }).join() === ids.join(),
   'id 不可复现 —— 里面掺了随机数,以后没法按 id 排序/对账');

// 不同分钟本来就不会撞
var later = Round.create(IN, CFG, '2026-08-09T09:50:00.000Z', rs);
ok(ids.indexOf(later.id) < 0, '换了一分钟还撞:' + later.id);

// 不传 existing 时退回老行为(别的调用点没跟上也不该炸)
ok(/^r\d{8}-\d{4}$/.test(Round.create(IN, CFG, NOW).id), '不传现有轮次就炸了');

console.log(fail ? '轮次 id ' + fail + ' 处不对'
                 : '  轮次 id ok(同一分钟建三轮不撞 · 格式没变 · 不掺随机数)');
process.exit(fail ? 1 : 0);
