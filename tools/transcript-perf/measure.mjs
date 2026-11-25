/**
 * 正文行高增量测高的真机压测脚本（零依赖，Node ≥ 22，走 CDP）。
 *
 * 用法：
 *   先按生产构建启动并带上调试端口（窗口必须在前台可见，否则浏览器会停掉帧的生产）：
 *     facet.exe --remote-debugging-port=9222
 *   再跑：
 *     node tools/transcript-perf/measure.mjs --port 9222 --session <会话标题片段> --rowsA 182 --rowsB 320
 *
 * 自行完成：找会话 → 反复翻页到指定行数 → 空闲帧间隔 / 全量扫描 / 高度锁定 / 双向长途跳转 /
 *           滚动 / 快速连点 / 改宽重测 / 内存，打印两组数据并在当前目录写 measure-result.json。
 *
 * 判定线（正文行用 content-visibility: auto + 写回的兜底高度，所以这几项是硬指标）：
 *   - 跳转途中 scrollHeight 变化必须是 0 次、反向位移帧必须是 0、落点误差 ≤ 20px；
 *   - 全量扫描 ≤ 200ms，改宽重测 ≤ 200ms，改宽后阅读位置漂移 ≤ 30px；
 *   - 滚动与跳转中超过一个 vsync 的帧占比 ≤ 10%。
 *
 * 翻页（loadOlder）会插入整页并带来几十到两百毫秒的长任务，那是另一条线的问题：量跳转本身时
 * 要把会话整份加载完，否则量到的是翻页的抖动。
 */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
const PORT = Number(arg("port", 9222));
const SESSION = arg("session", "bugfix");
const ROWS_A = Number(arg("rowsA", 182));
const ROWS_B = Number(arg("rowsB", 320));

const BASE = `http://127.0.0.1:${PORT}`;
const KEYS = [
	"TaskDuration",
	"ScriptDuration",
	"LayoutDuration",
	"RecalcStyleDuration",
	"LayoutCount",
	"RecalcStyleCount",
];

const { webSocketDebuggerUrl } = await (async () => {
	const list = await (await fetch(`${BASE}/json/list`)).json();
	const page = list.find((t) => t.type === "page");
	if (!page) throw new Error("没有找到页面目标，app 起来了么？");
	return page;
})();

const ws = new WebSocket(webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve, { once: true });
	ws.addEventListener("error", reject, { once: true });
});
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	if (message.id !== undefined && waiting.has(message.id)) {
		const { resolve, reject } = waiting.get(message.id);
		waiting.delete(message.id);
		if (message.error) reject(new Error(JSON.stringify(message.error)));
		else resolve(message.result ?? {});
	}
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		seq += 1;
		waiting.set(seq, { resolve, reject });
		ws.send(JSON.stringify({ id: seq, method, params }));
	});
const ev = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails)
		throw new Error(result.exceptionDetails.exception?.description ?? "evaluate failed");
	return result.result?.value;
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

await send("Runtime.enable");
await send("Performance.enable");
await send("HeapProfiler.enable");
await send("Page.enable");
await send("Page.bringToFront");

const metrics = async () => {
	const got = {};
	for (const m of (await send("Performance.getMetrics")).metrics) got[m.name] = m.value;
	return got;
};
const delta = (before, after) => {
	const out = {};
	for (const key of KEYS)
		out[key] = Math.round((after[key] - before[key]) * ("Duration" in key ? 1000 : 1) * 100) / 100;
	return out;
};

