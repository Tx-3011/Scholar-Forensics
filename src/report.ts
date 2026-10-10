import { DESIGN_CSS, SITE_HEADER } from "./design.js";
// Interactive single-file dashboard. No external dependencies —
// everything is inline so out/report.html works from file:// too.
import type { ForensicsReport } from "./analyze.js";
import type { ScholarPaper } from "./serpapi.js";
import { normalizeVenue } from "./identity.js";
import type { Interpretation } from "./llm.js";
import { summarizeFinding } from "./finding.js";
import { assess } from "./assessment.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function safeUrl(url?: string): string | undefined {
  try { const parsed = new URL(url ?? ""); return ["https:", "http:"].includes(parsed.protocol) ? esc(parsed.href) : undefined; } catch { return undefined; }
}

function renderInterpretation(ai?: Interpretation): string {
  if (!ai) return "";
  if (ai.status !== "completed") return `<h2 class="sec">AI interpretation</h2><div class="card"><p>${esc(ai.message ?? "AI unavailable.")}</p></div>`;
  const sections = (["observations", "interpretations", "limitations", "nextSteps"] as const).map((key) => {
    const label = { observations: "Reported observations", interpretations: "AI inferences — verify", limitations: "Limitations", nextSteps: "Suggested verification steps" }[key];
    return `<h3 style="margin-top:1rem">${label}</h3><ul class="plain">${(ai[key] ?? []).map((claim) => `<li>${esc(claim.text)} ${claim.evidenceIds.map((id) => `<a href="#evidence-${esc(id)}">[${esc(id)}]</a>`).join(" ")}</li>`).join("")}</ul>`;
  }).join("");
  return `<h2 class="sec">AI interpretation</h2><div class="card"><p class="method">AI-generated · ${esc(ai.provider)} / ${esc(ai.model)} · ${esc(ai.generatedAt ?? "")}<br>Uses supplied metadata only, not full papers or citation passages. ${ai.requestInfo ? `Compact records for all ${ai.requestInfo.citationsSupplied} sampled citers · ${ai.requestInfo.attempts} request(s). ` : ""}References identify supplied evidence; they do not guarantee the inference is correct. No AI score or misconduct verdict.</p>${sections}
  <details style="margin-top:1rem"><summary>Evidence catalog and provenance</summary><p class="method">Prompt: ${esc(ai.promptVersion ?? "")} · tokens: ${ai.usage?.promptTokens ?? 0} input / ${ai.usage?.completionTokens ?? 0} output</p>${(ai.evidence ?? []).map((e) => `<div id="evidence-${esc(e.id)}" style="margin-top:1rem"><strong>${esc(e.id)}: ${esc(e.title)}</strong>${safeUrl(e.url) ? ` · <a href="${safeUrl(e.url)}" target="_blank" rel="noopener noreferrer">Source</a>` : ""}<pre style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.8rem">${esc(JSON.stringify(e.detail, null, 2))}</pre></div>`).join("")}</details></div>`;
}

const CSS = DESIGN_CSS;

