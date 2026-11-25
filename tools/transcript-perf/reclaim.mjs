/**
 * 静默回收的真机验收（零依赖，Node ≥ 22，走 CDP）。
 *
 * **只在 dev 构建上跑。** 回收靠那只五分钟的定时器推，等一轮就是五分钟，四个阶段下来没法做；
 * 开发构建里 `use-history-reclaim.ts` 会把手动入口 `__facetReclaimNow` 挂到 globalThis 上
 * （生产产物里没有，整段被静态去掉）。没有这个入口时脚本直接报错退出，不退回干等。
 *
 * 用法：
 *   REMOTE_DEBUGGING_PORT=9333 npm run dev
 *   node tools/transcript-perf/reclaim.mjs --port 9333 --session "会话标题片段" --target 320
 *
 * 自行完成四件事：
 *   1. 三阶段内存对比：刚打开（2 页）→ 翻到 target 行并回到近期区（回收前）→ 回收后；
 *   2. 非贴底回收的 0px 锚点偏差；
 *   3. 贴底回收保持贴底；
 *   4. 旧历史页保护（停在更早的页时一轮都不裁）与回收后再翻页的一致性。
 *
 * 判据（回收本身在 `packages/ui/src/transcript/reclaim-gate.ts`）：
 *   - 回收后行数与 LayoutObjects 明显回落，接近初始 2 页基线；
 *   - 锚点行在回收前后的 `getBoundingClientRect().top` 差 ≤ 0.5px；
 *   - 停在旧页时行数、scrollTop、内容一律不变；
 *   - 回收后再补历史，拉回的条目序列与回收前的同位置序列完全一致。
 */
const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};
const PORT = Number(arg("port", 9333));
const SESSION = arg("session", "facet");
const TARGET = Number(arg("target", 320));
/**
 * 开发构建里那个手动推开（`use-history-reclaim.ts` 只在 `import.meta.env.DEV` 时挂）。
 *
 * 走的仍是同一套判据与裁剪，只是不干等周期。
 */
const TRIGGER = "globalThis.__facetReclaimNow()";
/** 判据要求最近一次交互之后安静 10 秒，推之前先等过去 */
const IDLE_SETTLE_MS = 11_000;
const BASE = `http://127.0.0.1:${PORT}`;

const page = await (async () => {
	const list = await (await fetch(`${BASE}/json/list`)).json();
	const found = list.find((target) => target.type === "page");
	if (!found) throw new Error("没有找到页面目标，app 起来了么？");
	return found;
})();
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve, { once: true });
	ws.addEventListener("error", reject, { once: true });
});
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	const slot = message.id === undefined ? undefined : waiting.get(message.id);
	if (slot === undefined) return;
	waiting.delete(message.id);
	if (message.error) slot.reject(new Error(JSON.stringify(message.error)));
	else slot.resolve(message.result ?? {});
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
const log = (line) => console.log(line);

await send("Runtime.enable");
await send("Performance.enable");
await send("HeapProfiler.enable");
await send("Page.bringToFront");
await send("Page.setWebLifecycleState", { state: "active" });

// 没有手动入口就是生产构建：回收只能等五分钟一轮，这套验收跑不了，直接不测
if ((await ev("typeof globalThis.__facetReclaimNow === 'function'")) !== true) {
	throw new Error(
		"页面里没有 __facetReclaimNow：这是生产构建。回收验收只在 dev 构建上跑（REMOTE_DEBUGGING_PORT=... npm run dev）",
	);
}

/** 回收一次垃圾再读内存与布局对象数。 */
const memory = async () => {
	await send("HeapProfiler.collectGarbage");
	const got = {};
	for (const metric of (await send("Performance.getMetrics")).metrics) got[metric.name] = metric.value;
	return {
		行数: await ev("__r.rows().length"),
		Nodes: got.Nodes,
		LayoutObjects: got.LayoutObjects,
		heapMB: Math.round(got.JSHeapUsedSize / 1048576),
	};
};

