// 敏感度测试:包装规格全是估计值,那基于它算出来的浪费率还有意义吗?
// 做法:把所有包装规格随机扰动 ±X%,看结论会不会翻。
var path=require('path'), APP=path.join(__dirname,'..','..','app');
global.INGREDIENTS=require(path.join(APP,'data/ingredients.js'));
global.RECIPES=require(path.join(APP,'data/recipes.js'));
global.PACKAGES=require(path.join(APP,'data/packages.js'));
var db={}; global.Store={get:(k,f)=>db[k]!==undefined?db[k]:(f===undefined?null:f),set:(k,v)=>db[k]=v};
global.Equipment=require(path.join(APP,'core/equipment.js'));
global.Catalog=require(path.join(APP,'core/catalog.js'));
global.Packaging=require(path.join(APP,'core/packaging.js'));
global.Pantry=require(path.join(APP,'core/pantry.js'));
global.Nutrition=require(path.join(APP,'core/nutrition.js'));
var Profile=require(path.join(APP,'core/profile.js'));
var Solver=require(path.join(APP,'core/solver.js'));

var origSmallest = Packaging.smallest;
function perturb(pct, seed){
  var s=seed;
  var rnd=function(){ s=(s*1103515245+12345)%2147483648; return s/2147483648; };
  var cache={};
  Packaging.smallest = function(id){
    if(cache[id]!==undefined) return cache[id];
    var o = origSmallest(id);
    if(o){ o = Object.assign({}, o, { netWeight: Math.max(20, Math.round(o.netWeight*(1+(rnd()*2-1)*pct))) }); }
    cache[id]=o; return o;
  };
}
function restore(){ Packaging.smallest = origSmallest; }

var me={sex:'male',age:32,heightCm:175,weightKg:72,activity:'sedentary',goal:'maintain',breakfast:'normal'};
var target=Profile.perPlannedMeal(Profile.dailyTargets(me), me.breakfast);
var full=['炒锅','汤锅','不粘锅','蒸架','空气炸锅','砂锅','电饭煲','烤箱','电压力锅'];

function measure(servings, trials){
  var out=[];
  for(var i=0;i<trials;i++){
    db.staples=null; Pantry.ensureInit();
    var r=Solver.solve({servings:servings,
      constraints:{equipment:full,maxSpicy:2,maxActiveMinutes:30,blacklist:[]},
      stock:{},mustUse:[],stockDetail:[],target:target,seed:i*7919+servings});
    if(r.ok) out.push(r.wasteRatio);
  }
  out.sort((a,b)=>a-b);
  return {n:out.length, med:out[Math.floor(out.length/2)]||0,
          avg:out.reduce((a,b)=>a+b,0)/(out.length||1)};
}

console.log('包装规格扰动对「浪费率」结论的影响\n');
console.log('扰动幅度   2份中位   4份中位   8份中位   「2份最差」这个结论还成立吗');
[0,0.1,0.2,0.3,0.5].forEach(function(p){
  var rows=[];
  [2,4,8].forEach(function(n){
    var acc=[];
    for(var k=0;k<5;k++){ if(p>0) perturb(p, 12345+k*977); else restore(); acc.push(measure(n,12).med); }
    restore();
    acc.sort((a,b)=>a-b);
    rows.push(acc[Math.floor(acc.length/2)]);
  });
  var holds = rows[0] > rows[1];
  console.log('  ±'+String(Math.round(p*100)).padStart(3)+'%    '+
    rows.map(function(x){return (x*100).toFixed(0)+'%';}).map(function(x){return x.padStart(6);}).join('   ')+
    '     '+(holds?'✓ 成立':'✗ 翻了'));
});
