/* PRISM responsive mockup — interactions.
   Content mirrors the real app's shapes (LcaResult / contribution graphs / graph nodes). */
(() => {
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const state = { view: "graph", theme: "dark", decimals: 3, allDecimals: false, chat: false,
  selected: null, expanded: new Set(["assembly"]), dirty: false, doc: "Copy of Jacket", refAmounts: true };

const fmt = (n) => {
  if (state.allDecimals) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-3 || a >= 1e6)) return n.toExponential(Math.min(state.decimals, 4));
  return n.toFixed(state.decimals);
};

/* ---------------- data ---------------- */
const NODES = [
  { id: "assembly", label: "Jacket assembly", color: "#e879f9", scope: "FG", x: 46, y: 16,
    inputs: [["Woven fabric", 1.4, "kg"], ["Zipper", 2, "pcs"], ["Thread", .08, "kg"]],
    emissions: [["Carbon dioxide", 4.12, "kg"]],
    extractions: [["Water, river", .031, "m3"]], supply: 1, unit: "jacket" },
  { id: "fabric", label: "Woven fabric production", color: "#38bdf8", scope: "FG", x: 12, y: 44,
    inputs: [["Polyester yarn", 1.52, "kg"], ["Electricity", 2.9, "kWh"]],
    emissions: [["Carbon dioxide", 1.86, "kg"], ["Methane", .0042, "kg"]],
    extractions: [["Water, river", .084, "m3"]], supply: 1.4, unit: "kg" },
  { id: "yarn", label: "Polyester yarn", color: "#a78bfa", scope: "BG", x: 52, y: 58,
    inputs: [["Crude oil", 1.9, "kg"], ["Electricity", 4.1, "kWh"]],
    emissions: [["Carbon dioxide", 3.42, "kg"]], extractions: [["Crude oil, in ground", 1.9, "kg"]],
    supply: 1.52, unit: "kg" },
  { id: "power", label: "Electricity, medium voltage", color: "#fbbf24", scope: "BG", x: 14, y: 74,
    inputs: [["Hard coal", .31, "kg"], ["Natural gas", .18, "m3"]],
    emissions: [["Carbon dioxide", 1.98, "kg"], ["Sulfur dioxide", .0031, "kg"]],
    extractions: [["Hard coal, in ground", .31, "kg"]], supply: 7, unit: "kWh" },
  { id: "zipper", label: "Zipper, metal", color: "#4ade80", scope: "BG", x: 62, y: 34,
    inputs: [["Steel, low-alloyed", .012, "kg"]], emissions: [["Carbon dioxide", .21, "kg"]],
    extractions: [], supply: 2, unit: "pcs" },
];
const EDGES = [["fabric", "assembly"], ["zipper", "assembly"], ["yarn", "fabric"], ["power", "fabric"], ["power", "yarn"]];

const LCI_IN = [["Crude oil, in ground", "natural resource", 2.888, "kg"], ["Hard coal, in ground", "natural resource", 2.17, "kg"],
  ["Natural gas, in ground", "natural resource", 1.26, "m3"], ["Water, river", "natural resource", .143, "m3"],
  ["Iron ore, in ground", "natural resource", .026, "kg"], ["Occupation, industrial area", "land", .0041, "m2a"]];
const LCI_OUT = [["Carbon dioxide, fossil", "air", 11.59, "kg"], ["Methane, fossil", "air", .0198, "kg"],
  ["Sulfur dioxide", "air", .0094, "kg"], ["Nitrogen oxides", "air", .0136, "kg"], ["COD, chemical oxygen demand", "water", .0072, "kg"]];
const REQS = [
  { d: 0, name: "Jacket, finished", product: "jacket", amount: 1, unit: "jacket", scope: "functional unit" },
  { d: 1, name: "Jacket assembly", product: "jacket", amount: 1, unit: "jacket", scope: "foreground" },
  { d: 2, name: "Woven fabric production", product: "woven fabric", amount: 1.4, unit: "kg", scope: "foreground" },
  { d: 3, name: "Polyester yarn", product: "polyester yarn", amount: 1.52, unit: "kg", scope: "background" },
  { d: 4, name: "Electricity, medium voltage", product: "electricity", amount: 7.0, unit: "kWh", scope: "background" },
  { d: 3, name: "Electricity, medium voltage", product: "electricity", amount: 2.9, unit: "kWh", scope: "background" },
  { d: 2, name: "Zipper, metal", product: "zipper", amount: 2, unit: "pcs", scope: "background" },
];
const IMPACTS = [
  { cat: "Climate change", unit: "kg CO₂-eq", score: 12.204, procs: [["Polyester yarn", 5.198, 42.6], ["Electricity, medium voltage", 3.463, 28.4], ["Woven fabric production", 2.941, 24.1], ["Jacket assembly", .389, 3.2], ["Zipper, metal", .213, 1.7]] },
  { cat: "Water consumption", unit: "m³", score: .2861, procs: [["Woven fabric production", .1402, 49.0], ["Polyester yarn", .0891, 31.1], ["Electricity, medium voltage", .0402, 14.1], ["Jacket assembly", .0166, 5.8]] },
  { cat: "Fossil resource scarcity", unit: "kg oil-eq", score: 4.117, procs: [["Polyester yarn", 2.361, 57.3], ["Electricity, medium voltage", 1.204, 29.2], ["Woven fabric production", .428, 10.4], ["Zipper, metal", .124, 3.0]] },
  { cat: "Land use", unit: "m²a crop-eq", score: .0412, procs: [["Polyester yarn", .0198, 48.1], ["Electricity, medium voltage", .0121, 29.4], ["Woven fabric production", .0093, 22.5]] },
  { cat: "Terrestrial acidification", unit: "kg SO₂-eq", score: .0387, procs: [["Electricity, medium voltage", .0192, 49.6], ["Polyester yarn", .0126, 32.6], ["Woven fabric production", .0069, 17.8]] },
];
const PROC_IN = [["Polyester yarn", "polyester yarn", "market", 1.52, "kg"], ["Electricity, medium voltage", "electricity", "market", 2.9, "kWh"],
  ["Water, river", "water", "natural resource", .084, "m3"], ["Lubricating oil", "lubricant", "market", .004, "kg"]];
const PROC_OUT = [["Woven fabric", "woven fabric", "reference", 1.4, "kg"], ["Carbon dioxide, fossil", "air", "emission", 1.86, "kg"],
  ["Methane, fossil", "air", "emission", .0042, "kg"], ["Textile waste", "waste", "treatment", .022, "kg"]];
