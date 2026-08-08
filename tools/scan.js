// 「人会不会有意见」扫描器 —— **这不是测试,是判读工具。**
//
// 回归测试回答「有没有坏」;这个回答「合不合理」。后者没有对错线,
// 只有「读一遍计划和采购清单,人会不会皱眉」。所以它不进 check.sh,
// 也不返回退出码 —— 输出是给人看的,不是给 CI 看的。
//
// 用法:node tools/scan.js
// 配套:node tools/jstest/sim_mine.js 100 [要打印的轮次,逗号分隔]
//
// 每一条阈值都是拍脑袋定的,记在这儿免得下次假装它们是科学:
//    超宽容带     目标 kcal × 1.25 —— 「一顿吃多点很正常」的上限
//    蛋白不达标   目标 × 85%
//    蔬菜偏少     目标 × 60%
//    采购 >13 样  一个人四顿,再多就拎不动也记不住
//    浪费 >35%    买回来三分之一要扔
//    会烂的剩得比用的多  只对 fresh 档算 —— 鸡蛋挂面剩再多不心疼

var path=require('path'),APP=path.join(process.cwd(),'app');
global.INGREDIENTS=require(path.join(APP,'data/ingredients.js'));
global.RECIPES=require(path.join(APP,'data/recipes.js'));
global.PACKAGES=require(path.join(APP,'data/packages.js'));
var db={};global.Store={get:function(k,f){return db[k]!==undefined?db[k]:(f===undefined?null:f);},set:function(k,v){db[k]=v;}};
global.Equipment=require(path.join(APP,'core/equipment.js'));
global.Timing=require(path.join(APP,'core/timing.js'));
global.Catalog=require(path.join(APP,'core/catalog.js'));
global.Packaging=require(path.join(APP,'core/packaging.js'));
global.Pantry=require(path.join(APP,'core/pantry.js'));
global.Nutrition=require(path.join(APP,'core/nutrition.js'));
global.Meal=require(path.join(APP,'core/meal.js'));
var Profile=require(path.join(APP,'core/profile.js')),Solver=require(path.join(APP,'core/solver.js'));
var CONS={equipment:['炒锅','空气炸锅','电饭煲'],maxSpicy:1,maxActiveMinutes:45,maxDifficulty:3,
          maxIdleWait:60,allowOvernight:false,blacklist:['bitter_melon','okra','zucchini','canned_tuna']};
var daily=Profile.dailyTargets({sex:'male',age:30,heightCm:175,weightKg:70,activity:'light',goal:'cut'});
var T=Profile.perPlannedMeal(daily,'light');
function ing(id){return INGREDIENTS.filter(function(i){return i.id===id;})[0];}
var F={};
function flag(k,v){(F[k]=F[k]||[]).push(v);}
for(var s=0;s<100;s++){
  var o=Solver.solve({servings:4,constraints:CONS,stock:{},mustUse:[],target:T,recentRecipeIds:{},seed:s});
  if(!o.ok){flag('排不出来','轮'+s);continue;}
  var meat=false;
  o.stage2.chosen.forEach(function(c){
    var n=c.nutrition||{};
    if(n.kcal>T.kcal*1.25)flag('一顿超宽容带','轮'+s+' '+c.recipe.name+' '+n.kcal+'kcal');
    if(n.protein<T.protein*0.85)flag('蛋白不到目标85%','轮'+s+' '+c.recipe.name+' '+n.protein+'g');
    if(n.veg<T.veg*0.6)flag('蔬菜偏少','轮'+s+' '+c.recipe.name+' '+n.veg+'g');
    var t=Timing.ofMeal(c.variant,c.side&&c.side._cand&&c.side._cand.variant);
    if(t.active>45)flag('动手超上限','轮'+s+' '+c.recipe.name+' '+t.active+'分');
    (c.variant.ingredients||[]).forEach(function(it){
      if(it.role!=='main')return;var i=ing(it.ids[0]);
      if(i&&['畜肉','禽肉','水产'].indexOf(i.category)>=0)meat=true;});});
  if(!meat)flag('整轮一口肉都没有','轮'+s);
  if(o.shopping.buy.length>13)flag('一轮采购 >13 样','轮'+s+' '+o.shopping.buy.length+' 样');
  if(o.wasteRatio>0.35)flag('生鲜浪费 >35%','轮'+s+' '+Math.round(o.wasteRatio*100)+'%');
  o.shopping.buy.forEach(function(b){
    if(!b.plan){flag('没有包装规格','轮'+s+' '+b.ing.name);return;}
    if(b.ing.tier==='fresh'&&b.plan.total-b.needGrams>b.needGrams)
      flag('会烂的剩得比用的多','轮'+s+' '+b.ing.name+' 要'+b.needGrams+'g 买'+b.plan.total+'g');});
}
Object.keys(F).sort(function(a,b){return F[b].length-F[a].length;}).forEach(function(k){
  console.log('\n'+k+':  '+F[k].length);
  F[k].slice(0,4).forEach(function(x){console.log('   '+x);});});

// 主料重复 —— 100 轮里读出来最刺眼的一类问题(「猪肉末/猪肉末/猪肉末/猪肉末」)
function mainProt(v){var b=null;(v.ingredients||[]).forEach(function(it){
  if(it.role!=='main')return;var i=ing(it.ids[0]);
  if(!i||!i.per100g||!i.per100g.protein||i.per100g.protein<10)return;
  if(!b||i.per100g.protein>b.d)b={id:i.id,name:i.name,cat:i.category,d:i.per100g.protein};});return b;}
var idDup=0,catDup=0,ex=[],allCat={};
for(var s2=0;s2<100;s2++){
  var o2=Solver.solve({servings:4,constraints:CONS,stock:{},mustUse:[],target:T,recentRecipeIds:{},seed:s2});
  if(!o2.ok)continue;
  var ids={},cats={},names=[];
  o2.stage2.chosen.forEach(function(c){var m=mainProt(c.variant);
    var n=m?m.name:'(无肉)',ct=m?m.cat:'(无肉)';names.push(n);
    ids[n]=(ids[n]||0)+1;cats[ct]=(cats[ct]||0)+1;allCat[ct]=(allCat[ct]||0)+1;});
  if(Math.max.apply(null,Object.keys(ids).map(function(k){return ids[k];}))>=3){
    idDup++;if(ex.length<4)ex.push('轮'+s2+'  '+names.join(' / '));}
  if(Math.max.apply(null,Object.keys(cats).map(function(k){return cats[k];}))>=4)catDup++;
}
console.log('\n≥3 顿同一样主料:  '+idDup+'/100');
ex.forEach(function(x){console.log('   '+x);});
console.log('四顿全是同一类:  '+catDup+'/100');
console.log('\n主蛋白源类别分布:');
Object.keys(allCat).sort(function(a,b){return allCat[b]-allCat[a];}).forEach(function(k){
  console.log('   '+String(Math.round(allCat[k]/4)).padStart(3)+'%  '+k);});