const GRAPH_JS = `
(function(){
var canvas=document.getElementById('graph');if(!canvas)return;
var ctx=canvas.getContext('2d');
var nodes=window.__NODES__,links=window.__LINKS__;
var W,H,dpr,zoom=1,panX=0,panY=0,hover=-1,selected=0,gesture=null;
var picker=document.getElementById('graph-paper');
nodes.forEach(function(n,i){var option=document.createElement('option');option.value=String(i);option.textContent=(i===0?'Target: ':'')+n.label;picker.append(option);});
function layout(){
  nodes.forEach(function(n,i){var a=(i-1)/Math.max(nodes.length-1,1)*Math.PI*2-Math.PI/2;
    var r=Math.min(W,H)*(.32+(i%3)*.045);n.x=i?W/2+Math.cos(a)*r:W/2;n.y=i?H/2+Math.sin(a)*r:H/2;n.vx=0;n.vy=0;});
  // Settle once, rather than continuously moving the diagram under the reader.
  for(var step=0;step<240;step++){
    for(var i=1;i<nodes.length;i++){var a=nodes[i];
      for(var j=i+1;j<nodes.length;j++){var b=nodes[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.sqrt(dx*dx+dy*dy)||1;
        var f=Math.min(500/(d*d),2);a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;}
      var dx=a.x-W/2,dy=a.y-H/2,d=Math.sqrt(dx*dx+dy*dy)||1;
      var f=(d-Math.min(W,H)*.34)*.015;a.vx-=dx/d*f;a.vy-=dy/d*f;
    }
    links.forEach(function(l){if(l[3]!=='clique')return;var a=nodes[l[0]],b=nodes[l[1]],dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy)||1;
      var f=(d-72)*.008;a.vx+=dx/d*f;a.vy+=dy/d*f;b.vx-=dx/d*f;b.vy-=dy/d*f;});
    nodes.slice(1).forEach(function(n){n.vx*=.7;n.vy*=.7;n.x=Math.max(40,Math.min(W-40,n.x+n.vx));n.y=Math.max(48,Math.min(H-72,n.y+n.vy));});
  }
}
function resize(){var oldW=W,oldH=H;W=canvas.clientWidth;H=canvas.clientHeight;dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=W*dpr;canvas.height=H*dpr;
  if(oldW){nodes.forEach(function(n){n.x=n.x/oldW*W;n.y=n.y/oldH*H;});}else layout();draw();}
function color(n){if(n.kind==='target')return '#67d5e5';if(n.self&&n.clique)return '#e9a4cb';if(n.self)return '#edb76c';if(n.clique)return '#b5a0e8';return '#91a9c3';}
function screen(n){return [W/2+(n.x-W/2)*zoom+panX,H/2+(n.y-H/2)*zoom+panY];}
function connected(i,focus){return i===focus||links.some(function(l){return (l[0]===focus&&l[1]===i)||(l[1]===focus&&l[0]===i);});}
function label(text,x,y,max){ctx.font='11px "Fira Sans",system-ui';while(text.length>1&&ctx.measureText(text).width>max){text=text.slice(0,-2)+'…';}ctx.fillText(text,x,y);}
function draw(){
  ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,W,H);
  ctx.fillStyle='#2b4134';for(var x=16;x<W;x+=24)for(var y=16;y<H;y+=24){ctx.beginPath();ctx.arc(x,y,.7,0,Math.PI*2);ctx.fill();}
  var center=screen(nodes[0]);ctx.strokeStyle='#2b4134';ctx.lineWidth=1;ctx.setLineDash([3,7]);ctx.beginPath();ctx.arc(center[0],center[1],Math.min(W,H)*.34*zoom,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);
  var focus=hover>=0?hover:selected;
  links.forEach(function(l){var a=screen(nodes[l[0]]),b=screen(nodes[l[1]]),overlap=l[3]==='clique',active=l[0]===focus||l[1]===focus;
    ctx.globalAlpha=active?1:.25;ctx.strokeStyle=overlap?'#b5a0e8':(focus===0?'#3a5068':'#6c9bae');ctx.lineWidth=overlap?1.5:1;ctx.setLineDash(overlap?[4,4]:[]);
    var dx=b[0]-a[0],dy=b[1]-a[1],d=Math.sqrt(dx*dx+dy*dy)||1,ra=l[0]===0?25:12,rb=12;
    ctx.beginPath();ctx.moveTo(a[0]+dx/d*ra,a[1]+dy/d*ra);ctx.lineTo(b[0]-dx/d*rb,b[1]-dy/d*rb);ctx.stroke();});
  ctx.setLineDash([]);ctx.globalAlpha=1;
  nodes.forEach(function(n,i){var p=screen(n),r=i===0?20:8,active=i===focus;
    ctx.globalAlpha=connected(i,focus)?1:.3;
    if(active||i===0){ctx.strokeStyle=active?color(n):'#365769';ctx.lineWidth=1;ctx.beginPath();ctx.arc(p[0],p[1],r+5,0,Math.PI*2);ctx.stroke();}
    ctx.beginPath();ctx.arc(p[0],p[1],r,0,Math.PI*2);ctx.fillStyle=i===0?'#244837':'#20392e';ctx.fill();ctx.strokeStyle=color(n);ctx.lineWidth=i===0?2:1.5;ctx.stroke();
    ctx.fillStyle=color(n);if(i===0){ctx.font='600 12px system-ui';ctx.textAlign='center';ctx.fillText('T',p[0],p[1]+4);}else{ctx.beginPath();ctx.arc(p[0],p[1],3,0,Math.PI*2);ctx.fill();}
    ctx.textAlign='center';ctx.fillStyle=active?'#e0ebf5':'#9fb1c7';
    if(i===0){label('TARGET PAPER',p[0],p[1]+42,140);}else if(nodes.length<=16||active){label(n.label,p[0],p[1]-18,active?200:104);}
  });ctx.globalAlpha=1;
  if(nodes.length===1){ctx.textAlign='center';ctx.fillStyle='#a7b8cb';label('No citing papers in this sample',W/2,H-100,W-48);}
  document.getElementById('graph-zoom').textContent=Math.round(zoom*100)+'%';
  document.getElementById('graph-in').disabled=zoom>=2.5;document.getElementById('graph-out').disabled=zoom<=.5;
}
function select(i){selected=i;picker.value=String(i);var n=nodes[i];
  document.getElementById('graph-title').textContent=n.label;document.getElementById('graph-meta').textContent=n.sub;
  document.getElementById('graph-badge').textContent=i===0?'Target paper':(n.self&&n.clique?'Self-cite + overlap':n.self?'Candidate self-cite':n.clique?'Author overlap':'Citing paper');
  document.getElementById('graph-badge').style.color=color(n);
  document.getElementById('graph-degree').textContent=String(links.filter(function(l){return l[0]===i||l[1]===i;}).length);
  document.getElementById('graph-degree-label').textContent=i===0?'retrieved citing papers':'connections in this sample';draw();}
function pos(e){var r=canvas.getBoundingClientRect();return[e.clientX-r.left,e.clientY-r.top];}
function hit(p){for(var i=nodes.length-1;i>=0;i--){var s=screen(nodes[i]),r=i===0?26:16;if(Math.hypot(s[0]-p[0],s[1]-p[1])<r)return i;}return -1;}
canvas.addEventListener('pointerdown',function(e){if(!e.isPrimary||e.button!==0)return;var p=pos(e),i=hit(p);hover=i;if(i>=0)select(i);
  gesture={id:e.pointerId,index:i,start:p,pan:[panX,panY],node:i>=0?[nodes[i].x,nodes[i].y]:null};canvas.setPointerCapture(e.pointerId);canvas.style.cursor='grabbing';});
canvas.addEventListener('pointermove',function(e){var p=pos(e);if(gesture){if(e.pointerId!==gesture.id)return;
    if(gesture.index>=0){var n=nodes[gesture.index];n.x=gesture.node[0]+(p[0]-gesture.start[0])/zoom;n.y=gesture.node[1]+(p[1]-gesture.start[1])/zoom;}
    else{panX=gesture.pan[0]+p[0]-gesture.start[0];panY=gesture.pan[1]+p[1]-gesture.start[1];}
  }else{hover=hit(p);canvas.style.cursor=hover>=0?'pointer':'grab';}draw();});
function end(e){if(gesture&&gesture.id===e.pointerId){gesture=null;hover=-1;canvas.style.cursor='grab';draw();}}
canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);canvas.addEventListener('lostpointercapture',end);
canvas.addEventListener('pointerleave',function(){hover=-1;draw();});
function changeZoom(delta){zoom=Math.max(.5,Math.min(2.5,Math.round((zoom+delta)*10)/10));draw();}
function reset(){zoom=1;panX=panY=0;hover=-1;layout();select(0);}
document.getElementById('graph-in').addEventListener('click',function(){changeZoom(.2);});
document.getElementById('graph-out').addEventListener('click',function(){changeZoom(-.2);});
document.getElementById('graph-reset').addEventListener('click',reset);
picker.addEventListener('change',function(){select(Number(picker.value));});
canvas.addEventListener('keydown',function(e){if(e.key==='ArrowRight'||e.key==='ArrowLeft'){e.preventDefault();select((selected+(e.key==='ArrowRight'?1:nodes.length-1))%nodes.length);}
  else if(e.key==='+'||e.key==='='){e.preventDefault();changeZoom(.2);}else if(e.key==='-'){e.preventDefault();changeZoom(-.2);}else if(e.key==='Escape'){reset();}});
resize();select(0);if(window.ResizeObserver){new ResizeObserver(resize).observe(canvas);}else window.addEventListener('resize',resize);
})();
`;