const RT = [
  { id: "fabric-in", label: "Woven fabric input", sub: "Jacket assembly", value: 1.4, min: .7, max: 2.1, unit: "kg" },
  { id: "power-in", label: "Electricity input", sub: "Woven fabric production", value: 2.9, min: 1, max: 6, unit: "kWh" },
  { id: "yarn-in", label: "Polyester yarn input", sub: "Woven fabric production", value: 1.52, min: .8, max: 2.4, unit: "kg" },
];
const YAML = `name: Copy of Jacket
functional_unit:
  name: jacket
  amount: 1

activities:
  - id: assembly
    name: Jacket assembly
    scope: foreground
    reference_product: { name: jacket, amount: 1, unit: jacket }
    inputs:
      - { activity: fabric, amount: 1.4, unit: kg }
      - { activity: zipper, amount: 2, unit: pcs }
    emissions:
      - { flow: carbon dioxide, amount: 4.12, unit: kg }

  - id: fabric
    name: Woven fabric production
    scope: foreground
    reference_product: { name: woven fabric, amount: 1.4, unit: kg }
    inputs:
      - { activity: yarn, amount: 1.52, unit: kg }
      - { activity: power, amount: 2.9, unit: kWh }
    extractions:
      - { flow: water river, amount: 0.084, unit: m3 }
    emissions:
      - { flow: carbon dioxide, amount: 1.86, unit: kg }
      - { flow: methane, amount: 0.0042, unit: kg }

lcia:
  method: ReCiPe 2016 Midpoint (H)
  contribution_graph:
    categories: [Climate change, Water consumption]
`;
const CHAT = [
  { role: "user", text: "Which process dominates climate change for this jacket?" },
  { role: "tool", name: "get_impact_contributions", body: '{ "category": "Climate change", "cutoff": 0.01 }' },
  { role: "assistant", html: `<p>Polyester yarn dominates at <strong>42.6%</strong> of the 12.204 kg CO₂-eq total.</p>
<div class="ai-chat-table-wrap"><table class="ai-chat-table"><thead><tr><th>Process</th><th>kg CO₂-eq</th><th>Share</th></tr></thead><tbody>
<tr><td>Polyester yarn</td><td>5.198</td><td>42.6%</td></tr><tr><td>Electricity, medium voltage</td><td>3.463</td><td>28.4%</td></tr>
<tr><td>Woven fabric production</td><td>2.941</td><td>24.1%</td></tr></tbody></table></div>
<p>Yarn and grid electricity together account for 71%, so a recycled-polyester or lower-carbon grid scenario moves the result most.</p>` },
];

/* ---------------- welcome shader ---------------- */
/* Lazily initialised: a WebGL context per instance is expensive, and the welcome
   page is often never shown (deep link straight into a view). */
const shaderCtl = { start() {}, stop() {}, init: null, ready: false };
function shader() {
  const canvas = $("#welcome-shader"); if (!canvas) return;
  const gl = canvas.getContext("webgl"); if (!gl) { canvas.style.background = "#090b0e"; return; }
  const vs = `attribute vec2 a_position;varying vec2 v_texCoord;void main(){v_texCoord=a_position*0.5+0.5;gl_Position=vec4(a_position,0.0,1.0);}`;
  const fs = `precision highp float;uniform float u_time;uniform vec2 u_resolution;uniform vec2 u_mouse;varying vec2 v_texCoord;
vec3 permute(vec3 x){return mod(((x*34.0)+1.0)*x,289.0);}
float snoise(vec2 v){const vec4 C=vec4(0.211324865405187,0.366025403784439,-0.577350269189626,0.024390243902439);
vec2 i=floor(v+dot(v,C.yy));vec2 x0=v-i+dot(i,C.xx);vec2 i1=(x0.x>x0.y)?vec2(1.0,0.0):vec2(0.0,1.0);
vec4 x12=x0.xyxy+C.xxzz;x12.xy-=i1;i=mod(i,289.0);
vec3 p=permute(permute(i.y+vec3(0.0,i1.y,1.0))+i.x+vec3(0.0,i1.x,1.0));
vec3 m=max(0.5-vec3(dot(x0,x0),dot(x12.xy,x12.xy),dot(x12.zw,x12.zw)),0.0);m=m*m;m=m*m;
vec3 x=2.0*fract(p*C.www)-1.0;vec3 h=abs(x)-0.5;vec3 ox=floor(x+0.5);vec3 a0=x-ox;
m*=1.79284291400159-0.85373472095314*(a0*a0+h*h);vec3 g;g.x=a0.x*x0.x+h.x*x0.y;g.yz=a0.yz*x12.xz+h.yz*x12.yw;return 130.0*dot(m,g);}
void main(){vec2 uv=v_texCoord;vec2 center=u_mouse/u_resolution;
float noise1=snoise(uv*1.2+u_time*0.04);float noise2=snoise(uv*2.0-u_time*0.06);
vec3 deepBg=vec3(0.035,0.043,0.055);vec3 primaryViolet=vec3(0.545,0.361,0.965);
vec3 indigo=vec3(0.388,0.4,0.945);vec3 accentCyan=vec3(0.22,0.741,0.973);
float mask1=smoothstep(-0.2,0.8,noise1);float mask2=smoothstep(-0.5,0.5,noise2);
float dist=distance(uv,center);float mousePulse=smoothstep(0.5,0.0,dist)*0.2;
vec3 color=mix(deepBg,primaryViolet,mask1*0.35);color=mix(color,indigo,mask2*0.25);
color=mix(color,accentCyan,(mask1*mask2)*0.1);
float refraction=pow(abs(noise1+noise2),5.0)*0.12;color+=refraction*accentCyan;color+=mousePulse*primaryViolet;
gl_FragColor=vec4(color,1.0);}`;
  const compile = (t, s) => { const sh = gl.createShader(t); gl.shaderSource(sh, s); gl.compileShader(sh); return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null; };
  const v = compile(gl.VERTEX_SHADER, vs), f = compile(gl.FRAGMENT_SHADER, fs); if (!v || !f) return;
  const p = gl.createProgram(); gl.attachShader(p, v); gl.attachShader(p, f); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) return; gl.useProgram(p);
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(p, "a_position"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uT = gl.getUniformLocation(p, "u_time"), uR = gl.getUniformLocation(p, "u_resolution"), uM = gl.getUniformLocation(p, "u_mouse");
  let mx = 0, my = 0;
  const size = () => {
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    if (canvas.width === w && canvas.height === h) return;
    canvas.width = w; canvas.height = h; mx = w / 2; my = h / 2;
  };
  window.addEventListener("resize", size);
  canvas.addEventListener("mousemove", (e) => { const r = canvas.getBoundingClientRect(); mx = e.clientX - r.left; my = canvas.height - (e.clientY - r.top); });
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let frame = 0, last = 0, running = false;
  const draw = (ts) => {
    if (!running) return;
    frame = requestAnimationFrame(draw);
    if (ts - last < 33) return;             // ~30fps is plenty for this drift
    last = ts;
    size();
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform1f(uT, ts * .001); gl.uniform2f(uR, canvas.width, canvas.height); gl.uniform2f(uM, mx, my);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (reduce) { running = false; cancelAnimationFrame(frame); }
  };
  shaderCtl.start = () => { if (running) return; running = true; last = 0; frame = requestAnimationFrame(draw); };
  shaderCtl.stop = () => { running = false; cancelAnimationFrame(frame); };
  size();
  shaderCtl.start();
}

/* ---------------- graph ---------------- */
/* DAG levels, root (finished product) first. Node positions are computed at
   layout time from the measured free area rather than fixed percentages, so they
   reflow instead of colliding or sliding off-canvas. */
const LEVELS = [["assembly"], ["fabric", "zipper"], ["yarn"], ["power"]];

function freeArea() {
  const vp = $("#graph-viewport");
  const r = vp.getBoundingClientRect();
  let top = 10, left = 10, right = 10, bottom = 10;
  const box = (sel) => {
    const e = $(sel);
    if (!e || e.hidden || e.offsetParent === null) return null;
    const b = e.getBoundingClientRect();
    return b.width > 1 && b.height > 1 ? b : null;
  };
  const head = box(".canvas-head"); if (head) top = Math.max(top, head.bottom - r.top + 12);
  const tools = box("#graph-toolbar"); if (tools) left = Math.max(left, tools.right - r.left + 12);
  const mode = box(".graph-mode-toolbar"); if (mode) bottom = Math.max(bottom, r.bottom - mode.top + 12);
  const insp = $("#inspector");
  if (insp && insp.classList.contains("is-open")) {
    const b = insp.getBoundingClientRect();
    if (b.width > r.width * 0.8) bottom = Math.max(bottom, r.bottom - b.top + 12);  // bottom sheet
    else right = Math.max(right, r.right - b.left + 12);                            // side panel
  }
  return { x: left, y: top, w: Math.max(140, r.width - left - right), h: Math.max(140, r.height - top - bottom) };
}