/* ---- 注入测量辅助 ---- */
await ev(`
window.__p = {
  sc() { return document.querySelector('.scroll'); },
  rows() { return Array.from(document.querySelectorAll('.scroll .row')); },
  stats(durations, ceiling) {
    const s = durations.slice().sort((a, b) => a - b);
    const q = (p) => +(s[Math.min(s.length - 1, Math.floor(s.length * p))] ?? 0).toFixed(2);
    return { frames: s.length, p50: q(.5), p95: q(.95), max: +(s[s.length - 1] ?? 0).toFixed(2),
             overVsync: s.filter((x) => x > ceiling * 1.06).length,
             overVsyncPct: +((s.filter((x) => x > ceiling * 1.06).length / Math.max(1, s.length)) * 100).toFixed(1) };
  },
  fullScan() {
    const rows = this.rows();
    for (const r of rows) r.classList.add('is-measuring');
    const t0 = performance.now();
    const heights = rows.map((r) => r.getBoundingClientRect().height);
    for (let i = 0; i < rows.length; i++) rows[i].style.containIntrinsicBlockSize = heights[i] + 'px';
    const ms = +(performance.now() - t0).toFixed(2);
    for (const r of rows) r.classList.remove('is-measuring');
    return { rows: rows.length, ms };
  },
  lockCheck() {
    const sc = this.sc(); const rows = this.rows();
    const before = sc.scrollHeight;
    const inline = rows.filter((r) => r.style.containIntrinsicBlockSize !== '').length;
    for (const r of rows) r.classList.add('is-measuring');
    const real = sc.scrollHeight;
    for (const r of rows) r.classList.remove('is-measuring');
    return { 测量前: Math.round(before), 真实: Math.round(real), 恢复: Math.round(sc.scrollHeight),
             误差: +(sc.scrollHeight - real).toFixed(2), 已写回行数: inline };
  },
  async jump(tickIndex, ceiling, waitMs) {
    const sc = this.sc();
    const ticks = Array.from(document.querySelectorAll('.outline-tick'));
    const samples = []; const gaps = []; let running = true; let last = performance.now();
    const long = []; let obs = null;
    try { obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(Math.round(e.duration)); });
          obs.observe({ entryTypes: ['longtask'] }); } catch (e) {}
    const rec = (now) => { gaps.push(now - last); last = now;
      samples.push({ top: sc.scrollTop, h: sc.scrollHeight }); if (running) requestAnimationFrame(rec); };
    requestAnimationFrame(rec);
    ticks[tickIndex].click();
    await new Promise((r) => setTimeout(r, waitMs));
    running = false; await new Promise((r) => setTimeout(r, 50));
    if (obs) obs.disconnect();
    const start = samples[0].top, end = samples[samples.length - 1].top;
    const dir = Math.sign(end - start) || 1;
    let hChanges = 0, back = 0, lastH = samples[0].h;
    for (let k = 1; k < samples.length; k++) {
      if (samples[k].h !== lastH) { hChanges++; lastH = samples[k].h; }
      const d = samples[k].top - samples[k - 1].top;
      if (Math.sign(d) === -dir && Math.abs(d) > 0.5) back++;
    }
    const row = Array.from(document.querySelectorAll('[data-outline-key]'))[tickIndex];
    return Object.assign({ 方向: dir < 0 ? '向上' : '向下', 位移: Math.round(end - start),
      途中高度变化: hChanges, 反向帧: back,
      落点误差: row ? +(row.getBoundingClientRect().top - sc.getBoundingClientRect().top).toFixed(1) : null,
      longTasks: long.length, longTaskMax: long.length ? Math.max(...long) : 0 }, this.stats(gaps.slice(1), ceiling));
  },
  async rapid(gapMs) {
    const sc = this.sc(); const ticks = Array.from(document.querySelectorAll('.outline-tick'));
    let hChanges = 0, lastH = sc.scrollHeight;
    const timer = setInterval(() => { if (sc.scrollHeight !== lastH) { hChanges++; lastH = sc.scrollHeight; } }, 16);
    for (let i = ticks.length - 1; i >= 0; i--) { ticks[i].click(); await new Promise((r) => setTimeout(r, gapMs)); }
    await new Promise((r) => setTimeout(r, 900));
    clearInterval(timer);
    return { 点击: ticks.length, 途中高度变化: hChanges };
  },
  async wheel(steps) {
    const sc = this.sc();
    const gaps = []; let last = performance.now(); let i = 0;
    return await new Promise((resolve) => {
      const step = (now) => { gaps.push(now - last); last = now;
        sc.scrollTop += (Math.floor(i / 40) % 2 === 0 ? 60 : -60); i++;
        if (i < steps) requestAnimationFrame(step);
        else resolve({ steps: i, gaps }); };
      requestAnimationFrame(step);
    });
  },
  setWidth(px) { document.querySelector('.app').style.setProperty('--panel-width', px + 'px'); },
  topRowRect() { const sc = this.sc(); const top = sc.getBoundingClientRect().top;
    const row = this.rows().find((r) => r.getBoundingClientRect().bottom > top + 8);
    return row ? +row.getBoundingClientRect().top.toFixed(1) : null; },
};
true`);

