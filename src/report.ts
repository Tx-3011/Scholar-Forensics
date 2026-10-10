// Interactive single-file dashboard. No external dependencies —
// everything is inline so out/report.html works from file:// too.
import type { ForensicsReport } from "./analyze.js";
import type { ScholarPaper } from "./serpapi.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function verdict(score: number): { label: string; cls: string } {
  if (score >= 0.55) return { label: "Cartel-like", cls: "bad" };
  if (score >= 0.3) return { label: "Worth a look", cls: "warn" };
  return { label: "Organic spread", cls: "good" };
}

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');
:root{--bg:#0F172A;--panel:rgba(27,35,54,.72);--panel2:#0e1420;--line:rgba(255,255,255,.09);--txt:#F8FAFC;--mut:#94A3B8;--cy:#22d3ee;--gn:#22C55E;--am:#f59e0b;--rd:#ef4444}
*{box-sizing:border-box;margin:0;padding:0}
body{background:radial-gradient(1200px 600px at 20% -10%,#16203a 0%,var(--bg) 55%) fixed,var(--bg);color:var(--txt);font-family:"Fira Sans",ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;line-height:1.5;min-height:100vh}
.mono,h1,.score-num,.stat .v{font-family:"Fira Code",ui-monospace,SFMono-Regular,Menlo,monospace}
.wrap{max-width:1060px;margin:0 auto;padding:2rem 1.25rem 4rem}
.eyebrow{font-size:.72rem;letter-spacing:.22em;color:var(--cy);text-transform:uppercase;margin-bottom:.4rem}
h1{font-size:1.65rem;line-height:1.25;font-weight:600;max-width:46rem;letter-spacing:-.01em}
.meta{color:var(--mut);margin-top:.5rem;font-size:.92rem}
.hero{display:grid;grid-template-columns:300px 1fr;gap:1rem;margin-top:1.6rem}
@media(max-width:760px){.hero{grid-template-columns:1fr}}
.card{background:var(--panel);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);border:1px solid var(--line);border-radius:14px;padding:1.1rem 1.25rem;box-shadow:inset 0 1px 0 rgba(255,255,255,.06),0 12px 32px rgba(0,0,0,.35);transition:transform .2s ease,box-shadow .2s ease,border-color .2s ease}
.card:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.16);box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 16px 40px rgba(0,0,0,.45)}
.gauge-card{display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center}
.gauge-card:hover{transform:none}
.score-num{font-size:2.6rem;font-weight:700;font-variant-numeric:tabular-nums}
.verdict{margin-top:.35rem;font-size:.8rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:.25rem .8rem;border-radius:999px}
.verdict.good{color:var(--gn);background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.35)}
.verdict.warn{color:var(--am);background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.35)}
.verdict.bad{color:var(--rd);background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.35)}
.gauge-sub{color:var(--mut);font-size:.8rem;margin-top:.5rem;max-width:15rem}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:1rem}
@media(max-width:760px){.stats{grid-template-columns:1fr}}
.stat .k{font-size:.75rem;color:var(--mut);text-transform:uppercase;letter-spacing:.1em}
.stat .v{font-size:1.7rem;font-weight:600;margin-top:.2rem;font-variant-numeric:tabular-nums}
.stat .d{font-size:.82rem;color:var(--mut);margin-top:.15rem}
h2.sec{font-size:1.05rem;margin:2rem 0 .8rem;display:flex;align-items:center;gap:.6rem;font-weight:600}
h2.sec::after{content:"";flex:1;height:1px;background:var(--line)}
#graph{width:100%;height:460px;border-radius:12px;background:radial-gradient(ellipse at center,#14203a 0%,#0b0f17 75%);cursor:grab;border:1px solid var(--line);display:block;touch-action:none}
#graph:focus-visible{outline:2px solid var(--cy);outline-offset:2px}
.legend{display:flex;gap:1.2rem;flex-wrap:wrap;margin-top:.6rem;font-size:.82rem;color:var(--mut)}
.dot{display:inline-block;width:.7rem;height:.7rem;border-radius:50%;margin-right:.35rem;vertical-align:baseline}
#tip{position:fixed;pointer-events:none;background:rgba(14,20,32,.95);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px);border:1px solid var(--line);border-radius:8px;padding:.55rem .7rem;font-size:.8rem;max-width:300px;display:none;z-index:50;box-shadow:0 8px 24px rgba(0,0,0,.5)}
#tip .tt{font-weight:600;margin-bottom:.15rem}#tip .tm{color:var(--mut)}
.vrow{display:flex;align-items:center;gap:.7rem;margin:.4rem 0}
.vlabel{width:16rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:.86rem}
.vtrack{flex:1;height:.65rem;background:rgba(255,255,255,.06);border-radius:99px;overflow:hidden}
.vfill{height:100%;background:linear-gradient(90deg,#16a34a,var(--gn));border-radius:99px;transition:width .6s ease}
.vval{width:3rem;text-align:right;color:var(--mut);font-size:.85rem;font-variant-numeric:tabular-nums;font-family:"Fira Code",monospace}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line)}
th{color:var(--mut);font-weight:600;font-size:.75rem;text-transform:uppercase;letter-spacing:.08em}
tbody tr{transition:background .15s ease}tbody tr:hover{background:rgba(255,255,255,.03)}
.yrow{display:flex;align-items:center;gap:.6rem;margin:.22rem 0}
.ylabel{width:3.4rem;color:var(--mut);font-size:.85rem;font-variant-numeric:tabular-nums;font-family:"Fira Code",monospace}
.ybar{height:.9rem;background:linear-gradient(90deg,#16a34a,var(--gn));border-radius:3px;min-width:2px}
.yval{color:var(--mut);font-size:.85rem}
.notes{background:rgba(245,158,11,.06);border:1px solid rgba(245,158,11,.3)}
.notes li{margin:.3rem 0 .3rem 1.1rem;font-size:.9rem}
ul.plain{list-style:none}ul.plain li{padding:.45rem 0;border-bottom:1px solid var(--line);font-size:.9rem}
ul.plain li:last-child{border-bottom:none}
.tag{display:inline-block;font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;border-radius:99px;padding:.12rem .55rem;margin-left:.5rem;vertical-align:middle}
.tag.self{color:var(--am);background:rgba(245,158,11,.12);border:1px solid rgba(245,158,11,.4)}
.tag.clique{color:var(--cy);background:rgba(34,211,238,.1);border:1px solid rgba(34,211,238,.35)}
.foot{margin-top:2.5rem;color:var(--mut);font-size:.78rem;text-align:center}
.method{font-size:.85rem;color:var(--mut)}
.method code{color:var(--txt);background:rgba(255,255,255,.06);padding:.1rem .35rem;border-radius:4px;font-size:.8rem;font-family:"Fira Code",monospace}
a{color:var(--cy)}button{cursor:pointer}
:focus-visible{outline:2px solid var(--cy);outline-offset:2px}
@media (prefers-reduced-motion: reduce){
  *,*::before,*::after{animation-duration:.01ms!important;transition-duration:.01ms!important}
  .card:hover{transform:none}
}
`;

const GRAPH_JS = `
(function(){
var canvas=document.getElementById('graph');if(!canvas)return;
var ctx=canvas.getContext('2d');
var W,H,dpr=Math.min(window.devicePixelRatio||1,2);
function resize(){W=canvas.clientWidth;H=canvas.clientHeight;canvas.width=W*dpr;canvas.height=H*dpr;ctx.setTransform(dpr,0,0,dpr,0,0);}
resize();window.addEventListener('resize',resize);
var nodes=window.__NODES__,links=window.__LINKS__;
var cx=W/2,cy=H/2;
nodes.forEach(function(n,i){if(n.fx!==undefined)return;var a=(i/nodes.length)*Math.PI*2,r=n.kind==='target'?0:150+Math.random()*60;n.x=cx+Math.cos(a)*r;n.y=cy+Math.sin(a)*r;n.vx=0;n.vy=0;});
var R=nodes[0].kind==='target'?16:9;
function tick(){
  for(var i=0;i<nodes.length;i++){var a=nodes[i];
    for(var j=i+1;j<nodes.length;j++){var b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d2=dx*dx+dy*dy||1,d=Math.sqrt(d2);
      var f=Math.min(9000/d2,4);a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
    a.vx+=(cx-a.x)*0.004;a.vy+=(cy-a.y)*0.004;}
  links.forEach(function(l){var a=nodes[l[0]],b=nodes[l[1]],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
    var want=l[2]||170,f=(d-want)*0.02;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;});
  nodes.forEach(function(n){if(n.drag){n.x=n.mx;n.y=n.my;n.vx=0;n.vy=0;return;}n.vx*=0.82;n.vy*=0.82;n.x+=n.vx;n.y+=n.vy;
    n.x=Math.max(24,Math.min(W-24,n.x));n.y=Math.max(24,Math.min(H-24,n.y));});
}
function color(n){if(n.kind==='target')return '#22d3ee';if(n.self&&n.clique)return '#f472b6';if(n.self)return '#f59e0b';if(n.clique)return '#a78bfa';return '#475569';}
function draw(){
  ctx.clearRect(0,0,W,H);
  links.forEach(function(l){var a=nodes[l[0]],b=nodes[l[1]];
    ctx.strokeStyle=l[3]==='clique'?'rgba(167,139,250,.45)':'rgba(148,163,184,.14)';ctx.lineWidth=l[3]==='clique'?1.4:1;
    ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);ctx.stroke();});
  nodes.forEach(function(n){var r=n.kind==='target'?15:8;
    ctx.beginPath();ctx.arc(n.x,n.y,r,0,7);ctx.fillStyle=color(n);ctx.globalAlpha=n.kind==='target'?1:.92;ctx.fill();ctx.globalAlpha=1;
    if(n.kind==='target'){ctx.strokeStyle='rgba(34,211,238,.5)';ctx.lineWidth=2;ctx.beginPath();ctx.arc(n.x,n.y,r+5,0,7);ctx.stroke();}});
  if(hover>=0){var n=nodes[hover];ctx.fillStyle='rgba(226,232,240,.85)';ctx.font='11px system-ui';ctx.textAlign='center';
    var label=n.label.length>42?n.label.slice(0,42)+'…':n.label;ctx.fillText(label,n.x,Math.max(12,n.y-20));}
}
var hover=-1,tip=document.getElementById('tip'),dragN=null;
function pos(e){var r=canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}
canvas.addEventListener('mousemove',function(e){var p=pos(e),mx=p[0],my=p[1];
  if(dragN){dragN.mx=mx;dragN.my=my;return;}
  hover=-1;for(var i=0;i<nodes.length;i++){var n=nodes[i],r=n.kind==='target'?15:8;
    if((n.x-mx)*(n.x-mx)+(n.y-my)*(n.y-my)<(r+6)*(r+6)){hover=i;break;}}
  if(hover>=0){var n2=nodes[hover];
    tip.innerHTML='<div class="tt">'+n2.label.replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</div><div class="tm">'+n2.sub+'</div>';
    tip.style.display='block';tip.style.left=(e.clientX+14)+'px';tip.style.top=(e.clientY+14)+'px';canvas.style.cursor='pointer';}
  else{tip.style.display='none';canvas.style.cursor='grab';}});
canvas.addEventListener('mouseleave',function(){hover=-1;tip.style.display='none';if(dragN){dragN.drag=false;dragN=null;}});
canvas.addEventListener('mousedown',function(e){var p=pos(e);
  for(var i=0;i<nodes.length;i++){var n=nodes[i],r=n.kind==='target'?15:8;
    if((n.x-p[0])*(n.x-p[0])+(n.y-p[1])*(n.y-p[1])<(r+8)*(r+8)){dragN=n;n.drag=true;n.mx=p[0];n.my=p[1];canvas.style.cursor='grabbing';break;}}});
window.addEventListener('mouseup',function(){if(dragN){dragN.drag=false;dragN=null;}});
var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
if(reduced){for(var s=0;s<400;s++)tick();draw();}
else{(function loop(){for(var k=0;k<3;k++)tick();draw();requestAnimationFrame(loop);})();}
})();
`;

export function renderDashboard(report: ForensicsReport, citers: ScholarPaper[], generatedAt = new Date()): string {
  const t = report.target;
  const v = verdict(report.cartelScore);

  // Graph data: node 0 = target; clique pairs linked.
  const cliqueAuthors = new Set(report.authorCliques.flatMap((c) => c.authors));
  const nodes = [
    { label: t.title, sub: "target paper · " + t.authors.slice(0, 3).join(", "), kind: "target" },
    ...citers.map((c) => ({
      label: c.title,
      sub: (c.rawAuthors || c.authors.join(", ")).slice(0, 80) + (c.year ? " · " + c.year : ""),
      kind: "citer",
      self: c.authors.some((a) => t.authors.includes(a)),
      clique: c.authors.some((a) => cliqueAuthors.has(a)),
    })),
  ];
  const links: [number, number, number, string][] = citers.map((_, i) => [0, i + 1, 190, "cite"] as [number, number, number, string]);
  const seen = new Set<string>();
  for (let i = 0; i < citers.length; i++) {
    for (let j = i + 1; j < citers.length; j++) {
      const shared = citers[i]!.authors.filter((a) => citers[j]!.authors.includes(a) && !t.authors.includes(a));
      if (shared.length >= 2) {
        const key = i + "-" + j;
        if (!seen.has(key)) { seen.add(key); links.push([i + 1, j + 1, 90, "clique"]); }
      }
    }
  }

  const venueRows = (() => {
    const m = new Map<string, number>();
    for (const c of citers) { const k = (c.venue ?? "unknown venue").toLowerCase(); m.set(k, (m.get(k) ?? 0) + 1); }
    const top = Math.max(...m.values(), 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([venue, count]) =>
      `<div class="vrow"><span class="vlabel">${esc(venue)}</span><div class="vtrack"><div class="vfill" style="width:${Math.round((count / top) * 100)}%"></div></div><span class="vval">${count}</span></div>`
    ).join("");
  })();

  const maxYear = Math.max(...report.yearHistogram.map((y) => y.count), 1);
  const yearBars = report.yearHistogram.map(({ year, count }) =>
    `<div class="yrow"><span class="ylabel">${year}</span><div class="ybar" style="width:${Math.max(2, Math.round((count / maxYear) * 320))}px"></div><span class="yval">${count}</span></div>`
  ).join("");

  const cliqueAuthorsSet = cliqueAuthors;
  const citerRows = citers.slice(0, 30).map((c) => {
    const self = c.authors.some((a) => t.authors.includes(a));
    const clq = c.authors.some((a) => cliqueAuthorsSet.has(a));
    const tags = `${self ? '<span class="tag self">self-cite</span>' : ""}${clq ? '<span class="tag clique">clique</span>' : ""}`;
    return `<tr><td>${esc(c.title)}${tags}</td><td>${esc((c.rawAuthors || c.authors.join(", ")).slice(0, 60))}</td><td>${c.year ?? "—"}</td><td>${esc((c.venue ?? "—").slice(0, 40))}</td></tr>`;
  }).join("");

  const selfCiteList = report.selfCite.papers.map((p) => `<li>${esc(p)}</li>`).join("");
  const notes = report.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forensics — ${esc(t.title.slice(0, 60))}</title><style>${CSS}</style></head>
<body><div class="wrap">
<div class="eyebrow">Scholar citation forensics</div>
<h1>${esc(t.title)}</h1>
<p class="meta">${esc(t.authors.join(", "))}${t.year ? " · " + t.year : ""}${t.venue ? " · " + esc(t.venue) : ""}${t.citedByTotal !== undefined ? ` · ~${t.citedByTotal.toLocaleString()} citations` : ""}</p>

<div class="hero">
  <div class="card gauge-card">
    <div class="k" style="font-size:.75rem;color:var(--mut);text-transform:uppercase;letter-spacing:.1em;margin-bottom:.6rem">Cartel score</div>
    <svg width="150" height="150" viewBox="0 0 150 150">
      <circle cx="75" cy="75" r="62" fill="none" stroke="#1e293b" stroke-width="11"/>
      <circle id="ring" cx="75" cy="75" r="62" fill="none" stroke="${v.cls === "good" ? "#22C55E" : v.cls === "warn" ? "#f59e0b" : "#ef4444"}" stroke-width="11" stroke-linecap="round" stroke-dasharray="389.5" stroke-dashoffset="389.5" transform="rotate(-90 75 75)" style="transition:stroke-dashoffset 1.2s ease"/>
      <text x="75" y="82" text-anchor="middle" fill="#e2e8f0" font-size="30" font-weight="700">${report.cartelScore.toFixed(2)}</text>
    </svg>
    <div class="verdict ${v.cls}">${v.label}</div>
    <div class="gauge-sub">cartel score · 0 organic → 1 cartel-like</div>
  </div>
  <div class="stats">
    <div class="card stat"><div class="k">Self-cite rate</div><div class="v">${Math.round(report.selfCite.rate * 100)}%</div><div class="d">${report.selfCite.count} of ${report.citersAnalyzed} citers share an author with the target</div></div>
    <div class="card stat"><div class="k">Venue concentration</div><div class="v">${Math.round(report.venueConcentration.topVenueShare * 100)}%</div><div class="d">of citers in “${esc(report.venueConcentration.topVenue)}” · ${report.venueConcentration.distinctVenues} venues total</div></div>
    <div class="card stat"><div class="k">Co-author cliques</div><div class="v">${report.authorCliques.length}</div><div class="d">citer groups sharing ≥2 authors across papers</div></div>
  </div>
</div>

<h2 class="sec">Citation graph</h2>
<div class="card">
<canvas id="graph" tabindex="0" role="img" aria-label="Interactive citation graph. Center node is the target paper; surrounding nodes are citing papers."></canvas>
<div class="legend">
<span><span class="dot" style="background:#22d3ee"></span>target paper</span>
<span><span class="dot" style="background:#475569"></span>citing paper</span>
<span><span class="dot" style="background:#f59e0b"></span>self-citation</span>
<span><span class="dot" style="background:#a78bfa"></span>co-author clique</span>
<span style="margin-left:auto">drag nodes · hover for details</span>
</div></div>
<div id="tip"></div>

<h2 class="sec">Venues</h2>
<div class="card">${venueRows || "<p class='meta'>No venue data.</p>"}</div>

<h2 class="sec">Citations by year</h2>
<div class="card">${yearBars || "<p class='meta'>No year data.</p>"}</div>

<h2 class="sec">Citing papers${citers.length > 30 ? " (top 30)" : ""}</h2>
<div class="card" style="overflow-x:auto"><table><tr><th>Title</th><th>Authors</th><th>Year</th><th>Venue</th></tr>${citerRows}</table></div>

${report.selfCite.count ? `<h2 class="sec">Self-citations</h2><div class="card"><ul class="plain">${selfCiteList}</ul></div>` : ""}

<div class="card notes"><h3 style="margin-bottom:.5rem">Analyst notes</h3><ul>${notes}</ul>
<p class="method" style="margin-top:.8rem">Method: <code>cartel = 0.45·selfCite + 0.30·venueShare + 0.25·cliqueDensity</code>. Author matching is surname-based; venue parsing is heuristic. Signals, not verdicts.</p></div>

<div class="foot">generated ${esc(generatedAt.toISOString())} · data: Google Scholar via SerpApi · sample of ${report.citersAnalyzed} citers</div>
</div>
<script>window.__NODES__=${JSON.stringify(nodes)};window.__LINKS__=${JSON.stringify(links)};</script>
<script>${GRAPH_JS}</script>
<script>document.getElementById('ring').style.strokeDashoffset=(389.5*(1-${report.cartelScore})).toFixed(1);</script>
</body></html>`;
}