/* Bottom-sheet mode (≤620) puts the inspector where the mode toolbar lives and
   squeezes the tool rail. Fit the rail to the space that is actually left and
   stand the mode toolbar down while the sheet is up. */
function syncGraphChrome() {
  const insp = $("#inspector"), rail = $("#graph-toolbar"), mode = $(".graph-mode-toolbar");
  if (!insp || !rail || !mode) return;
  const open = insp.classList.contains("is-open");
  const vp = $("#graph-viewport").getBoundingClientRect();
  const ib = insp.getBoundingClientRect();
  const sheet = open && ib.width > vp.width * 0.8;
  mode.style.visibility = sheet ? "hidden" : "";
  /* The rail is a tall vertical stack, so on a short viewport it runs past the
     bottom of the canvas and collides with the mode toolbar underneath it.
     Bound it to whatever sits below — the sheet, the mode toolbar, or the
     canvas floor — and let the overflow scroll inside the rail. */
  rail.style.maxHeight = "";
  rail.style.overflowY = "";
  const railTop = rail.getBoundingClientRect().top;
  let floor = vp.bottom - 12;
  if (sheet) floor = ib.top;
  else if (mode.offsetParent !== null) floor = mode.getBoundingClientRect().top;
  const avail = Math.round(floor - railTop - 12);
  if (avail < rail.scrollHeight) {
    rail.style.maxHeight = Math.max(120, avail) + "px";
    rail.style.overflowY = "auto";
    rail.style.overscrollBehavior = "contain";
  }
}

function layoutGraph() {
  const host = $("#pg-nodes"); if (!host) return;
  syncGraphChrome();
  const area = freeArea();
  const all = LEVELS.flat().map((id) => host.querySelector(`[data-node="${id}"]`)).filter(Boolean);
  if (!all.length) return;
  const cap = Math.max(150, Math.min(270, area.w - 8));
  all.forEach((n) => { n.style.maxWidth = cap + "px"; });

  const gapX = Math.max(8, Math.min(22, Math.round(area.w * 0.02)));
  const gapY = Math.max(8, Math.min(22, Math.round(area.h * 0.03)));

  // The node host IS the free area, so an over-tall stack scrolls inside it
  // instead of sliding underneath the toolbars or the inspector sheet.
  host.style.position = "absolute";
  host.style.left = area.x + "px";
  host.style.top = area.y + "px";
  host.style.width = area.w + "px";
  host.style.height = area.h + "px";
  host.style.overflowX = "hidden";
  host.style.overscrollBehavior = "contain";

  // Pack each level into as many sub-rows as it takes to fit the width.
  const rows = [];
  LEVELS.forEach((ids) => {
    const els = ids.map((id) => host.querySelector(`[data-node="${id}"]`)).filter(Boolean);
    let row = [], used = 0;
    els.forEach((el) => {
      const w = el.offsetWidth;
      if (row.length && used + gapX + w > area.w) { rows.push(row); row = []; used = 0; }
      used += (row.length ? gapX : 0) + w;
      row.push(el);
    });
    if (row.length) rows.push(row);
  });

  const rowH = rows.map((r) => Math.max(...r.map((n) => n.offsetHeight)));
  const total = rowH.reduce((a, b) => a + b, 0) + gapY * (rows.length - 1);
  // Coordinates are now host-relative, so start at 0 (centred when it fits).
  let y = total < area.h ? Math.round((area.h - total) / 2) : 0;
  rows.forEach((r, i) => {
    const widths = r.map((n) => n.offsetWidth);
    const span = widths.reduce((a, b) => a + b, 0) + gapX * (r.length - 1);
    let x = Math.max(0, Math.round((area.w - span) / 2));
    r.forEach((n, j) => {
      n.style.left = Math.round(x) + "px";
      n.style.top = Math.round(y + (rowH[i] - n.offsetHeight) / 2) + "px";
      x += widths[j] + gapX;
    });
    y += rowH[i] + gapY;
  });

  host.style.overflowY = total > area.h ? "auto" : "hidden";
  const vp = $("#graph-viewport");
  vp.style.overflow = "hidden";
  drawEdges();
}

function renderGraph() {
  const host = $("#pg-nodes"); if (!host) return;
  const svg = $("#pg-edges");
  host.innerHTML = NODES.map((n) => {
    const open = state.expanded.has(n.id);
    const sel = state.selected === n.id ? " is-selected" : "";
    if (!open) return `<div class="pg-node${sel}" style="--node-color:${n.color}" data-node="${n.id}" role="button" tabindex="0">
<span class="pg-node-icon"><svg width="11" height="11"><use href="#i-box"/></svg></span><span class="pg-node-label">${n.label}</span>
<button class="pg-node-toggle" type="button" data-toggle="${n.id}" aria-label="Expand ${n.label}">+</button></div>`;
    return `<div class="pg-node is-expanded${sel}" style="--node-color:${n.color}" data-node="${n.id}" role="button" tabindex="0">
<div class="pg-node-head"><span class="pg-node-icon"><svg width="11" height="11"><use href="#i-box"/></svg></span><span class="pg-node-label">${n.label}</span><span class="pg-node-scope">${n.scope}</span><button class="pg-node-toggle" type="button" data-toggle="${n.id}" aria-label="Collapse ${n.label}">−</button></div>
<div class="pg-flow-section"><div class="pg-flow-title">Inputs</div>
${n.inputs.map(([f, a, u]) => `<div class="pg-flow-row"><span></span><span>${f}</span><small>${a} ${u}</small></div>`).join("")}</div>
${n.emissions.length ? `<div class="pg-emissions"><div class="pg-emissions-title">Emissions</div>${n.emissions.map(([f, a, u]) => `<div class="pg-emission-row"><span>${f}</span><strong>${a} ${u}</strong></div>`).join("")}</div>` : ""}</div>`;
  }).join("");
  if (svg) host.appendChild(svg);
  layoutGraph();
}
function drawEdges() {
  const svg = $("#pg-edges"), host = $("#pg-nodes"); if (!svg || !host) return;
  /* The edge canvas lives inside the host it is measured against, so reading
     scrollWidth while the old (larger) canvas is still laid out ratchets the
     size up and never lets it shrink. Collapse it, then measure. */
  svg.style.width = "0"; svg.style.height = "0";
  const w = host.clientWidth, h = Math.max(host.scrollHeight, host.clientHeight);
  if (!w || !h) return;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.style.width = w + "px"; svg.style.height = h + "px";
  // offset* is relative to the positioned host and unaffected by scrolling
  const centre = (id) => {
    const el = host.querySelector(`[data-node="${id}"]`);
    return el ? { x: el.offsetLeft + el.offsetWidth / 2, y: el.offsetTop + el.offsetHeight / 2 } : null;
  };
  svg.innerHTML = EDGES.map(([a, b]) => {
    const p = centre(a), q = centre(b); if (!p || !q) return "";
    const mid = (p.y + q.y) / 2;
    return `<path d="M ${p.x} ${p.y} C ${p.x} ${mid}, ${q.x} ${mid}, ${q.x} ${q.y}" opacity=".5"/>`;
  }).join("");
}
function openInspector(id) {
  const n = NODES.find((x) => x.id === id); if (!n) return;
  state.selected = id;
  $("#inspector-icon").style.background = n.color;
  $("#inspector-title").textContent = n.label;
  $("#inspector-sub").textContent = `${n.scope === "FG" ? "Foreground" : "Background"} activity · ${n.supply} ${n.unit} reference flow`;
  const sec = (cls, title, rows, unitIdx) => rows.length ? `<div class="property-section ${cls}"><h3>${title}</h3>${rows.map((r) => `<div class="property-row"><span>${r[0]}</span><small>${r[2]}</small><strong>${fmt(r[1])}</strong></div>`).join("")}</div>` : "";
  $("#inspector-sections").innerHTML =
    (state.refAmounts ? sec("", "Reference amounts", n.inputs) : "") +
    sec("is-extraction", "Extractions", n.extractions) +
    sec("is-emission", "Emissions", n.emissions);
  $("#inspector").classList.add("is-open");
  $("#graph-viewport").classList.add("has-inspector");
  // The inspector steals canvas space, and these two sit underneath it.
  $("#graph-meta").style.visibility = "hidden";
  $("#chat-open").style.visibility = "hidden";
  renderGraph();
  // Re-run once the open transition has settled, so the reserved area is exact.
  clearTimeout(inspectorSettle);
  inspectorSettle = setTimeout(layoutGraph, 300);
}
let inspectorSettle = 0;
function closeInspector() {
  state.selected = null;
  $("#inspector").classList.remove("is-open");
  $("#graph-viewport").classList.remove("has-inspector");
  $("#graph-meta").style.visibility = "";
  $("#chat-open").style.visibility = "";
  renderGraph();
  clearTimeout(inspectorSettle);
  inspectorSettle = setTimeout(layoutGraph, 300);
}