/* ---------------- 注入页面侧的测量辅助 ---------------- */
await ev(`
window.__r = {
  sc() { return document.querySelector('.scroll'); },
  rows() { return Array.from(document.querySelectorAll('.scroll .row')); },
  ticks() { return Array.from(document.querySelectorAll('.outline-tick')); },
  more() { return document.querySelector('.outline-more'); },
  keys() { return this.ticks().map((t) => t.getAttribute('aria-label')); },
  topIndex() {
    const sc = this.sc(); const top = sc.getBoundingClientRect().top;
    const rows = this.rows();
    for (let i = 0; i < rows.length; i++) if (rows[i].getBoundingClientRect().bottom > top) return i;
    return null;
  },
  topRowRect() { const i = this.topIndex(); return i === null ? null : +this.rows()[i].getBoundingClientRect().top.toFixed(2); },
  /** 给视口顶行打个标记：裁完按这个标记找回同一行，量它有没有动 */
  markTop() {
    for (const row of this.rows()) row.removeAttribute('data-anchor');
    const i = this.topIndex(); if (i === null) return null;
    this.rows()[i].setAttribute('data-anchor', '1');
    return this.topRowRect();
  },
  /** 标记那一行现在的顶边；行被裁掉时为空 */
  anchorTop() { const row = document.querySelector('[data-anchor]'); return row ? +row.getBoundingClientRect().top.toFixed(2) : null; },
  state() {
    const viewport = document.querySelector('.chat-viewport');
    const sc = this.sc();
    return { rows: this.rows().length, ticks: this.ticks().length,
      scrollTop: Math.round(sc.scrollTop), scrollHeight: Math.round(sc.scrollHeight),
      canBottom: viewport?.getAttribute('data-can-scroll-bottom'),
      distance: Math.round(sc.scrollHeight - sc.scrollTop - sc.clientHeight) };
  },
  lockCheck() {
    const sc = this.sc(); const rows = this.rows();
    const before = sc.scrollHeight;
    for (const r of rows) r.classList.add('is-measuring');
    const real = sc.scrollHeight;
    for (const r of rows) r.classList.remove('is-measuring');
    return { 测量前: Math.round(before), 真实: Math.round(real), 误差: +(sc.scrollHeight - real).toFixed(2),
      已写回行数: rows.filter((r) => r.style.containIntrinsicBlockSize !== '').length, 行数: rows.length };
  },
};
true`);

/* ---------------- 打开会话 ---------------- */
const sessionIndex = await ev(
	`Array.from(document.querySelectorAll('.sb-row-item')).findIndex(function (el) {
		var n = el.querySelector('.sb-row-title');
		return n && n.textContent.indexOf(${JSON.stringify(SESSION)}) >= 0; })`,
);
if (sessionIndex < 0) throw new Error(`没找到标题含 "${SESSION}" 的会话`);
log(`会话序号 ${sessionIndex}，标题含「${SESSION}」`);
const openSession = async () => {
	await ev(
		`(() => { const item = document.querySelectorAll('.sb-row-item')[${sessionIndex}];
			item.querySelector('button')?.click(); return 1; })()`,
	);
	for (let waited = 0; waited < 60_000; waited += 500) {
		if ((await ev("__r.rows().length")) > 0) break;
		await sleep(500);
	}
	await sleep(1200);
};

const results = {};

/**
 * 等一轮静默回收真的发生。
 *
 * 生产构建里只有那只五分钟的定时器在推它，没有任何手动入口——所以这里只能等，
 * 触发成功与否以行数下降为准。
 */
const reclaimOnce = async (baselineRows) => {
	for (let attempt = 0; attempt < 3; attempt += 1) {
		await sleep(IDLE_SETTLE_MS);
		await ev(TRIGGER);
		await sleep(800);
		if ((await ev("__r.rows().length")) < baselineRows) return true;
	}
	return false;
};

