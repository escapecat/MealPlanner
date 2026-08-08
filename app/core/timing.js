// 「多久能吃上」 —— 纯函数,不碰 DOM。
//
// ⚠️ 库里的 `总分钟` **不含提前准备**。这不是小数点问题:
//     木耳炒蛋   总 20 分,但要先泡发 30 分钟 → 真正能吃上 50 分钟
//     蛋炒饭     总 15 分,但要隔夜冷饭       → 今天想吃是来不及的
//     宁式烤菜   总 55 分,但要泡发香菇 1 小时 → 1 小时 55 分
//    214 个变体有可解析的提前时间,其中 42 个的提前时间 ≥ 总分钟。
//
//    页面上写「20 分」而你实际 50 分钟才吃上,这个数字就是在骗人 ——
//    而且骗的正好是最要紧的那个决定:「今天还来得及做这个吗」。
//
// 三个数各有各的用处,不能只留一个:
//    能吃上  —— 从现在开始到能动筷子(含提前准备)。**决定今天做不做得成。**
//    动手    —— 你必须站在灶台前的分钟数。决定累不累。
//    提前    —— 要提前多久开始泡/腌。决定几点动手。

var Timing = (function () {

  // 「腌 15分钟」「泡发 30分钟」「糯米泡2小时」「冷藏1小时」「隔夜」
  // 145 种写法里 135 种带时长,剩下 10 种是纯动作(「焯水」「上浆」)—— 记 0 不瞎猜。
  var DUR = /(\d+(?:\.\d+)?)\s*(小时|h|分钟|分)/g;

  /** @return {minutes, overnight, text} */
  function parseAhead(text) {
    if (!text || text === '—') return { minutes: 0, overnight: false, text: null };
    // 隔夜没法用分钟表达 —— 它的意思是「今天做不成」,单独标出来
    if (/隔夜|过夜|一夜|前一天/.test(text)) {
      return { minutes: 0, overnight: true, text: text };
    }
    var m = 0, x;
    DUR.lastIndex = 0;
    while ((x = DUR.exec(text)) !== null) {
      m += parseFloat(x[1]) * (/小时|h/.test(x[2]) ? 60 : 1);
    }
    return { minutes: Math.round(m), overnight: false, text: text };
  }

  /**
   * 这道菜(可带配菜)多久能吃上。
   *
   * 配菜是**和主菜并行做的**,不是接在后面 —— 一个人在厨房当然是穿插着来的,
   * 所以取 max 不取 sum。但动手时间要相加:那是真的要多站十分钟。
   */
  function ofMeal(mainVariant, sideVariant) {
    var a1 = parseAhead(mainVariant && mainVariant.aheadOfTime);
    var a2 = parseAhead(sideVariant && sideVariant.aheadOfTime);

    var cookMain = (mainVariant && mainVariant.totalMinutes) || 0;
    var cookSide = (sideVariant && sideVariant.totalMinutes) || 0;
    var ahead = Math.max(a1.minutes, a2.minutes);

    return {
      // 提前准备可以和别的事并行,但它必须先开始 —— 所以是加在前面的
      eatIn: ahead + Math.max(cookMain, cookSide),
      cook: Math.max(cookMain, cookSide),
      ahead: ahead,
      overnight: a1.overnight || a2.overnight,
      aheadText: a1.text || a2.text,
      active: ((mainVariant && mainVariant.activeMinutes) || 0)
            + ((sideVariant && sideVariant.activeMinutes) || 0),
    };
  }

  /** 「1 小时 55 分」比「115 分」好读 */
  function fmt(minutes) {
    if (minutes == null) return '?';
    if (minutes < 60) return minutes + ' 分';
    var h = Math.floor(minutes / 60), m = minutes % 60;
    return h + ' 小时' + (m ? ' ' + m + ' 分' : '');
  }

  /** 一句人话:什么时候得动手 */
  function startNote(t) {
    if (!t) return null;
    if (t.overnight) return '要前一天准备(' + (t.aheadText || '隔夜') + '),今天来不及';
    if (t.ahead > 0) {
      return (t.aheadText || '提前准备') + ' —— 想 X 点吃,得提前 ' +
             fmt(t.eatIn) + ' 开始';
    }
    return null;
  }

  return { parseAhead: parseAhead, ofMeal: ofMeal, fmt: fmt, startNote: startNote };
})();

if (typeof module !== 'undefined') module.exports = Timing;
