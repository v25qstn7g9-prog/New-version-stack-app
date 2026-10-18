/* Pure, bounded full-viewport pair planner. CSS pixels; points are footprint top-left.
 * No DOM reads, storage or timers. Runtime must re-plan when layout/obstacles change.
 * Protect and forbid are both hard obstacles. Failure never permits unsafe travel. */
(function (root) {
  'use strict';
  const clamp = (n,a,b) => Math.max(a,Math.min(b,n));
  const finite = (n,f=0) => Number.isFinite(n) ? n : f;
  const distance = (a,b) => Math.hypot(a.x-b.x,a.y-b.y);
  function normalizeLayout(raw={}) {
    const width=Math.max(0,finite(raw.width,finite(raw.w))),height=Math.max(0,finite(raw.height,finite(raw.h)));
    const margin=Math.max(0,finite(raw.margin,8));
    const scale=Math.min(1,Math.max(.72,(width-2*margin)/300));
    const footprint={w:Math.max(1,finite(raw.footprint?.w,150*scale)),h:Math.max(1,finite(raw.footprint?.h,65*scale))};
    const minX=margin+Math.max(0,finite(raw.safeLeft)),minY=margin+Math.max(0,finite(raw.safeTop));
    const maxX=width-margin-Math.max(0,finite(raw.safeRight))-footprint.w;
    const maxY=height-margin-Math.max(0,finite(raw.safeBottom))-footprint.h;
    const rects = list => (Array.isArray(list)?list:[]).map(r=>({x:finite(r.x,finite(r.left)),y:finite(r.y,finite(r.top)),w:Math.max(0,finite(r.w,finite(r.width))),h:Math.max(0,finite(r.h,finite(r.height)))})).filter(r=>r.w>0&&r.h>0);
    const protect=rects(raw.protect),forbid=rects(raw.forbid);
    const runThreshold=Math.max(0,finite(raw.runThreshold,Math.max(90,footprint.w*3)));
    return {width,height,footprint,runThreshold,minX,minY,maxX,maxY,protect,forbid,obstacles:protect.concat(forbid),normalized:true};
  }
  const layout = l => l?.normalized ? l : normalizeLayout(l);
  const overlaps = (a,b) => a.x < b.x+b.w && a.x+a.w > b.x && a.y < b.y+b.h && a.y+a.h > b.y;
  function legalBox(l,b) {
    return b.x>=l.minX-1e-7 && b.y>=l.minY-1e-7 && b.x+b.w<=l.maxX+l.footprint.w+1e-7 && b.y+b.h<=l.maxY+l.footprint.h+1e-7 && !l.obstacles.some(r=>overlaps(b,r));
  }
  function isLegalPosition(raw,p) {
    const l=layout(raw);
    return !!p && Number.isFinite(p.x) && Number.isFinite(p.y) && legalBox(l,{x:p.x,y:p.y,...l.footprint});
  }
  function findTargets(raw) {
    const l=layout(raw); if(l.maxX<l.minX||l.maxY<l.minY)return [];
    const candidates=[];
    for(let y=0;y<=8;y++)for(let x=0;x<=8;x++)candidates.push({x:l.minX+(l.maxX-l.minX)*x/8,y:l.minY+(l.maxY-l.minY)*y/8});
    // At most 81 + 96*8 candidates. Sample obstacle edges across the complete
    // obstacle list without multiplying every x edge by every y edge.
    const count=Math.min(96,l.obstacles.length);
    for(let i=0;i<count;i++) {
      const r=l.obstacles[Math.floor(i*l.obstacles.length/count)];
      const left=r.x-l.footprint.w-2,right=r.x+r.w+2,top=r.y-l.footprint.h-2,bottom=r.y+r.h+2;
      const midX=(left+right)/2,midY=(top+bottom)/2;
      for(const [x,y] of [[left,top],[right,top],[left,bottom],[right,bottom],[left,midY],[right,midY],[midX,top],[midX,bottom]])candidates.push({x,y});
    }
    const seen=new Set(),out=[];
    for(const p of candidates){const key=p.x+','+p.y;if(!seen.has(key)){seen.add(key);if(isLegalPosition(l,p))out.push(p);}}
    if(out.length<=192)return out;
    return Array.from({length:192},(_,i)=>out[Math.floor(i*(out.length-1)/191)]);
  }
  function findRowTargets(raw,y) {
    const l=layout(raw);
    if(!Number.isFinite(y)||y<l.minY||y>l.maxY||l.maxX<l.minX)return [];
    const xs=[];
    for(let i=0;i<=16;i++)xs.push(l.minX+(l.maxX-l.minX)*i/16);
    for(const r of l.obstacles.slice(0,96))xs.push(r.x-l.footprint.w-2,r.x+r.w+2);
    return [...new Set(xs)].sort((a,b)=>a-b).map(x=>({x,y})).filter(p=>isLegalPosition(l,p));
  }
  function chooseTarget(raw,current,history=[],rng=Math.random) {
    const l=layout(raw),targets=findTargets(l); if(!targets.length)return null;
    const diagonal=Math.max(1,Math.hypot(l.width,l.height));
    let best=null,score=-Infinity;
    for(const p of targets) {
      const d=current?distance(p,current):diagonal;
      const recent=history.slice(-8);
      const novelty=recent.length?Math.min(...recent.map(q=>distance(p,q))):diagonal;
      const value=.45*Math.min(d/diagonal,1)+.55*Math.min(novelty/diagonal,1)+finite(rng(),0)*.08-(d<l.footprint.w?1:0);
      if(value>score){score=value;best=p;}
    }
    return best;
  }
  const eased = t => t*t*(3-2*t);
  function at(s,u) {
    return {x:s.from.x+(s.to.x-s.from.x)*u,y:s.from.y+(s.to.y-s.from.y)*u-4*s.arc*u*(1-u)};
  }
  // Exact extrema of the quadratic on a short parameter interval. The swept
  // footprint box conservatively encloses every point, including between frames.
  function swept(l,s,a,b) {
    const p=at(s,a),q=at(s,b);let low=Math.min(p.y,q.y),high=Math.max(p.y,q.y);
    if(s.arc>0){const vertex=(4*s.arc-(s.to.y-s.from.y))/(8*s.arc);if(vertex>a&&vertex<b){const y=at(s,vertex).y;low=Math.min(low,y);high=Math.max(high,y);}}
    return {x:Math.min(p.x,q.x),y:low,w:Math.abs(q.x-p.x)+l.footprint.w,h:high-low+l.footprint.h};
  }
  function segmentSafe(l,s) {
    if(!s || !Number.isFinite(s.arc) || s.arc<0 || !Number.isFinite(s.duration) || s.duration<=0)return false;
    if(!isLegalPosition(l,s.from)||!isLegalPosition(l,s.to))return false;
    const bounds=swept(l,s,0,1);
    if(bounds.x<l.minX-1e-7||bounds.y<l.minY-1e-7||bounds.x+bounds.w>l.maxX+l.footprint.w+1e-7||bounds.y+bounds.h>l.maxY+l.footprint.h+1e-7)return false;
    const nearby=l.obstacles.filter(r=>overlaps(bounds,r));
    if(!nearby.length)return true;
    // A horizontal swept box is exact, so a hit cannot be escaped between samples.
    if(s.arc===0&&s.from.y===s.to.y)return false;
    const count=Math.ceil((distance(s.from,s.to)+4*s.arc)/2)+1;
    for(let i=0;i<count;i++){
      const box=swept(l,s,i/count,(i+1)/count);
      if(nearby.some(r=>overlaps(box,r)))return false;
    }
    return true;
  }
  function makeSegment(l,from,to) {
    const d=distance(from,to),hop=Math.abs(to.y-from.y)>1e-7;
    const kind=hop?'hop':d>l.runThreshold?'run':'walk';
    const arc=hop?clamp(d*.1,18,52):0;
    const s={from:{x:from.x,y:from.y},to:{x:to.x,y:to.y},kind,arc,duration:hop?clamp(.8+d/400,.9,2.4):Math.max(.2,d/(kind==='run'?150:70))};
    return segmentSafe(l,s)?s:null;
  }
  function planRoute(raw,from,to,options={}) {
    const l=layout(raw);
    const fail=reason=>({ok:false,reason,fallback:isLegalPosition(l,from)?'remain':'hide',segments:[],duration:0,from,to});
    if(!isLegalPosition(l,from))return fail('unsafe-start');
    if(!isLegalPosition(l,to))return fail('unsafe-target');
    const finish=segments=>({ok:true,segments,duration:segments.reduce((n,s)=>n+s.duration,0),from:{...from},to:{...to}});
    if(options.waypoints){
      if(!Array.isArray(options.waypoints)||options.waypoints.length>24)return fail('invalid-waypoints');
      const points=[from,...options.waypoints,to],segments=[];
      for(let i=1;i<points.length;i++){if(!isLegalPosition(l,points[i]))return fail('unsafe-waypoint');const s=makeSegment(l,points[i-1],points[i]);if(!s)return fail('blocked-waypoint-path');segments.push(s);}
      return finish(segments);
    }
    const direct=makeSegment(l,from,to);if(direct)return finish([direct]);
    if(options.directOnly)return fail('blocked-direct-path');
    const targets=findTargets(l),limit=clamp(finite(options.maxNodes,64),8,96);
    const nodes=[from,to];
    for(let i=0;i<Math.min(targets.length,limit);i++)nodes.push(targets[Math.floor(i*targets.length/Math.min(targets.length,limit))]);
    // Include horizontal alignment points: walks do not invent diagonal ground.
    for(const p of [{x:from.x,y:to.y},{x:to.x,y:from.y}])if(isLegalPosition(l,p))nodes.push(p);
    const costs=nodes.map(()=>Infinity),prev=[],edges=[],visited=new Set();costs[0]=0;
    for(let iteration=0;iteration<nodes.length;iteration++) {
      let index=-1;for(let i=0;i<nodes.length;i++)if(!visited.has(i)&&(index<0||costs[i]<costs[index]))index=i;
      if(index<0||!Number.isFinite(costs[index]))break;
      if(index===1){const path=[];for(let n=1;n!==0;n=prev[n])path.unshift(edges[n]);return finish(path);}
      visited.add(index);
      for(let j=1;j<nodes.length;j++)if(!visited.has(j)){
        const s=makeSegment(l,nodes[index],nodes[j]);if(!s)continue;
        const cost=costs[index]+s.duration+.2;if(cost<costs[j]){costs[j]=cost;prev[j]=index;edges[j]=s;}
      }
    }
    return fail('no-safe-route');
  }
  function sampleRoute(route,elapsed) {
    if(!route?.ok||!route.segments?.length)return null;
    let t=clamp(finite(elapsed),0,route.duration),s=route.segments[route.segments.length-1];
    // A rounded sum can exceed the last duration by a fraction of a pixel's
    // travel time. Never subtract the final segment and jump back to its start.
    for(const candidate of route.segments){s=candidate;if(t<=s.duration||candidate===route.segments[route.segments.length-1])break;t-=s.duration;}
    const progress=clamp(t/s.duration,0,1);
    const phase=s.kind==='hop'?(progress<.12?'crouch':progress<.25?'takeoff':progress<.78?'air':'landing'):s.kind;
    const u=eased(s.kind==='hop'?clamp((progress-.12)/.76,0,1):progress);
    return {...at(s,u),kind:s.kind,phase,progress,travelProgress:u,facing:s.to.x>=s.from.x?1:-1};
  }
  function validateRoute(raw,route) {
    const l=layout(raw);if(!route?.ok||!route.segments?.length)return false;
    for(let i=0;i<route.segments.length;i++){
      const s=route.segments[i];if(!segmentSafe(l,s))return false;
      if(i&&distance(route.segments[i-1].to,s.from)>1e-7)return false;
    }
    return true;
  }
  root.__zaCatSpaceCore=Object.freeze({normalizeLayout,isLegalPosition,findTargets,findRowTargets,chooseTarget,planRoute,sampleRoute,validateRoute});
})(typeof window==='undefined'?globalThis:window);
