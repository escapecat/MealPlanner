// 间距网格 —— 这条测的是**一致性**,不是「有没有坏」。
//
// ⚠️ 改版前 6 个 ui 文件 ~150 处内联 margin/padding,用了 17 种值:
//       1 2 3 4 5 6 7 8 9 10 11 12 14 16 26px
//    「有的间隔有问题」不是某一处坏了,是根本没有系统:同样是
//    「标题和正文之间」,这儿 6px 那儿 8px 再那儿 10px。
//    眼睛看得出来,但说不上哪儿不对 —— 最难查的一类不一致。
//
// ⚠️ 这种退化**不会报错也不会白屏**,只会在下一个人抄旁边代码时慢慢渗回来:
//    随手写个 margin-top:10px,看着没问题,网格就破了一个口子。
//    所以得有一条测试盯着,而不是靠记性。
//
// 新代码要留间距:优先用 .mt-2 / .mb-3 这类工具类(style.css 末尾),
// 非要内联就只能用 4 的倍数。

var fs = require('fs');
var path = require('path');
var APP = path.join(__dirname, '..', '..', 'app');

var fail = 0;
function bad(msg) { console.log('  FAIL ' + msg); fail++; }

// ---- 1. 内联间距必须落在 4px 网格上 ----
var PROP = /(margin|padding|gap|row-gap|column-gap)(-top|-bottom|-left|-right)?:\s*((?:-?\d+px\s*)+)/g;
var files = fs.readdirSync(path.join(APP, 'ui'))
              .filter(function (f) { return /\.js$/.test(f); })
              .map(function (f) { return path.join('ui', f); })
              .concat(['app.js']);

var offGrid = [];
files.forEach(function (rel) {
  var src = fs.readFileSync(path.join(APP, rel), 'utf8');
  src.split('\n').forEach(function (line, i) {
    var m;
    PROP.lastIndex = 0;
    while ((m = PROP.exec(line)) !== null) {
      (m[3].match(/-?\d+px/g) || []).forEach(function (v) {
        var n = Math.abs(parseInt(v, 10));
        if (n % 4 !== 0) offGrid.push(rel + ':' + (i + 1) + '  ' + m[1] + (m[2] || '') + ': ' + v);
      });
    }
  });
});
if (offGrid.length) {
  bad('这些内联间距不在 4px 网格上(' + offGrid.length + ' 处):\n         ' +
      offGrid.slice(0, 8).join('\n         '));
}

// ---- 2. 档位不能太多 ----
// 网格对了但用了 4/8/12/16/20/24/28/32/36…… 一样是没有层级。
var used = {};
files.forEach(function (rel) {
  var src = fs.readFileSync(path.join(APP, rel), 'utf8');
  var m;
  PROP.lastIndex = 0;
  while ((m = PROP.exec(src)) !== null) {
    (m[3].match(/-?\d+px/g) || []).forEach(function (v) { used[Math.abs(parseInt(v, 10))] = 1; });
  }
});
var steps = Object.keys(used).map(Number).sort(function (a, b) { return a - b; });
if (steps.length > 7) {
  bad('内联间距用了 ' + steps.length + ' 档(' + steps.join('/') + ')—— 超过 7 档就没有层级了');
}

// ---- 3. 颜色只能走变量 ----
// DESIGN 第九节的老规矩,顺手一起守:深色模式全靠它。
var litColor = [];
files.forEach(function (rel) {
  var src = fs.readFileSync(path.join(APP, rel), 'utf8');
  src.split('\n').forEach(function (line, i) {
    if (/\/\//.test(line.split('#')[0] || '')) return;      // 注释里提到颜色不算
    (line.match(/#[0-9a-fA-F]{3,8}\b/g) || []).forEach(function (c) {
      litColor.push(rel + ':' + (i + 1) + '  ' + c);
    });
  });
});
if (litColor.length) {
  bad('组件里出现了字面色值,深色模式会翻车(' + litColor.length + ' 处):\n         ' +
      litColor.slice(0, 6).join('\n         '));
}

// ---- 4. style.css 里的**布局间距**也得引用令牌 ----
// ⚠️ 只查 margin/padding/gap。border-radius / box-shadow / 字号那些
//    有自己的令牌,混在一起查会逼出一堆假阳性。
//
// ⚠️ 门槛是 **≥4px**,小于 4px 的不算。
//    第一版一律要求走 var(--sN),结果把 .tag 的 padding:3px、.conf 的 1px、
//    弹层抓手的 margin:-8px 全标成违规 —— 那些是**光学微调**,不是布局间距:
//    标签的上下留白比左右紧一点才好看,这跟「卡片之间留几档」不是一回事。
//    硬把它们塞进 4px 网格,是让规则去凑规则,不是让界面变好。
//    真正要防的是「布局间距随手写个 10px」,那种一定 ≥4px。
var css = fs.readFileSync(path.join(APP, 'style.css'), 'utf8');
var cssBody = css.slice(css.indexOf('* { box-sizing'));
var hard = [];
cssBody.split('\n').forEach(function (line, i) {
  if (/^\s*\/\*/.test(line)) return;
  if (/calc\(/.test(line)) return;              // calc 里多是具体测量(标签栏高度)
  var m2 = /(?:^|[;{\s])(margin|padding|gap)(-top|-bottom|-left|-right)?:\s*([^;}]+)/.exec(line);
  if (!m2) return;
  (m2[3].match(/\b\d+px/g) || []).forEach(function (v) {
    if (parseInt(v, 10) < 4) return;            // 光学微调,不受网格约束
    hard.push('style.css  ' + m2[1] + (m2[2] || '') + ': ' + v + '   ← ' + line.trim().slice(0, 46));
  });
});
if (hard.length) {
  bad('style.css 里有 ' + hard.length + ' 处布局间距没走 var(--sN):\n         ' +
      hard.slice(0, 6).join('\n         '));
}

// ---- 5. 可点的东西不能小于 44px ----
// ⚠️ 改版前 .chips button 是 padding 6px + 13px 字 ≈ 33px 高,手机上一按一个不准。
//    这条只能查「声明了 min-height/--tap」,查不出实际渲染高度 ——
//    但至少能拦住「又有人拿 padding 撑高度」。
['.chips button', '.seg button', '.modal-opt'].forEach(function (sel) {
  // ⚠️ 必须匹配「选择器 + 紧跟 { 或 ,」。直接 indexOf('.modal-opt') 会先撞上
  //    容器 `.modal-opts`,查到的是它的规则块 —— 报「没有 min-height」,
  //    而真正的 .modal-opt 明明有。测试自己找错地方,比没测试更浪费时间。
  var re = new RegExp(sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*[{,]');
  var m = re.exec(cssBody);
  if (!m) { bad('style.css 里找不到 ' + sel); return; }
  var i = m.index;
  var block = cssBody.slice(i, cssBody.indexOf('}', i));
  if (!/min-height:\s*var\(--tap\)/.test(block)) {
    bad(sel + ' 没有 min-height: var(--tap) —— 触摸目标会低于 44px');
  }
});

console.log(fail ? '间距/令牌 ' + fail + ' 处不对'
                 : '  间距/令牌 ok(内联间距 ' + steps.length + ' 档:' + steps.join('/') + 'px)');
process.exit(fail ? 1 : 0);