const idle = await ev(`new Promise((resolve) => { const g = []; let last = performance.now(); const t0 = last;
  const step = (now) => { g.push(now - last); last = now;
    if (now - t0 < 1500) requestAnimationFrame(step);
    else { const s = g.slice(1).sort((a, b) => a - b); resolve({ frames: s.length, p50: +(s[Math.floor(s.length / 2)] ?? 0).toFixed(2) }); } };
  requestAnimationFrame(step); })`);
const ceiling = idle.p50;
console.log(
	`实测帧间隔 p50 = ${ceiling}ms（约 ${Math.round(1000 / ceiling)}Hz）；刷新率异常时先确认窗口在前台可见。`,
);

const sessionIndex = await ev(
	`Array.from(document.querySelectorAll('.sb-row-item')).findIndex(function (el) {
		var n = el.querySelector('.sb-row-title');
		return n && n.textContent.indexOf(${JSON.stringify(SESSION)}) >= 0; })`,
);
if (sessionIndex < 0) throw new Error(`没找到标题含 "${SESSION}" 的会话`);
const openSession = async () => {
	await ev(`document.querySelectorAll('.sb-row-item')[${sessionIndex}].querySelector('button').click()`);
	await sleep(2000);
};
const paginate = async (target) => {
	for (let i = 0; i < 18; i += 1) {
		if ((await ev("__p.rows().length")) >= target) return;
		await ev(
			"(() => { const sc = __p.sc(); sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); return 1; })()",
		);
		await sleep(1500);
	}
};

const results = [];
const measureScale = async (label, target) => {
	await openSession();
	await paginate(target);
	const size = await ev(`({rows: __p.rows().length, ticks: document.querySelectorAll('.outline-tick').length,
		elements: document.querySelectorAll('.scroll *').length, h: Math.round(__p.sc().scrollHeight)})`);
	const scan = await ev("__p.fullScan()");
	const lock = await ev("__p.lockCheck()");
	const table = { label, size, 全量扫描ms: scan.ms, 高度锁定: lock };

	for (const [name, tickIndex] of [
		["底→顶", 0],
		["顶→底", size.ticks - 1],
	]) {
		await ev(
			"(() => { const sc = __p.sc(); sc.scrollTop = Math.round(sc.scrollHeight * 0.5); sc.dispatchEvent(new Event('scroll')); return 1; })()",
		);
		await sleep(800);
		const before = await metrics();
		const jump = await ev(`__p.jump(${tickIndex}, ${ceiling}, 3500)`);
		const after = await metrics();
		table[name] = { ...jump, 净增量: delta(before, after) };
	}

	const scroll = await ev("__p.wheel(200)");
	table.滚动200步 = await ev(`__p.stats(${JSON.stringify(scroll.gaps.slice(1))}, ${ceiling})`);
	table.连点 = await ev("__p.rapid(220)");

	const anchorBefore = await ev("__p.topRowRect()");
	const before = await metrics();
	await ev("__p.setWidth(520)");
	await sleep(1200);
	const after = await metrics();
	const anchorAfter = await ev("__p.topRowRect()");
	table.改宽 = {
		锚点漂移px:
			anchorBefore === null || anchorAfter === null
				? null
				: Math.round((anchorAfter - anchorBefore) * 10) / 10,
		净增量: delta(before, after),
		高: await ev("Math.round(__p.sc().scrollHeight)"),
	};

	await send("HeapProfiler.collectGarbage");
	const mem = await metrics();
	table.内存 = {
		Nodes: mem.Nodes,
		LayoutObjects: mem.LayoutObjects,
		heapMB: Math.round(mem.JSHeapUsedSize / 1048576),
	};
	results.push(table);
	console.log(`\n### ${label}`);
	console.log(JSON.stringify(table, null, 1));
};

await measureScale(`规模 A（目标 ${ROWS_A} 行）`, ROWS_A);
await measureScale(`规模 B（目标 ${ROWS_B} 行）`, ROWS_B);

await import("node:fs").then(({ writeFileSync }) => {
	writeFileSync("measure-result.json", JSON.stringify({ ceiling, results }, null, 1));
});
console.log("\n原始数据已写入 measure-result.json");
ws.close();
