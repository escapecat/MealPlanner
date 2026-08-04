// 营养目标计算 —— 纯函数,不碰 DOM,不 import 任何 UI 框架(DESIGN.md 铁律)
//
// ⚠️ 这个文件承载 DESIGN.md 第七节那条最重要的约束:
//     「饭量不能靠反馈学」—— 公式定目标(锚,不漂移),称重做监测,反馈只调构成。
// 用户说「不够吃」时,调的是 adjustComposition() 里的构成,**热量上限始终是硬的**。

var Profile = (function () {

  var ACTIVITY = {
    sedentary: { k: 1.2,   label: '久坐',   desc: '办公室,基本不运动' },
    light:     { k: 1.375, label: '轻度',   desc: '每周 1-3 次轻运动' },
    moderate:  { k: 1.55,  label: '中等',   desc: '每周 3-5 次运动' },
    active:    { k: 1.725, label: '高',     desc: '每周 6-7 次,或体力工作' },
  };

  var GOAL = {
    cut:      { kcal: -0.20, protein: 1.8, label: '减脂', desc: '热量 −20%,蛋白拉高保肌肉' },
    maintain: { kcal:  0,    protein: 1.4, label: '维持', desc: '按 TDEE 吃' },
    gain:     { kcal: +0.10, protein: 1.8, label: '增肌', desc: '热量 +10%' },
  };

  // Mifflin-St Jeor —— 比 Harris-Benedict 在现代人群上更准
  function bmr(p) {
    if (!p || !p.weightKg || !p.heightCm || !p.age) return null;
    var base = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age;
    return Math.round(base + (p.sex === 'female' ? -161 : 5));
  }

  function tdee(p) {
    var b = bmr(p);
    if (b === null) return null;
    var a = ACTIVITY[p.activity] || ACTIVITY.sedentary;
    return Math.round(b * a.k);
  }

  /** 每日目标。这是「该吃多少」,不是「想吃多少」—— 只随体重/活动量变,不随反馈变。 */
  function dailyTargets(p) {
    var t = tdee(p);
    if (t === null) return null;
    var g = GOAL[p.goal] || GOAL.maintain;
    var kcal = Math.round(t * (1 + g.kcal));

    // 减脂时给个地板,避免身高体重极端值算出危险的低热量
    var floor = p.sex === 'female' ? 1200 : 1500;
    var floored = kcal < floor;

    return {
      tdee: t,
      kcal: Math.max(kcal, floor),
      kcalFloored: floored,
      protein: Math.round(p.weightKg * g.protein),   // g/天
      veg: 400,                                       // g/天,WHO 建议下限
      // 碳水不设目标只设上限:蛋白和蔬菜先满足,剩下的热量给主食
      carbCapKcal: Math.round(Math.max(kcal, floor) * 0.5),
      breakfast: p.breakfast || 'normal',
    };
  }

  // 早饭档位。**这个应用只排午饭和晚饭**,早饭它管不着也看不见 ——
  // 但早饭吃多少直接决定这两顿该分到多少,所以必须问一个粗档。
  //
  // ⚠️ 为什么不是问「一天吃几顿」再除以 n:那假设三顿一样大,而早饭从来不是。
  //    一个包子加豆浆约 350 kcal,按 1593÷3=531 算,午晚饭会各少 90 kcal 而你不知道为什么。
  //
  // ⚠️ 这几个数是估计值,而且**唯一能校准它的是体重趋势** ——
  //    午晚饭由应用排、能算准,早饭是唯一的未知数。所以体重没按预期走时,
  //    第一个该怀疑的就是这一档选错了,而不是去改午晚饭的目标。
  var BREAKFAST = {
    none:   { kcal: 0,   protein: 0,  label: '不吃',   desc: '午晚两顿分掉全天的量' },
    light:  { kcal: 150, protein: 8,  label: '很少',   desc: '一杯豆浆 / 一个鸡蛋 / 一根香蕉' },
    normal: { kcal: 350, protein: 12, label: '一般',   desc: '包子豆浆 / 麦片牛奶 / 三明治' },
    big:    { kcal: 550, protein: 20, label: '丰盛',   desc: '两个包子+鸡蛋+豆浆 / 全套西式早餐' },
  };

  /** 这个应用要排的那两顿(午+晚)各自的目标。
   *  = (全天目标 − 早饭) ÷ 2 ,不是 全天 ÷ 3。 */
  function perPlannedMeal(daily, breakfastKey) {
    if (!daily) return null;
    var b = BREAKFAST[breakfastKey] || BREAKFAST.normal;
    var kcal = Math.max(daily.kcal - b.kcal, 300);      // 不至于算出荒谬的小值
    var protein = Math.max(daily.protein - b.protein, 20);
    return {
      kcal: Math.round(kcal / 2),
      protein: Math.round(protein / 2),
      veg: Math.round(daily.veg / 2),   // 蔬菜基本不靠早饭,午晚各半
      breakfast: b,
      note: b.kcal
        ? '扣掉早饭约 ' + b.kcal + ' kcal 之后,午晚两顿平分'
        : '不吃早饭,午晚两顿分掉全天的量',
    };
  }

  /** 保留:按 n 顿平均摊。只在需要「一顿的平均量」这种粗略概念时用,
   *  排菜一律用 perPlannedMeal —— 平均摊会把早饭当成和正餐一样大。 */
  function perMeal(daily, mealsPerDay) {
    if (!daily) return null;
    var n = mealsPerDay || 3;
    return {
      kcal: Math.round(daily.kcal / n),
      protein: Math.round(daily.protein / n),
      veg: Math.round(daily.veg / n),
      basedOn: n,
    };
  }

  /**
   * 「不够吃」的处理 —— 按 DESIGN.md 第七节的护栏顺序,**只调构成不加总量**。
   * 返回一串建议动作,每条都说明为什么。热量到顶就不再加,改给饱腹策略。
   */
  function adjustComposition(daily, actual) {
    var out = [];
    if (!daily || !actual) return out;

    if (actual.protein < daily.protein) {
      out.push({ action: 'addProtein',
                 amount: daily.protein - actual.protein,
                 why: '蛋白没到目标,而蛋白的饱腹感最强 —— 先补这个' });
    }
    if (actual.veg < daily.veg) {
      out.push({ action: 'addVeg',
                 amount: daily.veg - actual.veg,
                 why: '蔬菜没到 ' + daily.veg + 'g,加体积几乎不加热量' });
    }
    if (actual.kcal >= daily.kcal * 0.95 && actual.veg >= daily.veg) {
      out.push({ action: 'lowerDensity',
                 why: '热量已经接近上限,换炖/蒸/汤替代炒/炸,同样重量热量更低' });
    }
    if (out.length === 0 && actual.kcal < daily.kcal) {
      out.push({ action: 'addStaple', amount: 15,
                 why: '蛋白蔬菜都够了,主食还有余量,小幅加 15g 生重' });
    }
    // 到了热量上限就一定要说这句 —— 它是这套护栏的落点,不能被前面几条盖住。
    // 「不够吃」永远不会变成「那就多吃点」,否则减脂目标下会一路漂移。
    if (actual.kcal >= daily.kcal * 0.95) {
      out.push({ action: 'satietyTipsOnly',
                 why: '热量已经到上限,**不加量** —— 再加就偏离目标了。' +
                      '改用饱腹策略:餐前喝汤、放慢进食、加高纤维配菜' });
    } else if (out.length === 0) {
      out.push({ action: 'ok', why: '各项都在目标范围内' });
    }
    return out;
  }

  function validate(p) {
    var errs = {};
    if (!p.age || p.age < 10 || p.age > 100) errs.age = '10-100 之间';
    if (!p.heightCm || p.heightCm < 120 || p.heightCm > 220) errs.heightCm = '120-220cm';
    if (!p.weightKg || p.weightKg < 30 || p.weightKg > 200) errs.weightKg = '30-200kg';
    if (!ACTIVITY[p.activity]) errs.activity = '请选活动量';
    if (!GOAL[p.goal]) errs.goal = '请选目标';
    return { ok: Object.keys(errs).length === 0, errors: errs };
  }

  return {
    ACTIVITY: ACTIVITY, GOAL: GOAL, BREAKFAST: BREAKFAST,
    bmr: bmr, tdee: tdee,
    dailyTargets: dailyTargets, perMeal: perMeal, perPlannedMeal: perPlannedMeal,
    adjustComposition: adjustComposition, validate: validate,
  };
})();

if (typeof module !== 'undefined') module.exports = Profile;
