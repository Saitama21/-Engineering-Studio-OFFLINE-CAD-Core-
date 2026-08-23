// ROZFOOD Engineering Studio v6.0.0 — Drawing View Topology Core
// Builds orthographic/isometric drawing edge candidates from healed, oriented B-Rep topology.
// The mesh/tessellation remains evidence only; the drawing decision is made from Face/Edge topology.

import {reconstructTopologicalBRep} from '../core/topological-brep-reconstruction.js';
import {healTopologicalBRep} from '../core/topology-healing-core.js';
import {orientTopologicalBRep} from '../core/brep-orientation-core.js';
import {reconstructSurfaceModel,surfaceBoundaryDecision} from '../core/surface-type-reconstruction.js';

const dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const sub=(a,b)=>[a[0]-b[0],a[1]-b[1],a[2]-b[2]];
const len=a=>Math.hypot(a[0],a[1],a[2]);
const norm=a=>{const L=len(a)||1;return[a[0]/L,a[1]/L,a[2]/L]};
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const cache=new WeakMap();

function orientedFaceMap(rec){
  const O=orientTopologicalBRep(rec),m=new Map();
  for(const f of O.faces||[])m.set(f.faceId,f);
  return{O,m};
}
function faceById(B){const m=new Map();for(const f of B.faces||[])m.set(f.id,f);return m}
function edgePoints(e){const p=e?.samplePoints||[];return p.length>=2?p:[]}
function angleCosDeg(deg){return Math.cos(deg*Math.PI/180)}
function frontSign(n,d,eps){const x=dot(n,d);return x>eps?1:x<-eps?-1:0}
function edgeLength(points){let L=0;for(let i=1;i<points.length;i++)L+=len(sub(points[i],points[i-1]));return L}
function splitEdge(e,kind,meta){
  const pts=edgePoints(e),out=[];
  for(let i=1;i<pts.length;i++){
    if(len(sub(pts[i],pts[i-1]))<1e-9)continue;
    out.push({a:pts[i-1],b:pts[i],kind,componentId:e.componentId,topologyEdgeId:e.id,faceIds:[...(e.faces||[])],faceKeys:[...(e.faceKeys||[])],curveType:e.curveType,topologyRole:meta.role,topologyConfidence:meta.confidence,frontFaces:meta.frontFaces,backFaces:meta.backFaces,contributors:[{topologyEdgeId:e.id,componentId:e.componentId,kind,role:meta.role}]});
  }
  return out;
}

export function buildDrawingViewTopology(rec,viewDir,{creaseDeg=10,tangentDeg=.8,faceEpsilon=1e-5,minEdgeLength=0}={}){
  const d=norm(viewDir),B=reconstructTopologicalBRep(rec),H=healTopologicalBRep(rec),S=reconstructSurfaceModel(rec),{O,m:oriented}=orientedFaceMap(rec);
  const sig=[rec?.faces?.length||0,B.counts?.edges||0,H.counts?.healedAdjacencyEdges||0,O.counts?.faces||0,d.map(x=>x.toFixed(5)).join(',')].join('|');
  let byDir=cache.get(rec);if(!byDir){byDir=new Map();cache.set(rec,byDir)}if(byDir.has(sig))return byDir.get(sig);
  const faces=faceById(B),creaseCos=angleCosDeg(creaseDeg),tangentCos=angleCosDeg(tangentDeg),edges=[];
  let boundary=0,silhouette=0,feature=0,tangentSuppressed=0,surfaceSuppressed=0,ambiguous=0,backOnly=0,topologyCandidates=0,degenerate=0;

  for(const e of B.edges||[]){
    const pts=edgePoints(e);if(pts.length<2||edgeLength(pts)<=minEdgeLength){degenerate++;continue}
    topologyCandidates++;
    const ids=(e.faces||[]).filter(Number.isInteger),fs=ids.map(id=>faces.get(id)).filter(Boolean),ons=ids.map(id=>oriented.get(id)).filter(Boolean);
    let kind='FEATURE',role='topology-feature',confidence=.8,frontFaces=0,backFaces=0;
    const signed=ons.map(f=>{const s=frontSign(f.normal,d,faceEpsilon);if(s>0)frontFaces++;else if(s<0)backFaces++;return s});

    if(ids.length<=1){
      kind='BOUNDARY';role='open-boundary';confidence=.88;boundary++;
      if(frontFaces===0&&backFaces>0)backOnly++;
    }else{
      // Surface semantics first: G1/continuous boundaries must not become drawing edges.
      const keys=fs.map(f=>f.faceKey).filter(Boolean);
      if(keys.length>=2){
        const dec=surfaceBoundaryDecision(rec,keys);
        if(dec?.draw===false){surfaceSuppressed++;continue}
        if(Number.isFinite(dec?.confidence))confidence=clamp(dec.confidence,.3,1);
      }
      let hasOpposite=false,sharpest=1;
      for(let i=0;i<ons.length;i++)for(let j=i+1;j<ons.length;j++){
        const ni=ons[i].normal,nj=ons[j].normal,co=clamp(dot(ni,nj),-1,1);sharpest=Math.min(sharpest,co);
        const si=signed[i],sj=signed[j];if((si>0&&sj<0)||(si<0&&sj>0))hasOpposite=true;
      }
      if(hasOpposite){kind='SILHOUETTE';role='brep-silhouette';confidence=Math.max(confidence,.94);silhouette++}
      else if(sharpest<tangentCos&&sharpest<creaseCos){kind='FEATURE';role='sharp-topology-edge';feature++}
      else if(sharpest<tangentCos){kind='FEATURE';role='form-edge';confidence=Math.min(confidence,.75);feature++}
      else {tangentSuppressed++;continue}
      if(frontFaces===0&&backFaces>0)backOnly++;
      if(ons.length<ids.length)ambiguous++;
    }
    edges.push(...splitEdge(e,kind,{role,confidence,frontFaces,backFaces}));
  }

  const topologyUsable=(B.counts?.edges||0)>0&&(B.coverage??0)>.5&&(O.counts?.faces||0)>0;
  const result={version:'6.0.0',kernel:'ROZFOOD Drawing View Topology Core',edges,topologyUsable,stats:{topologyUsable,inputTopologyEdges:B.counts?.edges||0,outputSegments:edges.length,boundary,silhouette,feature,tangentSuppressed,surfaceSuppressed,ambiguous,backOnly,degenerate,healedAdjacencyEdges:H.counts?.healedAdjacencyEdges||0,orientedFaces:O.counts?.faces||0,closedShells:B.counts?.closedShells||0,surfaceTypes:S.counts?.surfaces||0,creaseDeg,tangentDeg},note:'Visible/form edge candidates are classified from oriented Face adjacency. Raster/mesh HLR is still used only after topology classification for occlusion.'};
  byDir.set(sig,result);rec.drawingViewTopology=result;return result;
}

export function drawingViewTopologyEdges(rec,viewDir,opts){return buildDrawingViewTopology(rec,viewDir,opts).edges}
export function drawingViewTopologyStats(rec,viewDir,opts){return buildDrawingViewTopology(rec,viewDir,opts).stats}
