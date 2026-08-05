// 拼音匹配 —— 纯函数,不碰 DOM。
//
// 中文应用不支持拼音搜索基本等于不支持搜索:没人愿意为了找「红烧肉」去切输入法,
// 尤其在超市里单手操作的时候。
//
// ⚠️ 不预生成「全拼字符串」再做 indexOf,那样有两个坑:
//    1. 多音字要组合爆炸(「重庆干煸豆角」四个多音字 = 16 种拼法)
//    2. 「hongsh」这种打一半的匹配不了 —— 而搜索框里的字天然都是打一半的
//    改成**沿着菜名逐字走**,每个字可以按整个读音吃掉、也可以按首字母吃掉。
//    名字都很短(≤12 字),查询也短,穷举完全够快。

var Pinyin = (function () {

  function readings(ch) {
    var p = (typeof PINYIN !== 'undefined') ? PINYIN[ch] : null;
    return p ? p.split('|') : null;
  }

  /**
   * 从 name 的第 i 个字开始,能不能把 q 从第 j 位起全部吃掉。
   * 每个汉字有三种吃法:整读音 / 首字母 / 最后一个字打了一半。
   */
  function walk(name, i, q, j, memo) {
    if (j >= q.length) return true;
    if (i >= name.length) return false;

    var key = i * 1000 + j;
    if (memo[key] !== undefined) return memo[key];
    memo[key] = false;                       // 先占位,防环

    var ch = name[i];
    var rs = readings(ch);
    var okAny = false;

    if (rs) {
      for (var k = 0; k < rs.length && !okAny; k++) {
        var r = rs[k];
        // ① 整个读音吃掉:hong|shao|rou
        if (q.substr(j, r.length) === r && walk(name, i + 1, q, j + r.length, memo)) okAny = true;
        // ② 只吃首字母:h|s|r —— 和 ① 混着来也行(hongsr)
        else if (q[j] === r[0] && walk(name, i + 1, q, j + 1, memo)) okAny = true;
        // ③ 查询到这里就没了,而剩下的正好是这个读音的开头:hongsh
        else {
          var rest = q.substr(j);
          if (rest.length < r.length && r.indexOf(rest) === 0) okAny = true;
        }
      }
    } else {
      // 非汉字(韩文、括号、数字、英文)按字面比一位
      if (ch.toLowerCase() === q[j] && walk(name, i + 1, q, j + 1, memo)) okAny = true;
    }

    memo[key] = okAny;
    return okAny;
  }

  /** name 里有没有一段能读成 q。q 只含小写字母时才走拼音,否则交给调用方做汉字匹配。 */
  function match(name, q) {
    if (!name || !q) return false;
    q = q.toLowerCase().replace(/\s+/g, '');
    if (!/^[a-z]+$/.test(q)) return false;        // 混了汉字就不是在打拼音
    for (var i = 0; i < name.length; i++) {
      if (walk(name, i, q, 0, {})) return true;
    }
    return false;
  }

  /** 给人看的:整串的全拼和首字母(多音字取第一个读音) */
  function of(name) {
    var full = '', init = '';
    for (var i = 0; i < (name || '').length; i++) {
      var rs = readings(name[i]);
      if (rs) { full += rs[0]; init += rs[0][0]; }
      else { full += name[i]; init += name[i]; }
    }
    return { full: full, initials: init };
  }

  /** 这个查询看起来是拼音吗 —— 决定要不要在界面上提示「按拼音找到的」 */
  function looksPinyin(q) { return !!q && /^[a-zA-Z\s]+$/.test(q); }

  return { match: match, of: of, looksPinyin: looksPinyin };
})();

if (typeof module !== 'undefined') module.exports = Pinyin;
