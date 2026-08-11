global.INGREDIENTS=require('../../app/data/ingredients.js');
global.RECIPES=require('../../app/data/recipes.js');
global.PACKAGES=require('../../app/data/packages.js');
var db={}; global.Store={get:(k,f)=>db[k]!==undefined?db[k]:(f===undefined?null:f),set:(k,v)=>db[k]=v};
global.Equipment=require('../../app/core/equipment.js');
global.Catalog=require('../../app/core/catalog.js');
global.Packaging=require('../../app/core/packaging.js');
global.Pantry=require('../../app/core/pantry.js');
// ⚠️ Nutrition 和 Meal 必须加载 —— solver.js 里配菜、主菜蛋白门槛、
//    份量缩放全在 `if (typeof Meal !== 'undefined')` 里面，不加就整块静默跳过。
global.Nutrition=require('../../app/core/nutrition.js');
global.Meal=require('../../app/core/meal.js');
const Solver=require('../../app/core/solver.js');
Pantry.ensureInit();
const nm=id=>{const i=INGREDIENTS.find(x=>x.id===id);return i?i.name:id};
function run(label, servings, cfg){
  const t0=Date.now();
  const r=Solver.solve({servings, constraints:cfg, stock:{}, mustUse:[]});
  const ms=Date.now()-t0;
  console.log('\n===== '+label+'  ('+servings+' 份, '+ms+'ms)');
  if(!r.ok){console.log('  失败:', r.reason); return;}
  console.log('  采购:');
  r.stage1.picks.forEach(p=>{const pl=p.plan;
    console.log('    '+nm(p.ingredientId).padEnd(10)+(pl?(pl.option.netWeight+pl.option.unit+' ×'+pl.packs+' = '+pl.total+'g'):'(库存)')+
    '  · 单菜均用'+p.perServing+'g · '+p.dishes+'道菜可用');});
  console.log('  菜:');
  r.stage2.chosen.forEach((c,i)=>console.log('    '+(i+1)+'. '+c.recipe.name.padEnd(16)+c.recipe.method+' · 活跃'+c.variant.activeMinutes+'分'+(c.missing?' · 缺'+c.missing+'调料':'')));
  const left=Object.entries(r.stage2.left).filter(([k,v])=>v>1);
  console.log('  生鲜浪费 '+(r.stage2.wasteRatio*100).toFixed(1)+'% (剩'+Math.round(r.stage2.freshLeft)+'g/买'+Math.round(r.stage2.freshBought)+'g) · 结转 '+Math.round(r.stage2.carryLeft)+'g · '+r.stage2.methodCount+' 种做法 · 剩: '+
    (left.map(([k,v])=>nm(k)+Math.round(v)+'g').join(' ')||'无'));
}
const base={equipment:['炒锅','汤锅','不粘锅','蒸架'],maxSpicy:2,maxActiveMinutes:30,blacklist:[]};
run('标准', 4, base);
run('一个人一天', 2, base);
run('两人两天', 8, base);
run('只有炒锅+不吃辣+20分钟', 4, {equipment:['炒锅'],maxSpicy:0,maxActiveMinutes:20,blacklist:[]});

// ---- 库存紧迫度:放久的鸡蛋会不会被优先排掉 ----
console.log('\n===== 库存紧迫度');
const now=new Date();
const iso=d=>new Date(now.getTime()+d*864e5).toISOString();
db.pantryItems=[
  {id:'a',ingredientId:'egg',amount:400,unit:'g',addedAt:iso(-25),expiresAt:iso(5),location:'fridge'},
  {id:'b',ingredientId:'napa_cabbage',amount:600,unit:'g',addedAt:iso(-11),expiresAt:iso(3),location:'fridge'},
  {id:'c',ingredientId:'potato',amount:400,unit:'g',addedAt:iso(-2),expiresAt:iso(28),location:'pantry'},
];
Pantry.stockSummary(now.toISOString()).forEach(a=>
  console.log('  '+a.name.padEnd(8)+Math.round(a.grams)+'g  紧迫度 '+a.urgency.toFixed(2)+'  剩 '+a.daysLeft+' 天'));
const stock={}; db.pantryItems.forEach(it=>stock[it.ingredientId]=(stock[it.ingredientId]||0)+it.amount);
const r2=Solver.solve({servings:4,constraints:base,stock:stock,mustUse:[],
                       stockDetail:Pantry.stockSummary(now.toISOString())});
console.log('  →', r2.stage1.picks.filter(p=>p.fromStock).map(p=>p.ing.name+'(紧迫'+(p.urgency||0).toFixed(2)+')').join(' · ')||'没有库存项被排进来');
console.log('  排的菜:', r2.stage2.chosen.map(c=>c.recipe.name).join(' · '));
const usedEgg=r2.stage2.chosen.some(c=>c.variant.ingredients.some(x=>x.ids.includes('egg')));
const usedCab=r2.stage2.chosen.some(c=>c.variant.ingredients.some(x=>x.ids.includes('napa_cabbage')));
console.log('  用到鸡蛋:'+usedEgg+'  用到大白菜:'+usedCab);