/* ---------------- tables ---------------- */
const th = (labels) => `<thead><tr>${labels.map((l) => `<th>${l}</th>`).join("")}</tr></thead>`;
function renderInventory() {
  const flowRows = (rows, input) => rows.map(([name, type, amt, unit], i) => {
    const key = `${input ? "i" : "o"}${i}`, open = invOpen.has(key);
    const kids = input ? [["Woven fabric production", "process", amt * .48], ["Polyester yarn", "process", amt * .34]] : [["Polyester yarn", "process", amt * .43], ["Electricity, medium voltage", "process", amt * .29]];
    return `<tr class="inventory-tree-parent" data-inv="${key}"><td><button class="tree-toggle${open ? " is-expanded" : ""}" aria-expanded="${open}"><svg width="14" height="14"><use href="#i-chevron-down"/></svg></button><span class="flow-dot ${input ? "input" : "output"}"></span>${name}</td><td>${type}</td><td class="number">${fmt(amt)}</td><td>${unit}</td></tr>`
      + (open ? kids.map(([p, t, a]) => `<tr class="inventory-flow-child"><td><span class="inventory-tree-indent"></span><span class="process-mark">⌘</span>${p}</td><td>${t}</td><td class="number">${fmt(a)}</td><td>${unit}</td></tr>`).join("") : "");
  }).join("");
  $("#inv-inputs").innerHTML = th(["Name", "Category", "Amount", "Unit"]) + `<tbody>${flowRows(LCI_IN, true)}</tbody>`;
  $("#inv-outputs").innerHTML = th(["Name", "Category", "Amount", "Unit"]) + `<tbody>${flowRows(LCI_OUT, false)}</tbody>`;
  $("#inv-reqs").innerHTML = th(["Process", "Product", "Amount", "Unit"]) + `<tbody>${REQS.map((r) => `<tr><td style="padding-left:${6 + r.d * 20}px"><span class="tree-toggle-spacer"></span><span class="process-mark">⌘</span>${r.name}<small class="inventory-scope is-${r.scope.split(" ")[0]}">${r.scope}</small></td><td><span class="product-mark">⚙</span>${r.product}</td><td class="number">${fmt(r.amount)}</td><td>${r.unit}</td></tr>`).join("")}</tbody>`;
  $("#inv-in-count").textContent = LCI_IN.length; $("#inv-out-count").textContent = LCI_OUT.length; $("#inv-req-count").textContent = REQS.length;
}
const invOpen = new Set(["i0"]);
function renderImpact() {
  const rows = IMPACTS.map((c, ci) => {
    const open = impOpen.has(c.cat);
    const head = `<tr class="impact-category-row" data-imp="${c.cat}"><td><span class="impact-category-name"><button class="tree-toggle${open ? " is-expanded" : ""}" aria-expanded="${open}"><svg width="14" height="14"><use href="#i-chevron-down"/></svg></button><svg class="impact-category-icon" width="14" height="14"><use href="#i-leaf"/></svg><strong>${c.cat}</strong></span></td><td>${c.unit}</td><td class="number">${fmt(c.score)}</td><td class="number">100.0%</td><td>${c.procs.length}</td></tr>`;
    const kids = open ? c.procs.map(([p, v, s]) => `<tr class="impact-process-row"><td><span class="impact-indent"></span><span class="impact-process-icon"><svg width="11" height="11"><use href="#i-box"/></svg></span>${p}</td><td><small>${c.unit}</small></td><td class="number"><span class="impact-bar"><i style="width:${Math.max(4, s)}%"></i></span><span class="impact-result">${fmt(v)}</span></td><td class="number">${s.toFixed(1)}%</td><td></td></tr>`).join("") : "";
    return head + kids;
  }).join("");
  $("#impact-table").innerHTML = th(["Impact category / process", "Unit", "Result", "Share", "n"]) + `<tbody>${rows}</tbody>`;
}
const impOpen = new Set(["Climate change"]);
function renderProcess() {
  $("#proc-inputs").innerHTML = th(["Flow", "Product", "Type", "Amount", "Unit"]) + `<tbody>${PROC_IN.map(([f, p, t, a, u]) => `<tr><td>${f}</td><td>${p}</td><td>${t}</td><td>${fmt(a)}</td><td>${u}</td></tr>`).join("")}</tbody>`;
  $("#proc-outputs").innerHTML = th(["Flow", "Product", "Type", "Amount", "Unit"]) + `<tbody>${PROC_OUT.map(([f, p, t, a, u]) => `<tr><td>${f}</td><td>${p}</td><td>${t}</td><td>${fmt(a)}</td><td>${u}</td></tr>`).join("")}</tbody>`;
  $("#proc-impacts").innerHTML = th(["Impact category", "Unit", "Direct", "Share"]) + `<tbody>${IMPACTS.map((c) => { const share = c.procs.find((p) => p[0] === "Woven fabric production"); const v = share ? share[1] : 0, s = share ? share[2] : 0;
    return `<tr><td>${c.cat}</td><td>${c.unit}</td><td><span class="process-result-bar"><i style="width:${Math.max(4, s)}%"></i></span>${fmt(v)}</td><td>${s.toFixed(1)}%</td></tr>`; }).join("")}</tbody>`;
}
function renderContribution() {
  const cat = IMPACTS[0];
  const rows = [`<tr class="clickable-process contribution-root"><td><span class="rate-value">100.0%</span></td><td><span class="process-mark">⌘</span>Jacket, finished<span class="contribution-scope">functional unit</span></td><td>jacket</td><td>${fmt(cat.score)}</td><td>1</td><td>jacket</td></tr>`];
  cat.procs.forEach(([p, v, s], i) => {
    const node = NODES.find((n) => n.label === p);
    rows.push(`<tr class="clickable-process"><td><span class="result-bar"><i style="width:${Math.max(4, s)}%"></i></span><span class="rate-value">${s.toFixed(1)}%</span></td><td><span class="tree-indent"></span><span class="process-mark">⌘</span>${p}<span class="contribution-scope is-${node && node.scope === "FG" ? "foreground" : "background"}">${node && node.scope === "FG" ? "foreground" : "background"}</span></td><td>${node ? node.unit : "kg"}</td><td>${fmt(v)}</td><td>${node ? fmt(node.supply) : "1"}</td><td>${node ? node.unit : "kg"}</td></tr>`);
    if (i === 0) rows.push(`<tr class="contribution-flow-row is-emission"><td><span class="rate-value">31.4%</span></td><td><span class="tree-indent"></span><span class="tree-indent"></span>Carbon dioxide, fossil <small>emission</small></td><td>kg</td><td>${fmt(v * .74)}</td><td>—</td><td>kg</td></tr>`,
      `<tr class="contribution-flow-row is-extraction"><td><span class="rate-value">8.9%</span></td><td><span class="tree-indent"></span><span class="tree-indent"></span>Crude oil, in ground <small>extraction</small></td><td>kg</td><td>${fmt(v * .21)}</td><td>—</td><td>kg</td></tr>`);
  });
  $("#contrib-table").innerHTML = th(["Rate", "Process / flow", "Unit", "Result", "Supply", "Supply unit"]) + `<tbody>${rows.join("")}</tbody>`;
}
function renderSankey() {
  const host = $("#sankey-nodes"); if (!host) return;
  const cols = [
    [{ id: "s-oil", label: "Crude oil", v: "2.89 kg", c: "#fbbf24" }, { id: "s-coal", label: "Hard coal", v: "2.17 kg", c: "#fbbf24" }, { id: "s-gas", label: "Natural gas", v: "1.26 m³", c: "#fbbf24" }],
    [{ id: "s-yarn", label: "Polyester yarn", v: "5.20", c: "#a78bfa" }, { id: "s-power", label: "Electricity", v: "3.46", c: "#fbbf24" }],
    [{ id: "s-fabric", label: "Woven fabric", v: "2.94", c: "#38bdf8" }, { id: "s-zip", label: "Zipper", v: "0.21", c: "#4ade80" }],
    [{ id: "s-jacket", label: "Jacket", v: "12.20", c: "#e879f9" }]];
  host.innerHTML = cols.map((col) => col.map((n) => `<div class="sankey-flow" style="--node-color:${n.c}" data-sankey="${n.id}"><span class="pg-node-icon" style="background:${n.c}"><svg width="10" height="10"><use href="#i-box"/></svg></span><span>${n.label}</span><small>${n.v}</small></div>`).join("")).join("");
  layoutSankey(cols);
}

