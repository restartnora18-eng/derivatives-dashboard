import { formatBeijing } from './time.js?v=english-1';
const DAY = 86400000;
const money = value => Number(value).toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2});
export function createAssetsChart(canvas, {onHover=()=>{}}={}) {
  let records=[], initial=0, range='all', visible=[], hover=-1;
  const inRange = point => {
    if(range==='all')return true;
    const now=Date.now();
    const since=range==='today'?Math.floor((now+8*3600000)/DAY)*DAY-8*3600000:now-Number(range)*DAY;
    return point.time>=since;
  };
  function draw() {
    visible=records.filter(inRange);
    const bounds=canvas.getBoundingClientRect(),w=bounds.width,h=bounds.height,dpr=window.devicePixelRatio||1;
    canvas.width=Math.max(1,Math.round(w*dpr));canvas.height=Math.max(1,Math.round(h*dpr));
    const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
    const left=w<500?65:85,right=22,top=18,bottom=h-28,width=w-left-right;
    ctx.font='11px sans-serif';ctx.fillStyle='#8a9bac';
    if(!visible.length){ctx.textAlign='center';canvas.setAttribute('aria-label','Equity: no data in this range');onHover('No saved samples in this range.');return;}
    const vals=visible.map(p=>Number(p.equity)),lo0=Math.min(initial,...vals),hi0=Math.max(initial,...vals),pad=Math.max(1,(hi0-lo0)*.15,Math.abs(initial)*.0001),lo=lo0-pad,hi=hi0+pad;
    let start=visible[0].time,end=visible.at(-1).time;
    if(start===end){start-=1800000;end+=1800000;}
    const x=t=>left+(t-start)/(end-start)*width,y=v=>bottom-(v-lo)/(hi-lo)*(bottom-top);
    for(let i=0;i<=2;i++){
      const value=lo+(hi-lo)*i/2,yy=y(value);
      ctx.strokeStyle='#24313f';ctx.beginPath();ctx.moveTo(left,yy);ctx.lineTo(w-right,yy);ctx.stroke();
      ctx.fillStyle='#8a9bac';ctx.textAlign='right';ctx.fillText(money(value),left-9,yy+4);
    }
    const segments=[];
    for(const point of visible){if(!segments.length||point.time-segments.at(-1).at(-1).time>90*60000)segments.push([]);segments.at(-1).push(point);}
    const gradient=ctx.createLinearGradient(0,top,0,bottom);gradient.addColorStop(0,'rgba(163,120,230,.28)');gradient.addColorStop(1,'rgba(163,120,230,.015)');
    for(const segment of segments){
      ctx.beginPath();segment.forEach((p,i)=>i?ctx.lineTo(x(p.time),y(Number(p.equity))):ctx.moveTo(x(p.time),y(Number(p.equity))));
      ctx.lineTo(x(segment.at(-1).time),bottom);ctx.lineTo(x(segment[0].time),bottom);ctx.closePath();ctx.fillStyle=gradient;ctx.fill();
      ctx.beginPath();segment.forEach((p,i)=>i?ctx.lineTo(x(p.time),y(Number(p.equity))):ctx.moveTo(x(p.time),y(Number(p.equity))));ctx.strokeStyle='#ad86ee';ctx.lineWidth=2;ctx.stroke();ctx.lineWidth=1;
      for(const p of segment.length<30?segment:[segment.at(-1)]){ctx.beginPath();ctx.arc(x(p.time),y(Number(p.equity)),3,0,Math.PI*2);ctx.fillStyle='#ad86ee';ctx.fill();}
    }
    ctx.fillStyle='#8a9bac';ctx.textAlign='left';ctx.fillText(formatBeijing(visible[0].time).slice(5,16),left,h-12);
    ctx.textAlign='right';if(visible.length>1)ctx.fillText(formatBeijing(visible.at(-1).time).slice(5,16),w-right,h-12);
    ctx.textAlign='left';
    canvas.setAttribute('aria-label',`Account equity, UTC+8, ${visible.length} samples; latest equity ${money(records.at(-1).equity)} USDT. Use arrow keys to inspect samples.`);
    if(hover>=0&&hover<visible.length){
      const point=visible[hover],xx=x(point.time),yy=y(Number(point.equity));ctx.strokeStyle='#6f8497';ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(xx,top);ctx.lineTo(xx,bottom);ctx.stroke();ctx.setLineDash([]);ctx.beginPath();ctx.arc(xx,yy,5,0,Math.PI*2);ctx.fillStyle='#e7edf5';ctx.fill();
      onHover(`${formatBeijing(point.time)} UTC+8 · Equity ${money(point.equity)} USDT · Net P&L ${money(Number(point.equity)-initial)} USDT`);
    }else onHover(`${visible.length} samples · UTC+8 · Hover or use arrow keys`);
  }
  canvas.addEventListener('pointermove',event=>{
    if(!visible.length)return;
    const r=canvas.getBoundingClientRect(),left=r.width<500?65:85,target=(event.clientX-r.left-left)/Math.max(1,r.width-left-22);
    const first=visible[0].time,last=visible.at(-1).time,t=first+Math.max(0,Math.min(1,target))*(last-first);
    hover=visible.reduce((best,p,i)=>Math.abs(p.time-t)<Math.abs(visible[best].time-t)?i:best,0);draw();
  });
  canvas.addEventListener('pointerleave',()=>{hover=-1;draw()});
  canvas.addEventListener('keydown',event=>{if(!visible.length||!['ArrowLeft','ArrowRight','Escape'].includes(event.key))return;event.preventDefault();hover=event.key==='Escape'?-1:Math.max(0,Math.min(visible.length-1,(hover<0?visible.length-1:hover)+(event.key==='ArrowLeft'?-1:1)));draw()});
  return {
    update(points,capital){records=points;initial=Number(capital);hover=-1;draw();},
    setRange(value){range=value;hover=-1;draw();},
    getVisible(){return visible;}
  };
}
