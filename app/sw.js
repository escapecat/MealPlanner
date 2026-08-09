// 离线缓存 —— **超市里没信号也得打得开采购清单。**
//
// ⚠️ 这个 app 的数据层有 1.4 MB(628 种食材 + 530 道菜)。
//    每次打开都从网上拉一遍,既慢又费流量,而**最需要它的时刻恰恰在超市里**
//    —— 地下一层,信号最差的地方。
//
// ⚠️ **不维护「要缓存哪些文件」的清单。**
//    这种清单是「写了没接上」的温床:加个新 js 忘了加进清单,
//    线上没事(网络能拉到),离线才白屏,而你多半在超市里才发现。
//    这里改成**用到什么缓存什么**:第一次打开就会把 29 个脚本全走一遍,
//    等于自动缓存完。
//
// ⚠️ 更新策略是两条,分开的:
//      index.html  —— 先走网络。不然改了代码你永远看不到新版。
//      其它文件    —— 先给缓存里的(快、离线可用),同时后台悄悄更新,
//                     下次打开就是新的。
//    **不用版本号。** 靠人手动 bump 版本的方案,漏一次就是「永远停在旧版」,
//    而那种故障没有任何提示。

// ⚠️ **清理缓存的时候只能清自己的。**
//    CacheStorage 是**按 origin 共享的**,不看 scope。
//    escapecat.github.io 上还装着别的 PWA(Balance),
//    原来这里写的是「删掉所有不叫 mealplanner 的缓存」——
//    于是这个 SW 一激活就把人家的缓存全清了,
//    表现是「另一个 app 突然离线打不开了」,而你根本想不到是这边干的。

var PREFIX = 'mealplanner';
var CACHE = PREFIX;

self.addEventListener('install', function (e) {
  self.skipWaiting();          // 新的装好就顶上,不用等所有标签页关掉
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (n) {
        // 只清自己的旧版本 —— 别人的一个都不许碰
        return (n.indexOf(PREFIX) === 0 && n !== CACHE) ? caches.delete(n) : null;
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  // 页面本身:先网络,断网了再吃缓存
  if (req.mode === 'navigate' || (req.headers.get('accept') || '').indexOf('text/html') >= 0) {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) {
          return hit || caches.match('index.html');
        });
      })
    );
    return;
  }

  // 其它:先缓存(离线也能用),后台顺手更新
  e.respondWith(
    caches.match(req).then(function (hit) {
      var fresh = fetch(req).then(function (res) {
        if (res && res.status === 200) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return res;
      }).catch(function () { return hit; });
      return hit || fresh;
    })
  );
});