/* Sankey columns are laid out from the measured canvas: at wide sizes it reads
   left-to-right like the original, and below that it folds to fewer columns so
   the ribbons stay legible instead of the nodes stacking on top of each other. */
function layoutSankey(cols) {
  const host = $("#sankey-nodes"); if (!host) return;
  const wrap = $("#sankey-canvas").getBoundingClientRect();
  const rail = $(".sankey-toolbar");
  const railW = rail && rail.offsetParent !== null ? rail.getBoundingClientRect().width + 24 : 12;
  const summary = $("#sankey-summary");
  const sumH = summary && summary.offsetParent !== null ? summary.getBoundingClientRect().height + 20 : 16;
  const head = $(".canvas-head");
  const headH = head && head.offsetParent !== null ? head.getBoundingClientRect().height + 22 : 14;

  const area = { x: railW, y: headH, w: Math.max(150, wrap.width - railW - 12), h: Math.max(150, wrap.height - headH - sumH) };
  const els = [...host.querySelectorAll(".sankey-flow")];
  if (!els.length) return;

  // How many of the four stages fit side by side at a readable node width?
  const minNode = 132;
  const perCol = Math.max(1, Math.min(cols.length, Math.floor((area.w + 16) / (minNode + 16))));
  const groups = [];
  const step = Math.ceil(cols.length / perCol);
  for (let i = 0; i < cols.length; i += step) groups.push(cols.slice(i, i + step).flat());

  const colW = Math.min(190, Math.floor((area.w - 16 * (groups.length - 1)) / groups.length));
  els.forEach((e) => { e.style.width = colW + "px"; });

  let maxBottom = 0;
  groups.forEach((group, gi) => {
    const nodes = group.map((n) => host.querySelector(`[data-sankey="${n.id}"]`)).filter(Boolean);
    const gapY = 12;
    const totalH = nodes.reduce((a, n) => a + n.offsetHeight, 0) + gapY * (nodes.length - 1);
    let y = area.y + Math.max(0, Math.round((area.h - totalH) / 2));
    const x = area.x + gi * (colW + 16);
    nodes.forEach((n) => {
      n.style.left = Math.round(x) + "px";
      n.style.top = Math.round(y) + "px";
      y += n.offsetHeight + gapY;
      maxBottom = Math.max(maxBottom, y);
    });
  });

  const canvas = $("#sankey-canvas");
  canvas.style.overflowY = maxBottom > wrap.height ? "auto" : "hidden";

  requestAnimationFrame(() => {
    const svg = $("#sankey-ribbons"), box = host.getBoundingClientRect(); if (!svg || !box.width) return;
    svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
    const pt = (id, side) => { const el = host.querySelector(`[data-sankey="${id}"]`); if (!el) return null; const r = el.getBoundingClientRect(); return { x: (side === "r" ? r.right : r.left) - box.left, y: r.top - box.top + r.height / 2 }; };
    const links = [["s-oil", "s-yarn", 7], ["s-coal", "s-power", 6], ["s-gas", "s-power", 4], ["s-yarn", "s-fabric", 8], ["s-power", "s-fabric", 5], ["s-fabric", "s-jacket", 10], ["s-zip", "s-jacket", 3]];
    svg.innerHTML = links.map(([a, b, w]) => {
      const p = pt(a, "r"), q = pt(b, "l"); if (!p || !q) return "";
      if (q.x < p.x) return "";   // folded into the same column — no ribbon to draw
      const mx = (p.x + q.x) / 2;
      return `<path d="M ${p.x} ${p.y} C ${mx} ${p.y}, ${mx} ${q.y}, ${q.x} ${q.y}" stroke-width="${w}"/>`;
    }).join("");
  });
}
function renderResultsMd() {
  $("#results-md").innerHTML = `<h1>LCA results — Copy of Jacket</h1>
<p>Functional unit: <strong>1 jacket</strong>. Method: ReCiPe 2016 Midpoint (H). Calculated against applied revision 14.</p>
<h2>Impact scores</h2>
<table><thead><tr><th>Category</th><th>Score</th><th>Unit</th></tr></thead><tbody>
${IMPACTS.map((c) => `<tr><td>${c.cat}</td><td>${fmt(c.score)}</td><td>${c.unit}</td></tr>`).join("")}
</tbody></table>
<h2>Dominant contributors</h2>
<p>Polyester yarn drives 42.6% of climate change, followed by grid electricity at 28.4%. Foreground assembly contributes 3.2%.</p>
<h2>Inventory summary</h2>
<p>${LCI_IN.length} input flows and ${LCI_OUT.length} output flows were returned across ${REQS.length} scaled process requirements.</p>`;
}
function renderRealtime() {
  const scores = $("#rt-scores"), sliders = $("#rt-sliders"); if (!scores) return;
  const factor = RT.reduce((acc, s) => acc + (s.value / s.def - 1), 0) / RT.length;
  scores.innerHTML = IMPACTS.slice(0, 3).map((c) => {
    const next = c.score * (1 + factor), d = ((next - c.score) / c.score) * 100;
    const dir = d < -0.05 ? "is-down" : d > 0.05 ? "is-up" : "";
    return `<div class="realtime-score"><header>${c.cat}</header>
<div class="realtime-score-values">${Math.abs(d) > .05 ? `<span class="realtime-score-baseline">${fmt(c.score)}</span>` : ""}<span class="realtime-score-preview ${dir}">${fmt(next)}</span></div>
<footer><span class="realtime-score-unit">${c.unit}</span><span class="realtime-score-delta ${dir}">${d >= 0 ? "+" : ""}${d.toFixed(1)}%</span></footer></div>`;
  }).join("");
  sliders.innerHTML = RT.map((s) => `<div class="realtime-slider${Math.abs(s.value - s.def) > 1e-9 ? " is-edited" : ""}">
<div class="realtime-slider-head"><div class="realtime-slider-label"><strong>${s.label}</strong><span>${s.sub}</span></div>
<div class="realtime-slider-amount"><span class="number">${s.value.toFixed(2)}</span><span class="realtime-slider-unit">${s.unit}</span></div></div>
<input type="range" min="${s.min}" max="${s.max}" step="0.01" value="${s.value}" data-rt="${s.id}" aria-label="${s.label}">
<div class="realtime-slider-scale"><span>${s.min}</span><span>${s.max}</span></div></div>`).join("");
}
RT.forEach((s) => { s.def = s.value; });