/* ---------------- 阶段一：初始两页基线 ---------------- */
await openSession();
await ev(
	"(() => { const sc = __r.sc(); sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); return 1; })()",
);
await sleep(1500);
results.阶段一_初始两页 = { ...(await memory()), ...(await ev("__r.state()")) };
log(`\n### 阶段一：刚打开（初始 2 页）\n${JSON.stringify(results.阶段一_初始两页, null, 1)}`);

/* ---------------- 翻到目标规模 ---------------- */
const paginate = async (target) => {
	for (let step = 0; step < 30; step += 1) {
		const rows = await ev("__r.rows().length");
		if (rows >= target) return rows;
		await ev("(() => { const b = __r.more(); if (b && !b.disabled) { b.click(); return 1; } return 0; })()");
		await sleep(2200);
	}
	return await ev("__r.rows().length");
};
const keysBefore = await ev("__r.keys()");
const rowsAfterPaging = await paginate(TARGET);
log(`\n翻页到 ${rowsAfterPaging} 行（目标 ${TARGET}），竖轨 ${keysBefore.length} 条`);

/* ---------------- 阶段二：回到近期区（非贴底），回收前 ---------------- */
await ev(
	"(() => { const sc = __r.sc(); sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); return 1; })()",
);
await sleep(1200);
// 往上退一点：离开贴底，但仍在最新两页里，离裁剪线还有十几行
await ev(
	"(() => { const sc = __r.sc(); sc.scrollTop = Math.max(0, sc.scrollHeight - sc.clientHeight - 320); sc.dispatchEvent(new Event('scroll')); return 1; })()",
);
await sleep(1200);
results.阶段二_回收前 = { ...(await memory()), ...(await ev("__r.state()")) };
log(
	`\n### 阶段二：翻到 ${rowsAfterPaging} 行后回到近期区（回收前）\n${JSON.stringify(results.阶段二_回收前, null, 1)}`,
);

/* ---------------- 静默回收：非贴底 ---------------- */
const before = await ev("__r.state()");
const anchorBefore = await ev("__r.markTop()");
const reclaimed = await reclaimOnce(before.rows);
log(`\n手动推一轮后${reclaimed ? "发生回收" : "未观测到回收"}`);
const after = await ev("__r.state()");
const anchorAfter = await ev("__r.anchorTop()");
results.非贴底回收 = {
	已回收: reclaimed,
	行数前: before.rows,
	行数后: after.rows,
	锚点顶边前: anchorBefore,
	锚点顶边后: anchorAfter,
	偏差px: anchorBefore === null || anchorAfter === null ? null : +(anchorAfter - anchorBefore).toFixed(2),
	贴底前: before.canBottom,
	贴底后: after.canBottom,
};
log(`\n### 非贴底回收：0px 锚点\n${JSON.stringify(results.非贴底回收, null, 1)}`);

/* ---------------- 阶段三：回收后 ---------------- */
results.阶段三_回收后 = { ...(await memory()), ...(await ev("__r.state()")) };
log(`\n### 阶段三：回收后\n${JSON.stringify(results.阶段三_回收后, null, 1)}`);

/* ---------------- 回收后再翻页：序列一致性 ---------------- */
const keysAfterTrim = await ev("__r.keys()");
await paginate(results.阶段一_初始两页.rows + 2);
const keysRecovered = await ev("__r.keys()");
const suffixOf = (keys) => keys.slice(keys.length - keysAfterTrim.length);
results.再翻页一致性 = {
	回收前竖轨条数: keysBefore.length,
	回收后竖轨条数: keysAfterTrim.length,
	补回竖轨条数: keysRecovered.length,
	回收后是回收前的后缀: JSON.stringify(suffixOf(keysBefore)) === JSON.stringify(keysAfterTrim),
	重复条数: keysRecovered.length - new Set(keysRecovered).size,
	补回后与回收前前缀一致:
		JSON.stringify(keysRecovered) === JSON.stringify(keysBefore.slice(0, keysRecovered.length)),
	首条: keysRecovered[0],
};
log(`\n### 回收后再翻页\n${JSON.stringify(results.再翻页一致性, null, 1)}`);

