// 冷启动表单 —— 身体数据 7 项 + 配置 4 项,一屏滚完,不做向导。
//
// DESIGN.md 第七节:「让一个有选择困难症的人在做饭前先做 40 个决定,是把问题放大了。」
// 其余 40 多项全给默认值,收进以后的「高级设置」。
//
// 这一层只做展示和事件绑定,零业务逻辑 —— 算目标找 Profile,算可做菜数找 Catalog。

var Onboarding = (function () {

  var el, state;

  var DEFAULTS = {
    sex: 'male', age: null, heightCm: null, weightKg: null,
    activity: 'sedentary', goal: 'maintain',
    breakfast: 'normal',
    equipment: ['炒锅', '汤锅'],
    blacklist: [],
    maxSpicy: 3,
    maxActiveMinutes: 45,
    // ⚠️ 没有「每周预算」—— 135 条包装规格里填了参考价的是 0 条,
    //    求解器算不出这次要花多少钱,问了也没法用。
    //    DESIGN.md 自己写的:「接不上动作的就是虚荣指标,删掉」。价格数据填上再加回来。
    // ⚠️ 也没有「做几顿」—— 那是每次生成时才知道的,不是长期设定。见 app.js 的顿数选择。
  };

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

  function seg(field, options) {
    return h('div', { class: 'seg' }, options.map(function (o) {
      return h('button', {
        type: 'button',
        'aria-pressed': String(state[field] === o.value),
        onclick: function () { state[field] = o.value; render(); },
      }, [o.label]);
    }));
  }

  function numRow(field, label, placeholder, suffix) {
    return h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, [label]),
      h('input', {
        type: 'number', inputmode: 'decimal', placeholder: placeholder,
        value: state[field] == null ? '' : String(state[field]),
        oninput: function (e) {
          var v = parseFloat(e.target.value);
          state[field] = isNaN(v) ? null : v;
          updateTargets();
        },
      }),
      suffix ? h('div', { class: 'hint' }, [suffix]) : h('span', {}),
    ]);
  }

  function chips(items, isOn, toggle) {
    return h('div', { class: 'chips' }, items.map(function (it) {
      return h('button', {
        type: 'button', 'aria-pressed': String(isOn(it)),
        onclick: function () { toggle(it); render(); },
      }, [it.label]);
    }));
  }

  // ---- 实时反馈:改一个数就立刻看到目标和可做菜数,不用等提交 ----

  function updateTargets() {
    var box = el.querySelector('#targets');
    if (!box) return;
    box.innerHTML = '';
    var d = Profile.dailyTargets(state);
    if (!d) {
      box.appendChild(h('div', { class: 'hint' }, ['填完年龄 / 身高 / 体重就会算出你的目标']));
      return;
    }
    var pm = Profile.perPlannedMeal(d, state.breakfast);
    box.appendChild(h('div', {}, [
      h('div', {}, ['基础代谢 ' + Profile.bmr(state) + ' kcal · 日常消耗 ' + d.tdee + ' kcal']),
      h('div', { style: 'margin-top:6px;font-weight:600' },
        ['每日目标 ' + d.kcal + ' kcal · 蛋白 ' + d.protein + 'g · 蔬菜 ' + d.veg + 'g']),
      h('div', { style: 'margin-top:6px' },
        ['要排的午饭 / 晚饭各约 ' + pm.kcal + ' kcal · 蛋白 ' + pm.protein + 'g · 蔬菜 ' + pm.veg + 'g']),
      h('div', { class: 'hint' }, [pm.note]),
    ]));
    if (d.kcalFloored) {
      box.appendChild(h('div', { class: 'note warn', style: 'margin-top:10px' },
        ['按 −20% 算出来低于安全下限,已抬到 ' + d.kcal + ' kcal。减脂不该靠把热量压到这么低。']));
    }
  }

  function updateCount() {
    var box = el.querySelector('#avail');
    if (!box) return;
    var c = Catalog.countAvailable({
      equipment: state.equipment,
      blacklist: Catalog.expandBlacklist(state.blacklist),
      maxSpicy: state.maxSpicy,
      maxActiveMinutes: state.maxActiveMinutes,
    });
    var pct = Math.round(c.dishes / c.total * 100);
    box.innerHTML = '';
    box.appendChild(h('div', { class: pct < 25 ? 'note warn' : 'note' }, [
      '当前配置下可做 ' + c.dishes + ' 道菜(共 ' + c.total + ' 道,' + pct + '%)' +
      (c.variants > c.dishes ? ' · ' + c.variants + ' 个做法档位' : ''),
    ]));
    if (pct < 25) {
      box.appendChild(h('div', { class: 'hint' },
        ['可选范围偏窄,四顿不重复会比较勉强。这些都能随时改,不用现在就想清楚。']));
    }
  }

  // ---- 渲染 ----

  function render() {
    el.innerHTML = '';
    var w = h('div', { class: 'wrap' });

    w.appendChild(h('h1', {}, ['先认识一下你']));
    w.appendChild(h('p', { class: 'sub' },
      ['11 个问题,大概一分钟。之后都能改 —— 这些只是起点,不是承诺。']));

    // —— 身体数据 7 项
    w.appendChild(h('h2', {}, ['身体数据']));
    var c1 = h('card' in {} ? 'div' : 'div', { class: 'card' });
    c1.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['性别(影响基础代谢公式)']),
      seg('sex', [{ value: 'male', label: '男' }, { value: 'female', label: '女' }]),
    ]));
    c1.appendChild(numRow('age', '年龄', '30', null));
    c1.appendChild(numRow('heightCm', '身高', '175', 'cm'));
    c1.appendChild(numRow('weightKg', '体重', '70', 'kg · 之后每次称重都会记下来,目标跟着重算'));
    c1.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['活动量']),
      seg('activity', Object.keys(Profile.ACTIVITY).map(function (k) {
        return { value: k, label: Profile.ACTIVITY[k].label };
      })),
      h('div', { class: 'hint' }, [(Profile.ACTIVITY[state.activity] || {}).desc || '']),
    ]));
    c1.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['目标']),
      seg('goal', Object.keys(Profile.GOAL).map(function (k) {
        return { value: k, label: Profile.GOAL[k].label };
      })),
      h('div', { class: 'hint' }, [(Profile.GOAL[state.goal] || {}).desc || '']),
    ]));
    c1.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['早饭大概吃多少?']),
      seg('breakfast', Object.keys(Profile.BREAKFAST).map(function (k) {
        return { value: k, label: Profile.BREAKFAST[k].label };
      })),
      h('div', { class: 'hint' }, [
        (Profile.BREAKFAST[state.breakfast] || {}).desc +
        ((Profile.BREAKFAST[state.breakfast] || {}).kcal
          ? ' · 约 ' + Profile.BREAKFAST[state.breakfast].kcal + ' kcal' : ''),
      ]),
      h('div', { class: 'hint' }, [
        '这个应用只排午饭和晚饭 —— 问早饭是为了知道那两顿该分多少,不是要管你早上吃什么',
      ]),
    ]));
    w.appendChild(c1);

    var t = h('div', { class: 'card', id: 'targets' });
    w.appendChild(t);

    w.appendChild(h('div', { class: 'note', style: 'margin-bottom:16px' }, [
      '目标由公式算,不会因为你说「没吃饱」就往上涨 —— 那样在减脂目标下会一路漂移。' +
      '「没吃饱」调的是构成:先加蛋白,再加蔬菜体积,再换低能量密度做法。',
    ]));

    // —— 配置 4 项
    w.appendChild(h('h2', {}, ['厨房与口味']));
    var c2 = h('div', { class: 'card' });

    c2.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['你有哪些厨具?(括号里是能解锁多少道菜)']),
      chips(
        Catalog.equipmentMarginal({ equipment: state.equipment }).map(function (m) {
          return { id: m.name, label: m.name + (m.owned ? ' −' + m.delta : ' +' + m.delta) };
        }),
        function (it) { return state.equipment.indexOf(it.id) >= 0; },
        function (it) {
          var i = state.equipment.indexOf(it.id);
          if (i >= 0) state.equipment.splice(i, 1); else state.equipment.push(it.id);
        }
      ),
      h('div', { class: 'hint' }, [
        '数字是边际的:没勾的是「加上能多做几道」,勾了的是「去掉会少几道」。' +
        '炒锅/汤锅/不粘锅多数做法下能互顶,烤箱和空气炸锅也能换 —— 所以不用勾满。',
      ]),
    ]));

    c2.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['有什么不吃的?']),
      chips(
        Catalog.commonDislikes().map(function (d) { return { id: d.id, label: d.name }; }),
        function (it) { return state.blacklist.indexOf(it.id) >= 0; },
        function (it) {
          var i = state.blacklist.indexOf(it.id);
          if (i >= 0) state.blacklist.splice(i, 1); else state.blacklist.push(it.id);
        }
      ),
      h('div', { class: 'hint' }, ['这里只列常见的,以后可以随时加任何食材']),
    ]));

    c2.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['能吃多辣?']),
      seg('maxSpicy', [
        { value: 0, label: '不吃辣' }, { value: 1, label: '微辣' },
        { value: 2, label: '中辣' }, { value: 3, label: '重辣都行' },
      ]),
    ]));

    c2.appendChild(h('div', { class: 'row' }, [
      h('label', { class: 'lab' }, ['单顿最多愿意动手多久?']),
      seg('maxActiveMinutes', [
        { value: 20, label: '20 分钟' }, { value: 30, label: '30 分钟' },
        { value: 45, label: '45 分钟' }, { value: 999, label: '不限' },
      ]),
      h('div', { class: 'hint' },
        ['算的是**活跃时间** —— 红烧肉总共 80 分钟,但其中 55 分钟在焖,人不用待在厨房']),
    ]));
    w.appendChild(c2);

    var a = h('div', { id: 'avail' });
    w.appendChild(a);

    w.appendChild(h('button', {
      class: 'btn', style: 'margin-top:16px',
      onclick: submit,
    }, ['开始用']));

    w.appendChild(h('div', { class: 'hint', style: 'text-align:center;margin-top:10px' },
      ['数据只存在这台设备的浏览器里,不上传']));

    el.appendChild(w);
    updateTargets();
    updateCount();
  }

  function submit() {
    var v = Profile.validate(state);
    if (!v.ok) {
      alert('还差几项:\n' + Object.keys(v.errors).map(function (k) {
        return '· ' + ({ age: '年龄', heightCm: '身高', weightKg: '体重',
                         activity: '活动量', goal: '目标' }[k] || k) + ' —— ' + v.errors[k];
      }).join('\n'));
      return;
    }
    var now = new Date().toISOString();
    Store.set('profile', {
      sex: state.sex, age: state.age, heightCm: state.heightCm,
      activity: state.activity, goal: state.goal,
      breakfast: state.breakfast,
      createdAt: now, updatedAt: now,
    });
    // 体重存成时间序列 —— 体重变则 TDEE 变则目标重算(DESIGN 第七节)
    Store.set('weightLog', [{ date: now, kg: state.weightKg }]);
    Store.set('config', {
      equipment: state.equipment.slice(),
      blacklist: state.blacklist.slice(),
      maxSpicy: state.maxSpicy,
      maxActiveMinutes: state.maxActiveMinutes,
      updatedAt: now,
    });
    if (Onboarding.onDone) Onboarding.onDone();
  }

  function mount(node) {
    el = node;
    var p = Store.get('profile');
    var wlog = Store.get('weightLog', []);
    var cfg = Store.get('config');
    state = Object.assign({}, DEFAULTS, p || {}, cfg || {});
    if (wlog && wlog.length) state.weightKg = wlog[wlog.length - 1].kg;
    render();
  }

  return { mount: mount, onDone: null, DEFAULTS: DEFAULTS };
})();

if (typeof module !== 'undefined') module.exports = Onboarding;