/* ---------------- chat ---------------- */
function renderChat() {
  $("#chat-content").innerHTML = CHAT.length ? CHAT.map((m) => {
    if (m.role === "user") return `<div class="ai-chat-message is-user"><div class="ai-chat-message-content">${m.text}</div></div>`;
    if (m.role === "tool") return `<div class="ai-chat-message"><details class="ai-chat-tool"><summary>${m.name}</summary><pre>${m.body}</pre></details></div>`;
    return `<div class="ai-chat-message"><div class="ai-chat-message-content">${m.html}</div></div>`;
  }).join("") : `<div class="ai-chat-welcome"><strong>PRISM assistant</strong><p>Ask about the graph, run a calculation, or switch views.</p>
<div class="ai-chat-suggestions"><button type="button">Summarise impacts</button><button type="button">Which process dominates?</button><button type="button">Open the Sankey</button></div></div>`;
  const c = $("#chat-conversation"); c.scrollTop = c.scrollHeight;
}

/* ---------------- view routing ---------------- */
const VIEW_OF_PANEL = { graph: "graph", yaml: "yaml", results: "results", inventory: "inventory", impact: "impact", process: "process", contribution: "contribution", sankey: "sankey", realtime: "realtime" };
/* Views render on first activation rather than at boot: the analysis tables are
   large, and keeping nine of them in the DOM up front costs layout for nothing. */
const RENDERERS = { inventory: renderInventory, impact: renderImpact, process: renderProcess,
  contribution: renderContribution, results: renderResultsMd, sankey: renderSankey, realtime: renderRealtime };
const rendered = new Set();
function ensureView(v) {
  const fn = RENDERERS[v];
  if (!fn) return;
  if (v === "sankey" || v === "realtime") { fn(); return; }   // geometry/state dependent
  if (rendered.has(v)) return;
  rendered.add(v); fn();
}
function setView(v) {
  state.view = v;
  ensureView(v);
  $$("[data-view-panel]").forEach((el) => { el.hidden = el.dataset.viewPanel !== v; });
  /* Scoped overlays own their open/closed state (settings popovers, the scenario
     panel, the inspector). Leaving a view must close them, but entering a view
     must NOT force them open. */
  $$("[data-view-scope]").forEach((el) => {
    const inScope = el.dataset.viewScope === v;
    if (!inScope) { el.hidden = true; el.classList.remove("is-open"); return; }
    // Back in scope: elements whose visibility is class-driven must be re-mounted;
    // popovers stay closed until the user opens them.
    if (el.dataset.visibility === "class") el.hidden = false;
  });
  if (v !== "graph") { state.selected = null; $("#graph-viewport").classList.remove("has-inspector"); }
  $$("[data-view]").forEach((b) => b.setAttribute("data-state", b.dataset.view === v ? "on" : "off"));
  $$(".nav-sheet-row[data-view]").forEach((b) => {
    const on = b.dataset.view === v;
    b.setAttribute("data-state", on ? "on" : "off");
    let mark = b.querySelector(".check");
    if (on && !mark) { mark = document.createElement("svg"); b.insertAdjacentHTML("beforeend", '<svg class="check" width="13" height="13"><use href="#i-check"/></svg>'); }
    else if (!on && mark) mark.remove();
  });
  $$(".navbar-menu-trigger").forEach((b) => {
    if (b.dataset.menu === "results") b.classList.toggle("is-active", ["results", "inventory", "impact", "process", "contribution", "sankey", "realtime"].includes(v));
  });
  if (v === "graph") { renderGraph(); if (state.selected) openInspector(state.selected); }
  if (v === "sankey") renderSankey();
  if (v === "realtime") renderRealtime();
  closeMenus();
}
function closeMenus() { $$(".menu").forEach((m) => { m.hidden = true; }); }
function placeMenu(menu, anchor) {
  menu.hidden = false;
  const a = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
  const left = Math.min(Math.max(8, a.left), window.innerWidth - m.width - 8);
  const top = a.bottom + 6 + m.height > window.innerHeight ? Math.max(8, a.top - m.height - 6) : a.bottom + 6;
  menu.style.left = `${left}px`; menu.style.top = `${top}px`;
}

/* ---------------- wiring ---------------- */
function enterApp() {
  $("#welcome").hidden = true;
  shaderCtl.stop();
  $("#topbar").hidden = false; $("#workspace").hidden = false;
  $("#chat-open").hidden = state.chat;
  setView(state.view);
}
function showWelcome() {
  $("#welcome").hidden = false;
  $("#topbar").hidden = true; $("#workspace").hidden = true; $("#chat-open").hidden = true;
  if (!shaderCtl.ready) { shaderCtl.ready = true; shader(); }
  shaderCtl.start();
}
$("#explore").addEventListener("click", enterApp);
$("#brand-home").addEventListener("click", showWelcome);