/* ---------------- 贴底回收 ---------------- */
await ev(
	"(() => { const sc = __r.sc(); sc.scrollTop = sc.scrollHeight; sc.dispatchEvent(new Event('scroll')); return 1; })()",
);
await sleep(1500);
const pinnedBefore = await ev("__r.state()");
const pinnedAnchorBefore = await ev("__r.markTop()");
const pinnedReclaimed = await reclaimOnce(pinnedBefore.rows);
const pinnedAfter = await ev("__r.state()");
const pinnedAnchorAfter = await ev("__r.anchorTop()");
results.贴底回收 = {
	已回收: pinnedReclaimed,
	回收前: pinnedBefore,
	回收后: pinnedAfter,
	锚点顶边前: pinnedAnchorBefore,
	锚点顶边后: pinnedAnchorAfter,
	锚点偏差px:
		pinnedAnchorBefore === null || pinnedAnchorAfter === null
			? null
			: +(pinnedAnchorAfter - pinnedAnchorBefore).toFixed(2),
};
log(`\n### 贴底回收\n${JSON.stringify(results.贴底回收, null, 1)}`);

/* ---------------- 旧页保护 ---------------- */
await paginate(results.阶段三_回收后.rows + 4);
await ev(
	"(() => { const sc = __r.sc(); sc.scrollTop = 0; sc.dispatchEvent(new Event('scroll')); return 1; })()",
);
await sleep(1500);
const oldPageBefore = await ev("__r.state()");
const oldPageKeys = await ev("__r.keys()");
const oldPageAt = Date.now();
// 推一轮：判据被旧页挡住的话，行数与位置都不该动
await sleep(IDLE_SETTLE_MS);
await ev(TRIGGER);
await sleep(800);
const oldPageNow = await ev("__r.state()");
const oldPageChanged =
	oldPageNow.rows !== oldPageBefore.rows || oldPageNow.scrollTop !== oldPageBefore.scrollTop;
const oldPageAfter = await ev("__r.state()");
results.旧页保护 = {
	等待时长s: Math.round((Date.now() - oldPageAt) / 1000),
	被改动: oldPageChanged,
	回收前: oldPageBefore,
	回收后: oldPageAfter,
	竖轨未变: JSON.stringify(await ev("__r.keys()")) === JSON.stringify(oldPageKeys),
};
log(`\n### 旧页保护\n${JSON.stringify(results.旧页保护, null, 1)}`);

/* ---------------- 交互回归：高亮、测高锁定、smooth 跳转 ---------------- */
const jump = async (tickIndex) => {
	await ev(`(() => { const t = __r.ticks()[${tickIndex}]; if (t) t.click(); return 1; })()`);
	await sleep(2500);
	return await ev(`(() => {
		const t = __r.ticks()[${tickIndex}];
		// 竖轨一条对一行：第 n 条短条就是第 n 个带 data-outline-key 的行
		const row = document.querySelectorAll('[data-outline-key]')[${tickIndex}];
		const sc = __r.sc();
		return { 选中: t?.getAttribute('aria-selected'),
			落点误差: row ? +(row.getBoundingClientRect().top - sc.getBoundingClientRect().top - 12).toFixed(1) : null };
	})()`);
};
results.交互回归 = {
	测高锁定: await ev("__r.lockCheck()"),
	跳到底部一条: await jump((await ev("__r.ticks().length")) - 1),
	跳到顶部一条: await jump(0),
	连点: await ev(`(async () => {
		const ticks = __r.ticks();
		for (let i = ticks.length - 1; i >= 0; i -= 1) { ticks[i].click(); await new Promise((r) => setTimeout(r, 180)); }
		await new Promise((r) => setTimeout(r, 900));
		return { 点击: ticks.length, 状态: __r.state() };
	})()`),
};
log(`\n### 交互回归\n${JSON.stringify(results.交互回归, null, 1)}`);

await import("node:fs").then(({ writeFileSync }) => {
	writeFileSync("reclaim-result.json", JSON.stringify(results, null, 1));
});
log("\n原始数据已写入 reclaim-result.json");
ws.close();
