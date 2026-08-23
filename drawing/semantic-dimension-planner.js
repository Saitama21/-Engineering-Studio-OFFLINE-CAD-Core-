// ROZFOOD Engineering Studio v10.0.0 — Semantic Dimension Planner
// Produces a prioritized, de-duplicated engineering dimension plan from recognized geometry.
const finite=x=>Number.isFinite(x);
const uniq=(items,tol=.6)=>{const out=[];for(const x of items)if(finite(x.value)&&!out.some(y=>Math.abs(y.value-x.value)<=tol&&y.kind===x.kind))out.push(x);return out};
export function planDrumDimensions(rec,drum,composition){
  const L=drum.L||0,body=drum.body,chain=drum.chain?.segments||[],small=drum.smallSegments||[];
  const top=[{id:'overall-length',kind:'length',value:L,priority:100,lane:composition.lanes.topOverall[0],semantic:'overall'}];
  if(body){top.push({id:'working-length',kind:'length',value:body.length,priority:95,lane:composition.lanes.topOverall[1],semantic:'working'});if(body.left>2)top.push({id:'left-overhang',kind:'length',value:body.left,priority:70,lane:composition.lanes.topOverall[2],semantic:'overhang'});if(body.right>2)top.push({id:'right-overhang',kind:'length',value:body.right,priority:70,lane:composition.lanes.topOverall[2],semantic:'overhang'})}
  const chainDims=chain.filter(x=>x>3).slice(0,10).map((value,i)=>({id:`chain-${i}`,kind:'length',value,priority:55,lane:composition.lanes.topChain[i%composition.lanes.topChain.length],semantic:'chain'}));
  const end=uniq([drum.innerBore,drum.midBore,drum.outerDiameter].filter(finite).map((value,i)=>({id:`end-dia-${i}`,kind:'diameter',value,priority:100-i*5,lane:composition.lanes.endBottom[i%composition.lanes.endBottom.length],semantic:i===2?'outside':'bore'})),.8);
  const shell=uniq((drum.shellDiameters||[]).filter(d=>d>drum.D*.9).slice(0,4).map((value,i)=>({id:`shell-dia-${i}`,kind:'diameter',value,priority:90-i*5,lane:composition.lanes.mainLeft[i%composition.lanes.mainLeft.length],semantic:'shell'})),.8);
  const local=small.filter(x=>x.length>=8&&x.length<=180).sort((a,b)=>b.length-a.length).slice(0,6).map((x,i)=>({id:`local-${i}`,kind:'length',value:x.length,a:x.a,b:x.b,priority:45,lane:composition.lanes.mainBottom[i%composition.lanes.mainBottom.length],semantic:'local'}));
  if(finite(drum.spiralPitch)&&drum.spiralPitch>0)local.push({id:'pitch',kind:'pitch',value:drum.spiralPitch,priority:80,lane:composition.lanes.mainBottom.at(-1),semantic:'helical-pitch'});
  const all=[...top,...chainDims,...end,...shell,...local].sort((a,b)=>b.priority-a.priority);
  return {version:'10.0.0',kernel:'ROZFOOD Semantic Dimension Planner',top,chain:chainDims,end,shell,local,all,counts:{total:all.length,overall:top.length,chain:chainDims.length,diameters:end.length+shell.length,local:local.length},note:'Dimensions are derived from recognized engineering semantics and allocated to composer lanes; duplicate values are suppressed by type/tolerance.'};
}