document.addEventListener("click", (e) => {
  const t = e.target;
  const viewBtn = t.closest("[data-view]");
  if (viewBtn) { setView(viewBtn.dataset.view); closeSheet(); return; }
  const menuBtn = t.closest("[data-menu]");
  if (menuBtn) {
    const id = menuBtn.dataset.menu, menu = $(`#menu-${id}`), wasOpen = !menu.hidden;
    closeMenus(); if (!wasOpen) placeMenu(menu, menuBtn); return;
  }
  const doc = t.closest("[data-doc]");
  if (doc) {
    state.doc = doc.dataset.doc;
    ["#study-title", "#navbar-model-title", "#nav-model-title", "#sheet-rename"].forEach((s) => { const el = $(s); if (el) el.textContent = state.doc; });
    $$("#menu-file [data-doc]").forEach((b) => { const c = b.querySelector(".model-menu-check"); if (c) c.remove(); });
    doc.insertAdjacentHTML("beforeend", '<svg class="model-menu-check" width="13" height="13"><use href="#i-check"/></svg>');
    closeMenus(); return;
  }
  const node = t.closest("[data-node]");
  const toggle = t.closest("[data-toggle]");
  if (toggle) { const id = toggle.dataset.toggle; state.expanded.has(id) ? state.expanded.delete(id) : state.expanded.add(id); renderGraph(); if (state.selected) $("#inspector").classList.add("is-open"); return; }
  if (node) { openInspector(node.dataset.node); return; }
  const inv = t.closest("[data-inv]");
  if (inv) { const k = inv.dataset.inv; invOpen.has(k) ? invOpen.delete(k) : invOpen.add(k); renderInventory(); return; }
  const imp = t.closest("[data-imp]");
  if (imp) { const k = imp.dataset.imp; impOpen.has(k) ? impOpen.delete(k) : impOpen.add(k); renderImpact(); return; }
  const sank = t.closest("[data-sankey]");
  if (sank) { $$("[data-sankey]").forEach((n) => n.classList.remove("is-path-highlighted")); sank.classList.add("is-path-highlighted"); const s = $("#sankey-summary"); s.querySelector("strong").textContent = sank.textContent.replace(/\s+/g, " ").trim(); return; }
  const radio = t.closest("[data-radio]");
  if (radio) { $$(`[data-radio="${radio.dataset.radio}"]`).forEach((r) => { r.setAttribute("data-state", r === radio ? "on" : "off"); const lab = r.closest("label"); if (lab) lab.classList.toggle("active", r === radio); }); return; }
  const cycle = t.closest("[data-cycle]");
  if (cycle) { const opts = cycle.dataset.cycle.split(","); const cur = cycle.textContent.trim(); const next = opts[(opts.indexOf(cur) + 1) % opts.length];
    cycle.innerHTML = `${next}<svg width="12" height="12"><use href="#i-chevron-down"/></svg>`; return; }
  const themeBtn = t.closest("[data-theme-set]");
  if (themeBtn) { setTheme(themeBtn.dataset.themeSet); return; }
  if (!t.closest(".menu") && !t.closest("[data-menu]")) closeMenus();
  if (!t.closest("#settings-panel") && !t.closest("#settings-trigger")) { $("#settings-panel").hidden = true; $("#settings-trigger").classList.remove("is-active"); }
  if (!t.closest("#graph-settings") && !t.closest("#graph-settings-trigger")) $("#graph-settings").hidden = true;
  if (!t.closest("#sankey-picker") && !t.closest("#sankey-picker-trigger")) $("#sankey-picker").hidden = true;
});

function setTheme(next) {
  state.theme = next;
  document.documentElement.setAttribute("data-theme", next);
  $("#shell").className = `app-shell theme-${next}${state.chat ? " has-chat" : ""}`;
  $$("[data-theme-set]").forEach((b) => b.setAttribute("data-state", b.dataset.themeSet === next ? "on" : "off"));
  try { parent.postMessage({ type: "prism-theme", theme: next }, "*"); } catch {}
}
$("#settings-trigger").addEventListener("click", () => {
  const p = $("#settings-panel"); p.hidden = !p.hidden;
  $("#settings-trigger").classList.toggle("is-active", !p.hidden);
});
$("#settings-close").addEventListener("click", () => { $("#settings-panel").hidden = true; $("#settings-trigger").classList.remove("is-active"); });
$("#graph-settings-trigger").addEventListener("click", () => { const p = $("#graph-settings"); p.hidden = !p.hidden; $("#graph-settings-trigger").classList.toggle("is-active", !p.hidden); });
$("#graph-settings-close").addEventListener("click", () => { $("#graph-settings").hidden = true; $("#graph-settings-trigger").classList.remove("is-active"); });
$("#sankey-picker-trigger").addEventListener("click", () => { const p = $("#sankey-picker"); p.hidden = !p.hidden; });

$("#all-decimals").addEventListener("click", (e) => {
  const on = e.currentTarget.getAttribute("data-state") === "on";
  e.currentTarget.setAttribute("data-state", on ? "off" : "on");
  e.currentTarget.setAttribute("aria-checked", String(!on));
  state.allDecimals = !on;
  $("#decimals-stepper").classList.toggle("is-disabled", state.allDecimals);
  refreshNumbers();
});
$("#decimals-stepper").addEventListener("click", (e) => {
  const b = e.target.closest("[data-step]"); if (!b || state.allDecimals) return;
  state.decimals = Math.max(0, Math.min(8, state.decimals + Number(b.dataset.step)));
  $("#decimals-value").textContent = state.decimals; refreshNumbers();
});
$$("[data-step]").forEach((b) => b.addEventListener("click", (e) => {
  const wrap = b.closest(".number-stepper"); if (!wrap || wrap.id === "decimals-stepper") return;
  const span = wrap.querySelector("span"); const v = Number(span.textContent) + Number(b.dataset.step);
  if (v >= 1) span.textContent = v;
}));
function refreshNumbers() {
  rendered.clear();
  ensureView(state.view);
  if (state.selected) openInspector(state.selected);
}

$("#inspector-close").addEventListener("click", closeInspector);
$("#ref-amounts").addEventListener("click", () => {
  state.refAmounts = !state.refAmounts;
  $("#ref-amounts").textContent = state.refAmounts ? "Hide reference amounts" : "Show reference amounts";
  if (state.selected) openInspector(state.selected);
});
$$("[data-tool]").forEach((b) => b.addEventListener("click", () => {
  const t = b.dataset.tool;
  if (t === "select") b.classList.toggle("is-active");
  if (t === "expand-all") { NODES.forEach((n) => state.expanded.add(n.id)); renderGraph(); }
  if (t === "collapse-all") { state.expanded.clear(); renderGraph(); }
  if (t === "layout" || t === "fit") renderGraph();
}));
$$("[data-mode]").forEach((b) => b.addEventListener("click", () => {
  $$("[data-mode]").forEach((o) => o.classList.toggle("is-active", o === b));
}));

/* toolbar drag */
(() => {
  const bar = $("#graph-toolbar"), grip = $("#toolbar-grip"); let start = null;
  grip.addEventListener("pointerdown", (e) => {
    const r = bar.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
    grip.setPointerCapture(e.pointerId); e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!start) return;
    const host = bar.parentElement.getBoundingClientRect();
    const left = Math.max(6, Math.min(host.width - bar.offsetWidth - 6, start.left - host.left + e.clientX - start.x));
    const top = Math.max(6, Math.min(host.height - bar.offsetHeight - 6, start.top - host.top + e.clientY - start.y));
    bar.style.left = `${left}px`; bar.style.top = `${top}px`;
  });
  grip.addEventListener("pointerup", () => { start = null; });
})();

/* yaml */
const yamlEl = $("#yaml-text"); yamlEl.value = YAML;
yamlEl.addEventListener("input", () => {
  state.dirty = yamlEl.value !== YAML;
  $("#yaml-status").textContent = state.dirty ? "Unsaved changes. Save to update this session model." : "Saved in this browser session.";
  $("#yaml-status").className = state.dirty ? "yaml-dirty" : "";
  $("#yaml-save").hidden = !state.dirty;
});
$("#yaml-save").addEventListener("click", () => {
  $("#navbar-status").hidden = false; $("#tabs-status").hidden = false;
  setTimeout(() => { $("#navbar-status").hidden = true; $("#tabs-status").hidden = true; state.dirty = false;
    $("#yaml-status").textContent = "Saved in this browser session."; $("#yaml-status").className = ""; $("#yaml-save").hidden = true; }, 1400);
});

