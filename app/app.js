// 装配层:决定显示哪一页,绑定底部 tab。
// 业务逻辑一律不在这里 —— 这一层只负责「谁来渲染」。

(function () {
  var root = document.getElementById('app');

  // ⚠️ 必须在任何模块读 RECIPES 之前跑 —— 它会把「你的校准」合并进全局菜谱数据。
  //    漏了这一步的后果是最难查的那种不一致:菜谱页显示你改过的 40 分钟,
  //    求解器却还按库里的 25 分钟排。
  RecipeBook.init();

  // 规格页降级进「我的」—— 它现在只是推荐用的参考值,不再是记账的地基,
  // 不该跟「记录/库存」平级占一个主 tab。
  var TABS = [
    { id: 'plan',    icon: '🍚', label: '记录' },
    { id: 'recipes', icon: '📖', label: '菜谱' },
    { id: 'pantry',  icon: '🧊', label: '库存' },
    { id: 'me',      icon: '⚙️', label: '我的' },
  ];

  var current = 'plan';

  function h(tag, attrs, kids) {
    var n = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') n.className = attrs[k];
      else if (k.indexOf('on') === 0) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) {
      n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  function needsOnboarding() {
    var p = Store.get('profile');
    return !p || !p.age || !p.heightCm;
  }

  /** 空状态写「下一步做什么」,不是只写「暂无数据」 */
  function placeholder(title, lines, cta) {
    var w = h('div', { class: 'wrap' }, [
      h('div', { class: 'empty' }, [
        h('div', { class: 'big' }, ['🥬']),
        h('div', { style: 'font-weight:600;margin-bottom:8px' }, [title]),
      ]),
    ]);
    var c = h('div', { class: 'card' });
    lines.forEach(function (l) { c.appendChild(h('div', { class: 'hint' }, [l])); });
    w.appendChild(c);
    if (cta) {
      w.appendChild(h('button', { class: 'btn ghost', onclick: cta.onclick }, [cta.label]));
    }
    return w;
  }

  function renderTabbar() {
    return h('nav', { class: 'tabbar' }, TABS.map(function (t) {
      return h('button', {
        type: 'button',
        'aria-current': current === t.id ? 'page' : null,
        onclick: function () { current = t.id; render(); Dom.toTop(); },
      }, [
        h('span', { class: 'ic' }, [t.icon]),
        h('span', {}, [t.label]),
      ]);
    }));
  }

  function render() {
    root.innerHTML = '';

    if (needsOnboarding()) {
      Onboarding.onDone = function () { current = 'plan'; render(); };
      Onboarding.mount(root);
      return;
    }

    var page = h('div');
    if (current === 'me') {
      SettingsUI.mount(page);
    } else if (current === 'pantry') {
      PantryUI.mount(page);
    } else if (current === 'recipes') {
      RecipesUI.mount(page);
    } else {
      RoundsUI.mount(page);
    }
    fillRest(page);
    root.appendChild(page);
    root.appendChild(renderTabbar());
    fitHeight(page);
  }

  /** 让最后一块内容容器吃掉撑出来的空间。 */
  function fillRest(page) {
    var wrap = page.querySelector && page.querySelector('.wrap');
    if (!wrap || (wrap.className || '').indexOf('wrap-fill') >= 0) return;
    var kids = wrap.children || [];
    var last = kids[kids.length - 1];
    if (!last) return;
    var c = (last.className || '');
    if (c.indexOf('list') >= 0 || c.indexOf('card') >= 0) {
      last.className = c + ' fill-rest';
    }
  }

  /** 把内容区**正好**撑到 tab 栏顶边。
   *
   *  ⚠️ **用实测值，不用 CSS 单位去猜。** 上一版是
   *     `min-height: calc(100svh - 53px - env(...))` —— 100svh 含底部安全区
   *     而实际可视高度不含，差 34px，于是每个短页面都多出 34px 可以滑动，
   *     切 tab 时忽能滑忽不能滑，手上就是「上下跳」。
   *     现在只量 tab 栏顶边在哪，把内容区撑到那儿，没有假设。
   *
   *  ⚠️ 先清空再量 —— 上次设的值会把这次的测量顶大，越切越长。
   */
  function fitHeight(page) {
    var wrap = page.querySelector && page.querySelector('.wrap');
    var bar = document.querySelector && document.querySelector('.tabbar');
    if (!wrap || !bar || !wrap.getBoundingClientRect) return;
    try {
      wrap.style.minHeight = '';
      var h = Math.floor(bar.getBoundingClientRect().top -
                         wrap.getBoundingClientRect().top);
      if (h > 0) wrap.style.minHeight = h + 'px';
    } catch (e) {}
  }



  render();

  // 离线缓存 —— 见 sw.js。
  //
  // ⚠️ Service Worker 只在**安全上下文**里能装(https 或 localhost),
  //    所以局域网 http 直接访问时它不会注册 —— **也就不会拖累开发**:
  //    改一行代码刷新就见效,不用担心缓存把旧版钉死。
  // ⚠️ 双击 index.html(file://)同样装不了。那条路本来也不需要缓存。
  // ⚠️ 注册失败一律吞掉:离线是加分项,不该因为它没起来就把整个页面搭进去。
  if (typeof navigator !== 'undefined' && navigator.serviceWorker &&
      typeof location !== 'undefined' && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