export function renderDashboard(report: ForensicsReport, citers: ScholarPaper[], generatedAt = new Date(), ai?: Interpretation): string {
  citers = citers.slice(0, 100);
  const t = report.target;
  const finding = summarizeFinding(report, citers);
  const assessment = assess(report, report.integrity);
  const integrity = report.integrity;
  const s = assessment.signals;
  const workEdges = s.paperEdges.slice(0, 60).map((e) => {
    const from = integrity?.works.find((w) => w.doi === e.from), to = integrity?.works.find((w) => w.doi === e.to);
    return `<li><a href="${esc(`https://doi.org/${e.from}`)}" target="_blank" rel="noopener noreferrer">${esc(from?.title ?? e.from)}</a> cites <a href="${esc(`https://doi.org/${e.to}`)}" target="_blank" rel="noopener noreferrer">${esc(to?.title ?? e.to)}</a></li>`;
  }).join("");

  // Graph data: node 0 = target; clique pairs linked.
  const overlapPaperIds = new Set(report.authorOverlaps.flatMap((c) => c.paperIds));
  const nodes = [
    { label: t.title, sub: "target paper · " + t.authors.slice(0, 3).join(", "), kind: "target" },
    ...citers.map((c) => ({
      label: c.title,
      sub: (c.rawAuthors || c.authors.join(", ")).slice(0, 80) + (c.year ? " · " + c.year : ""),
      kind: "citer",
      self: report.selfCite.paperIds.includes(c.resultId),
      clique: overlapPaperIds.has(c.resultId),
    })),
  ];
  const links: [number, number, number, string][] = citers.map((_, i) => [0, i + 1, 190, "cite"] as [number, number, number, string]);
  for (const pair of report.authorOverlaps) {
    const a = citers.findIndex((c) => c.resultId === pair.paperIds[0]);
    const b = citers.findIndex((c) => c.resultId === pair.paperIds[1]);
    if (a >= 0 && b >= 0) links.push([a + 1, b + 1, 90, "clique"]);
  }

  const venueRows = (() => {
    const m = new Map<string, number>();
    for (const c of citers) { const k = normalizeVenue(c.venue); m.set(k, (m.get(k) ?? 0) + 1); }
    const top = Math.max(...m.values(), 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([venue, count]) =>
      `<div class="vrow"><span class="vlabel">${esc(venue)}</span><div class="vtrack"><div class="vfill" style="width:${Math.round((count / top) * 100)}%"></div></div><span class="vval">${count}</span></div>`
    ).join("");
  })();

  const maxYear = Math.max(...report.yearHistogram.map((y) => y.count), 1);
  const yearBars = report.yearHistogram.map(({ year, count }) =>
    `<div class="yrow"><span class="ylabel">${year}</span><div class="ybar" style="width:${Math.max(2, Math.round((count / maxYear) * 320))}px"></div><span class="yval">${count}</span></div>`
  ).join("");

  const citerRows = citers.slice(0, 30).map((c) => {
    const self = report.selfCite.paperIds.includes(c.resultId);
    const clq = overlapPaperIds.has(c.resultId);
    const tags = `${self ? '<span class="tag self">candidate self-cite</span>' : ""}${clq ? '<span class="tag clique">author overlap</span>' : ""}`;
    return `<tr><td>${safeUrl(c.link) ? `<a href="${safeUrl(c.link)}" target="_blank" rel="noopener noreferrer">${esc(c.title)}</a>` : esc(c.title)}${tags}</td><td>${esc(c.rawAuthors || c.authors.join(", "))}</td><td>${c.year ?? "—"}</td><td>${esc(normalizeVenue(c.venue))}</td></tr>`;
  }).join("");

  const selfCiteList = report.selfCite.papers.map((p) => `<li>${esc(p)}</li>`).join("");
  const notes = report.notes.map((n) => `<li>${esc(n)}</li>`).join("");

  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Forensics — ${esc(t.title.slice(0, 60))}</title><style>${CSS}</style></head>
<body><div class="wrap">${SITE_HEADER}
<div class="eyebrow">Scholar citation-pattern explorer</div>
<h1>${esc(t.title)}</h1>
<p class="meta">${esc(t.authors.join(", "))}${t.year ? " · " + t.year : ""}${t.venue ? " · " + esc(t.venue) : ""}${t.citedByTotal !== undefined ? ` · ~${t.citedByTotal.toLocaleString()} citations` : ""}</p>

<section class="finding ${assessment.level}" aria-labelledby="assessment-title">
<div class="finding-label">Overall assessment · ${assessment.basis === "sample" ? "sample only; reference checks incomplete" : "includes reference evidence"}</div>
<h2 id="assessment-title">${esc(assessment.title)}</h2>
<ul class="assessment-reasons">${assessment.reasons.map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
<p class="assessment-action">${esc(assessment.action)}</p>
<p class="finding-caveat">${esc(assessment.caveat)}</p>
<div class="finding-actions"><a href="#integrity-section">See retraction and reference evidence ↓</a><a href="#graph-section">Explore incoming citations ↓</a></div>
</section>

<h2 class="sec" id="integrity-section">Retraction and reference-network checks</h2>
<div class="card">
<p><strong>Metadata check: ${integrity ? esc(integrity.status) : "not run"}.</strong> ${integrity ? `Crossref · ${esc(integrity.checkedAt)} · ${integrity.requests} request(s)` : "Re-run this paper to retrieve reference and retraction evidence."}</p>
<div class="check-grid">
<div><strong>Retraction status</strong><p>${integrity ? esc(integrity.retraction.status) : "Unknown"}</p>${(integrity?.retraction.urls ?? []).filter((u) => safeUrl(u)).map((u) => `<p><a href="${safeUrl(u)}" target="_blank" rel="noopener noreferrer">${integrity?.targetDoi && u === `https://doi.org/${integrity.targetDoi}` ? "Original publisher record" : integrity?.retraction.status === "verified" ? "Retraction notice" : "Publisher record"} ↗</a></p>`).join("")}</div>
<div><strong>Target reference list</strong><p>${s.depositedReferences} deposited / ${s.referenceCount} reported references. ${s.referenceVenueKnown} have journal labels.</p><p>${s.topReferenceVenue ? `${s.topReferenceVenueCount} references share “${esc(s.topReferenceVenue)}” (${Math.round(s.topReferenceVenueShare * 100)}% of reported references).` : "No usable reference-journal labels."}</p></div>
<div><strong>Candidate author-team network</strong><p>${s.teamCount} teams across ${integrity?.works.length ?? 0} matched works. ${s.ringTeams} teams in the target-connected citation cycle; ${s.reciprocalPairs} reciprocal pair(s).</p><p>${integrity?.matchedCiters ?? 0} / ${integrity?.requestedCiters ?? 0} attempted citers matched. Coauthors merge into one team; this avoids counting normal collaboration as independent cartel participants.</p></div>
</div>
<details style="margin-top:1rem"><summary>Inspect deposited citation edges (${s.paperEdges.length})</summary><ul class="plain">${workEdges || "<li>No cross-team DOI citation edges could be established. Missing edges do not prove that no citations exist.</li>"}</ul>${s.paperEdges.length > 60 ? "<p>First 60 edges shown; all edges are exported in the evidence bundle.</p>" : ""}</details>
<details style="margin-top:1rem"><summary>Assessment rules and limitations</summary><p>The overall assessment applies to at most 100 retrieved citers. A large total citation count or low percentage coverage never blocks a sample assessment. With ≥10 citers, usable target identities, usable author metadata for ≥80% of citers, and no threshold-level concern, the result is “Looks fine in the sampled citations”; incomplete reference/retraction checks remain disclosed separately.</p><p>Possible cartel requires a deposited citation cycle involving ≥3 candidate teams, including the target. Strong signals additionally require ≥50% directed edge density, ≥2 reciprocal pairs, and ≥50% of at least 10 target references sharing one journal label. A full-reference “Looks fine” result additionally requires a completed metadata check, ≥10 matched citers with usable reference/author evidence, usable target authors, and ≥10 target references with ≥80% deposited coverage. These thresholds are unvalidated.</p><p>Exact full-name or ORCID matches form candidate teams. Citation cycles do not establish coordinated intent or irrelevant citations. Citation passages and field baselines are not checked.</p><ul>${(integrity?.warnings ?? ["No reference-network evidence available."]).map((w) => `<li>${esc(w)}</li>`).join("")}</ul></details>
</div>

<section class="finding ${finding.tone}" aria-labelledby="finding-title">
<div class="finding-label">Supporting incoming-citation pattern · retrieved sample only</div>
<h2 id="finding-title">${esc(finding.verdict)}</h2>
<p class="finding-evidence">${esc(finding.headline)}</p>
${finding.label === "Majority venue-label concentration" ? `<p class="method">A venue label is the journal, conference, or publication source name shown by Scholar; shortened labels may group different sources together.</p>` : ""}
<p>${esc(finding.detail)}</p>
<p class="finding-context">${report.citersAnalyzed} first-returned Scholar records${report.evidenceQuality.coveragePercent !== null ? ` · ${report.evidenceQuality.coveragePercent.toFixed(2)}% citation coverage` : " · citation coverage unknown"}</p>
<p class="finding-caveat"><strong>Pattern finding, not a misconduct verdict.</strong> Non-random sample${report.evidenceQuality.truncatedVenues ? "; truncated venue labels make concentration approximate" : ""}.</p>
<div class="finding-actions"><a href="#graph-section">Inspect author connections ↓</a><a href="#sources-section">Inspect publication sources ↓</a></div>
${finding.duplicateGroups ? `<details><summary>Possible duplicate records</summary><p>${finding.duplicateGroups} repeated-title group(s) may be versions or duplicate records; verify before interpreting overlaps.</p></details>` : ""}
</section>

  <div class="stats">
    <div class="card stat"><div class="k">Candidate self-cites</div><div class="v">${Math.round(report.selfCite.rate * 100)}%</div><div class="d">${report.selfCite.count} of ${report.citersAnalyzed} citers have candidate author matches; incomplete lists may undercount</div></div>
    <div class="card stat"><div class="k">Publication venue share</div><div class="v">${Math.round(report.venueConcentration.topVenueShare * 100)}%</div><div class="d">of all sampled citers in “${esc(report.venueConcentration.topVenue)}” · ${report.venueConcentration.excludedPapers} repository/unknown records excluded from concentration</div></div>
    <div class="card stat"><div class="k">Author-overlap pairs</div><div class="v">${report.authorOverlaps.length}</div><div class="d">paper pairs sharing ≥2 candidate identities; not citation cliques</div></div>
  </div>

<h2 class="sec" id="graph-section">Citation graph</h2>
<section class="graph-shell" aria-label="Citation network explorer">
<div class="graph-toolbar"><div><div class="graph-kicker">Explore the sample</div><h3>One paper. ${citers.length} citing connections.</h3></div><div class="graph-counts"><span><strong>${nodes.length}</strong> papers</span><span><strong>${report.authorOverlaps.length}</strong> overlap pairs</span></div></div>
<div class="graph-body"><div class="graph-stage">
<canvas id="graph" tabindex="0" role="img" aria-label="Citation graph: target paper connected to sampled citing papers. Use left and right arrow keys to inspect papers, plus and minus to zoom, Escape to reset." aria-describedby="graph-caption"></canvas>
<div class="graph-controls" role="group" aria-label="Graph view controls"><button type="button" id="graph-out" aria-label="Zoom out">−</button><output id="graph-zoom" aria-label="Zoom level">100%</output><button type="button" id="graph-in" aria-label="Zoom in">+</button><button type="button" id="graph-reset">Reset view</button></div>
<div class="graph-hint">Select a paper · drag to rearrange</div>
</div><aside class="graph-inspector" aria-label="Selected paper details">
<div class="graph-kicker">Paper details</div><label for="graph-paper">Inspect a paper</label><select id="graph-paper"></select>
<div aria-live="polite" aria-atomic="true"><div class="graph-badge" id="graph-badge">Target paper</div><h4 id="graph-title">${esc(t.title)}</h4><p id="graph-meta">${esc(t.authors.slice(0, 3).join(", "))}</p><div class="graph-relations"><strong id="graph-degree">${citers.length}</strong><span id="graph-degree-label">retrieved citing papers</span></div></div>
<p class="graph-note">Connections reflect this sample only. Candidate author matches need verification.</p>
</aside></div>
<div class="legend">
<span><span class="dot" style="background:#67d5e5"></span>Target</span>
<span><span class="dot" style="background:#91a9c3"></span>Citing paper</span>
<span><span class="dot" style="background:#edb76c"></span>Candidate self-cite</span>
<span><span class="dot" style="background:#b5a0e8"></span>Author overlap</span>
<span><span class="dot" style="background:#e9a4cb"></span>Both signals</span>
<span><span class="legend-line"></span>Author-overlap edge</span>
</div></section>
<p class="graph-caption" id="graph-caption">Solid edges are retrieved citations to the target. Dashed purple edges are candidate author overlaps, not citations between papers. Drag empty space to pan; use the paper selector or arrow keys for details. Full metadata is in the paper table below.</p>

<h2 class="sec" id="sources-section">Publication sources (including repositories)</h2>
<div class="card">${venueRows || "<p class='meta'>No venue data.</p>"}</div>

<h2 class="sec">Sampled citing papers by publication year</h2>
<div class="card">${yearBars || "<p class='meta'>No year data.</p>"}</div>

<h2 class="sec">Citing papers${citers.length > 30 ? " (top 30)" : ""}</h2>
<div class="card" style="overflow-x:auto"><table><tr><th>Title</th><th>Authors</th><th>Year</th><th>Venue</th></tr>${citerRows}</table></div>

${report.selfCite.count ? `<h2 class="sec">Candidate self-citations</h2><div class="card"><ul class="plain">${selfCiteList}</ul></div>` : ""}

${renderInterpretation(ai)}

<div class="card notes"><h3 style="margin-bottom:.5rem">Analyst notes</h3><ul>${notes}</ul>
<p class="method" style="margin-top:.8rem">Method v2: <code>index = 0.45·candidateSelfCiteRate + 0.30·publicationVenueShare + 0.25·overlapPairDensity</code>. Pair density divides all matching pairs by all possible pairs. arXiv/unknown sources do not raise concentration; the denominator is all sampled citers. Names/initials are candidate matches only. Weights are unvalidated; no index for samples under 10 or missing usable target/citer identities. Not comparable to the old cartel score.</p></div>

<div class="foot">generated ${esc(generatedAt.toISOString())} · data: Google Scholar via SerpApi · sample of ${report.citersAnalyzed} citers</div>
</div>
<script>window.__NODES__=${JSON.stringify(nodes).replace(/</g, "\\u003c")};window.__LINKS__=${JSON.stringify(links)};</script>
<script>${GRAPH_JS}</script>
</body></html>`;
}

