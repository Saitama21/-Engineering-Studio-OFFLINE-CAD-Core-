export function drawingFromRecognition(rec, dims){
  const b=rec.bounds, sx=b.size[0]||1, sy=b.size[1]||1;
  const circles=rec.edges.filter(e=>e.kind==='circle' && Math.abs(Math.abs(e.placement.axis?.[2]||0)-1)<0.01).map(e=>({cx:e.placement.origin[0],cy:e.placement.origin[1],r:e.radius}));
  return {bounds:b, circles, dimensions:dims, width:sx, height:sy};
}

export function renderDrawing(svg, drawing){
  if(!drawing){svg.innerHTML='<text x="50" y="70" fill="#7f93aa">Нет распознанной модели</text>';return}
  const W=1000,H=650,pad=110,b=drawing.bounds; const sx=b.size[0]||1,sy=b.size[1]||1,scale=Math.min((W-2*pad)/sx,(H-2*pad)/sy); const ox=(W-sx*scale)/2-b.min[0]*scale, oy=(H+sy*scale)/2+b.min[1]*scale;
  const X=x=>ox+x*scale,Y=y=>oy-y*scale;
  let s=`<defs><marker id="arr" markerWidth="7" markerHeight="7" refX="4" refY="3.5" orient="auto-start-reverse"><path d="M0 0L7 3.5L0 7z" fill="#62c6ff"/></marker></defs><rect width="1000" height="650" fill="#fbfcfe"/><rect x="18" y="18" width="964" height="614" fill="none" stroke="#17212b" stroke-width="2"/>`;
  s+=`<g stroke="#111a24" fill="none" stroke-width="2">`;
  if(drawing.circles.length){for(const c of drawing.circles)s+=`<circle cx="${X(c.cx)}" cy="${Y(c.cy)}" r="${c.r*scale}"/>`}
  else s+=`<rect x="${X(b.min[0])}" y="${Y(b.max[1])}" width="${sx*scale}" height="${sy*scale}"/>`;
  s+='</g>';
  const yDim=H-58,x1=X(b.min[0]),x2=X(b.max[0]);
  s+=`<g stroke="#2588c7" fill="#195d86" font-family="ui-monospace,monospace" font-size="18"><line x1="${x1}" y1="${yDim}" x2="${x2}" y2="${yDim}" marker-start="url(#arr)" marker-end="url(#arr)"/><line x1="${x1}" y1="${Y(b.min[1])}" x2="${x1}" y2="${yDim+8}"/><line x1="${x2}" y1="${Y(b.min[1])}" x2="${x2}" y2="${yDim+8}"/><text x="${(x1+x2)/2}" y="${yDim-10}" text-anchor="middle">${sx.toFixed(3)} mm</text></g>`;
  let ty=48; for(const d of drawing.dimensions.slice(0,8)){s+=`<text x="45" y="${ty}" fill="#24384a" font-size="15" font-family="ui-monospace,monospace">${escapeXml(d.label)}</text>`;ty+=22}
  s+=`<g fill="#18212c" font-family="system-ui" font-size="14"><text x="720" y="590">ENGINEERING STUDIO</text><text x="720" y="612">Auto drawing · STEP B-Rep</text></g>`;
  svg.innerHTML=s;
}
function escapeXml(x){return String(x).replace(/[<>&"']/g,m=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[m]))}