/* realtime sliders */
$("#rt-sliders").addEventListener("input", (e) => {
  const r = e.target.closest("[data-rt]"); if (!r) return;
  const s = RT.find((x) => x.id === r.dataset.rt); if (!s) return;
  s.value = Number(r.value); renderRealtime();
  const back = $("#rt-sliders").querySelector(`[data-rt="${s.id}"]`); if (back) { back.focus({ preventScroll: true }); }
});
$("#rt-reset").addEventListener("click", () => { RT.forEach((s) => { s.value = s.def; }); renderRealtime(); });
$("#rt-commit").addEventListener("click", () => { RT.forEach((s) => { s.def = s.value; }); renderRealtime(); });
$("#scenario-reset").addEventListener("click", () => { $("#scenario-panel").hidden = true; });
$("#scenario-commit").addEventListener("click", () => { $("#scenario-panel").hidden = true; });

/* chat */
function setChat(open) {
  state.chat = open;
  $("#shell").className = `app-shell theme-${state.theme}${open ? " has-chat" : ""}`;
  $("#chat-sidebar").hidden = !open;
  $("#chat-pane").setAttribute("aria-hidden", String(!open));
  $("#chat-open").hidden = open || $("#welcome").hidden === false;
}
$("#chat-open").addEventListener("click", () => setChat(true));
$("#chat-close").addEventListener("click", () => setChat(false));
$("#sheet-chat").addEventListener("click", () => { setChat(true); closeSheet(); });
$("#chat-clear").addEventListener("click", () => { CHAT.length = 0; renderChat(); });
$("#chat-send").addEventListener("click", sendChat);
$("#chat-input").addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); } });
$("#chat-input").addEventListener("input", (e) => { e.target.style.height = "auto"; e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`; });
function sendChat() {
  const input = $("#chat-input"), text = input.value.trim(); if (!text) return;
  CHAT.push({ role: "user", text });
  input.value = ""; input.style.height = "auto"; renderChat();
  setTimeout(() => { CHAT.push({ role: "assistant", html: `<p>Climate change for <strong>${state.doc}</strong> is ${fmt(IMPACTS[0].score)} kg CO₂-eq. Polyester yarn contributes 42.6%.</p>` }); renderChat(); }, 550);
}
$("#chat-content").addEventListener("click", (e) => {
  const b = e.target.closest(".ai-chat-suggestions button"); if (!b) return;
  $("#chat-input").value = b.textContent; sendChat();
});
/* chat resize */
(() => {
  const handle = $("#chat-resize"), pane = $("#chat-pane"); let start = null;
  handle.addEventListener("pointerdown", (e) => { start = { x: e.clientX, w: pane.getBoundingClientRect().width }; handle.setPointerCapture(e.pointerId); e.preventDefault(); });
  handle.addEventListener("pointermove", (e) => {
    if (!start) return;
    const w = Math.max(240, Math.min(window.innerWidth - 80, start.w - (e.clientX - start.x)));
    pane.style.width = `${w}px`;
  });
  handle.addEventListener("pointerup", () => { start = null; });
})();

/* nav sheet */
function openSheet() { $("#nav-sheet").hidden = false; $("#nav-backdrop").hidden = false; }
function closeSheet() { $("#nav-sheet").hidden = true; $("#nav-backdrop").hidden = true; }
$("#nav-toggle").addEventListener("click", openSheet);
$("#nav-close").addEventListener("click", closeSheet);
$("#nav-backdrop").addEventListener("click", closeSheet);

/* rename */
[["#navbar-model-title"], ["#nav-model-title"], ["#sheet-rename"]].forEach(([sel]) => {
  const el = $(sel); if (!el) return;
  el.addEventListener("click", (e) => {
    if (sel === "#sheet-rename" && !e.target.closest("span")) return;
    const next = prompt("Rename model", state.doc);
    if (!next) return;
    state.doc = next;
    ["#study-title", "#navbar-model-title", "#nav-model-title"].forEach((s) => { const n = $(s); if (n) n.textContent = next; });
    const sr = $("#sheet-rename"); if (sr) sr.firstChild.textContent = next;
  });
});

/* dialogs */
$("#menu-save-as").addEventListener("click", () => { closeMenus(); $("#saveas-dialog").hidden = false; });
$("#menu-save").addEventListener("click", () => { closeMenus(); $("#unsaved-dialog").hidden = false; });
$$("[data-close-dialog]").forEach((b) => b.addEventListener("click", () => { b.closest(".dialog-backdrop").hidden = true; }));
$("#saveas-confirm").addEventListener("click", () => {
  const name = $("#saveas-name").value.trim();
  if (!name) { $("#saveas-error").hidden = false; return; }
  $("#saveas-error").hidden = true; $("#saveas-dialog").hidden = true;
  state.doc = name; ["#study-title", "#navbar-model-title", "#nav-model-title", "#sheet-rename"].forEach((s) => { const n = $(s); if (n) n.textContent = name; });
});
$$(".dialog-backdrop").forEach((d) => d.addEventListener("click", (e) => { if (e.target === d) d.hidden = true; }));
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  closeMenus(); closeSheet();
  $$(".dialog-backdrop").forEach((d) => { d.hidden = true; });
  $("#settings-panel").hidden = true; $("#graph-settings").hidden = true; $("#sankey-picker").hidden = true;
});

/* keep geometry live on resize — the whole point of the mockup.
   Debounced through rAF and driven off the viewport only: observing an element
   whose subtree we then mutate would feed the observer back into itself. */
let relayoutFrame = 0, lastW = 0, lastH = 0;
function relayout() {
  cancelAnimationFrame(relayoutFrame);
  relayoutFrame = requestAnimationFrame(() => {
    if (state.view === "graph") layoutGraph();
    else if (state.view === "sankey") renderSankey();
  });
}
window.addEventListener("resize", () => {
  const w = window.innerWidth, h = window.innerHeight;
  if (w === lastW && h === lastH) return;
  lastW = w; lastH = h; relayout();
});
/* In a resizable frame the window resize event can land before the shell has
   settled at its new size, leaving the measured layout stale. Observing the
   workspace box itself re-runs layout against geometry that is already final.
   The size guard matters: layout writes into elements inside the observed box,
   so re-running unconditionally would feed back into itself. */
if (window.ResizeObserver) {
  const ws = $("#workspace") || document.querySelector(".workspace");
  if (ws) {
    let wsW = 0, wsH = 0;
    new ResizeObserver((entries) => {
      const r = entries[0] && entries[0].contentRect;
      if (!r) return;
      const w = Math.round(r.width), h = Math.round(r.height);
      if (w === wsW && h === wsH) return;
      wsW = w; wsH = h; relayout();
    }).observe(ws);
  }
}
window.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "prism-set-theme") setTheme(d.theme);
  if (d.type === "prism-set-view") { if (d.view === "welcome") { showWelcome(); } else { enterApp(); setView(d.view); } }
  if (d.type === "prism-set-chat") setChat(!!d.open);
});

/* boot */
renderChat();
// Test/harness hook: force a settled re-layout (transitions can be throttled in
// offscreen frames, which makes measured geometry unreliable).
window.__prismRelayout = () => { if (state.view === "graph") layoutGraph(); else if (state.view === "sankey") renderSankey(); };
setTheme("dark"); setView("graph");
// #view=impact&theme=light&chat=1 — used by the harness and handy for deep links
const hash = new URLSearchParams(location.hash.replace(/^#/, ""));
if (hash.get("theme") === "light") setTheme("light");
const hv = hash.get("view");
if (hv && hv !== "welcome") { enterApp(); setView(hv); } else showWelcome();
if (hash.get("chat") === "1") { enterApp(); setChat(true); }
if (hash.get("inspector") === "1") { enterApp(); setView("graph"); openInspector("fabric"); }
})();
