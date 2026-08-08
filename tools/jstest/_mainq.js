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
// 一顿的「主蛋白源」= 蛋白密度最高的 main 食材
function mainProt(v){var b=null;(v.ingredients||[]).forEach(function(it){
  if(it.role!=='main')return;var i=ing(it.ids[0]);
  if(!i||!i.per100g||!i.per100g.protein||i.per100g.protein<10)return;
  if(!b||i.per100g.protein>b.d)b={id:i.id,name:i.name,cat:i.category,d:i.per100g.protein};});return b;}
var catDup=0,idDup=0,ex=[],allCat={};
for(var s=0;s<100;s++){
  var o=Solver.solve({servings:4,constraints:CONS,stock:{},mustUse:[],target:T,recentRecipeIds:{},seed:s});
  if(!o.ok)continue;
  var ids={},cats={},names=[];
  o.stage2.chosen.forEach(function(c){var m=mainProt(c.variant);
    var n=m?m.name:'(无肉)',ct=m?m.cat:'(无肉)';names.push(n);
    ids[n]=(ids[n]||0)+1;cats[ct]=(cats[ct]||0)+1;allCat[ct]=(allCat[ct]||0)+1;});
  var mi=Math.max.apply(null,Object.keys(ids).map(function(k){return ids[k];}));
  var mc=Math.max.apply(null,Object.keys(cats).map(function(k){return cats[k];}));
  if(mi>=3){idDup++;if(ex.length<6)ex.push('轮'+s+'  '+names.join(' / '));}
  if(mc>=4)catDup++;
}
console.log('一轮四顿里 ≥3 顿用同一样主料:'+idDup+'/100');
console.log('一轮四顿里 4 顿全是同一类(禽肉/水产…):'+catDup+'/100');
ex.forEach(function(x){console.log('   '+x);});
console.log('\n400 顿的主蛋白源类别分布:');
Object.keys(allCat).sort(function(a,b){return allCat[b]-allCat[a];}).forEach(function(k){
  console.log('   '+k+'  '+allCat[k]+' 顿  '+Math.round(allCat[k]/4)+'%');});
