/**
 * 正文「流式输出 + 滚动」的帧预算测量（零依赖，Node ≥ 22，走 CDP）。
 *
 * 为什么单列一个脚本：`measure.mjs` 量的是测高与跳转落点，回答不了"边流边滚卡不卡"。
 * 这里量的是**每帧主线程工作量**与**每秒各项占用**，再看它们占掉一帧预算的多少。
 *
 * 两种启动口径回答两个不同问题：
 *   1. 正常启动（vsync 开）：量"这台机器这把刷新率上有没有掉帧"，看超预算帧的比例与长任务；
 *   2. `--disable-gpu-vsync --disable-frame-rate-limit` 启动：rAF 不再等垂直同步，此时
 *      **每帧毫秒数就是每帧真实成本**，可以换算出任何刷新率下的余量——换机器、换屏都用它。
 *      这种口径下"每秒帧数"没有意义，别拿去做横向比较。
 *
 * 用法：
 *   1) 用生产构建启动并带调试端口（窗口必须在前台可见，后台时浏览器会停掉帧的生产）：
 *        facet.exe --remote-debugging-port=9222
 *      要量每帧成本再加上：--disable-gpu-vsync --disable-frame-rate-limit
 *   2) 跑：
 *        node tools/transcript-perf/stream-frames.mjs --port 9222 --session 性能测试 --rows 300
 *
 * 注意：主机每五分钟会静默回收更早的历史，大会话会自己缩水；脚本会先把行数补到 `--rows`
 * 再开测（用竖轨顶端的「…」逐页补），否则量到的是小会话。
 */

const argv = process.argv.slice(2);
const arg = (name, fallback) => {
	const at = argv.indexOf(`--${name}`);
	return at >= 0 && argv[at + 1] !== undefined ? argv[at + 1] : fallback;
};

const PORT = Number(arg("port", 9222));
const SESSION = arg("session", "");
const TARGET_ROWS = Number(arg("rows", 300));
const PROMPT = arg(
	"prompt",
	"压测用，请照做：先用 bash 依次执行 4 条无害命令（每次 `date +%T`），每条后写两句说明；" +
		"然后写一篇 1500 字左右的技术讲解「浏览器如何决定一帧的时间预算」，包含 5 个二级标题、" +
		"4 个 TypeScript 代码块（各 40 行左右）和 2 个 10 行表格。",
);

/** 要展示的刷新率档位：换算成"每帧预算被用掉多少"。 */
const REFRESH_RATES = [60, 100, 120, 144, 160, 180, 240];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const BASE = `http://127.0.0.1:${PORT}`;

const target = await (async () => {
	const list = await (await fetch(`${BASE}/json/list`)).json();
	const page = list.find((entry) => entry.type === "page");
	if (page === undefined) throw new Error("没有找到页面目标，应用起来了吗？");
	return page;
})();

const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
	ws.addEventListener("open", resolve, { once: true });
	ws.addEventListener("error", reject, { once: true });
});
let seq = 0;
const waiting = new Map();
ws.addEventListener("message", (event) => {
	const message = JSON.parse(event.data);
	const pending = message.id === undefined ? undefined : waiting.get(message.id);
	if (pending === undefined) return;
	waiting.delete(message.id);
	if (message.error) pending.reject(new Error(JSON.stringify(message.error)));
	else pending.resolve(message.result ?? {});
});
const send = (method, params = {}) =>
	new Promise((resolve, reject) => {
		seq += 1;
		waiting.set(seq, { resolve, reject });
		ws.send(JSON.stringify({ id: seq, method, params }));
	});
const evaluate = async (expression) => {
	const result = await send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
	if (result.exceptionDetails) {
		throw new Error(result.exceptionDetails.exception?.description ?? "页面里的表达式出错");
	}
	return result.result?.value;
};
const metrics = async () => {
	const got = {};
	for (const entry of (await send("Performance.getMetrics")).metrics ?? []) got[entry.name] = entry.value;
	return got;
};

await send("Runtime.enable");
await send("Page.enable");
await send("Performance.enable");
await send("Page.bringToFront");

/* ---- 口径：rAF 节拍。p50 ≈ 刷新间隔说明 vsync 开着；远小于它说明是不限帧模式 ---- */
const cadence = await evaluate(`new Promise((resolve) => {
	const gaps = []; let last = performance.now(); const start = last;
	const step = (now) => {
		gaps.push(now - last); last = now;
		if (now - start < 1000) requestAnimationFrame(step);
		else {
			const sorted = gaps.slice(1).sort((a, b) => a - b);
			resolve({ frames: sorted.length, p50: +sorted[Math.floor(sorted.length / 2)].toFixed(2) });
		}
	};
	requestAnimationFrame(step);
})`);
const unlimited = cadence.p50 < 5;
console.log(
	`rAF 节拍 p50 ${cadence.p50}ms（约 ${Math.round(1000 / cadence.p50)} 帧/秒）→ ${
		unlimited ? "不限帧模式：每帧毫秒数=每帧成本" : "vsync 模式：看超预算帧比例"
	}`,
);

/* ---- 打开目标会话（侧栏必须展开，否则会话列表不在 DOM 里） ---- */
const titles = await evaluate(
	"Array.from(document.querySelectorAll('.sb-row-item')).map((el) => (el.querySelector('.sb-row-title')?.textContent ?? '').trim())",
);
if (titles.length === 0) {
	console.error("侧栏没有会话行：先把左侧栏展开再跑。");
	ws.close();
	process.exit(1);
}
const index = SESSION === "" ? 0 : titles.findIndex((title) => title.includes(SESSION));
if (index < 0) throw new Error(`没找到标题含 "${SESSION}" 的会话`);
console.log(`打开会话：${titles[index]}`);
await evaluate(`document.querySelectorAll('.sb-row-item')[${index}].querySelector('button').click()`);
await sleep(6000);

/** 等正在跑的那一轮结束，避免两个流式重叠。 */
const waitIdle = async (rounds = 90) => {
	for (let i = 0; i < rounds; i += 1) {
		if ((await evaluate("document.querySelectorAll('.row.is-streaming').length")) === 0) return true;
		await sleep(2000);
	}
	return false;
};
await waitIdle();

/* ---- 补足历史：竖轨顶端的「…」逐页补，直到够行数或没有更早的了 ---- */
for (let i = 0; i < 24; i += 1) {
	const state = await evaluate(`({
		rows: document.querySelectorAll('.scroll .row').length,
		more: document.querySelector('.outline-more')?.disabled === false,
	})`);
	if (state.rows >= TARGET_ROWS || !state.more) {
		console.log(`历史行数 ${state.rows}（还可补：${state.more}）`);
		break;
	}
	await evaluate("document.querySelector('.outline-more')?.click()");
	await sleep(1600);
}
const size = await evaluate(`({
	rows: document.querySelectorAll('.scroll .row').length,
	elements: document.querySelectorAll('.scroll *').length,
	height: Math.round(document.querySelector('.scroll').scrollHeight),
})`);
console.log(`体量：${size.rows} 行 / ${size.elements} 元素 / ${size.height}px`);

/* ---- 发一条会产生长输出的消息 ---- */
const box = await evaluate(`(() => {
	const editor = document.querySelector('.composer-editor');
	const rect = editor.getBoundingClientRect();
	editor.focus();
	return { x: Math.round(rect.x + rect.width / 2), y: Math.round(rect.y + rect.height / 2) };
})()`);
for (const type of ["mousePressed", "mouseReleased"]) {
	await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
}
await sleep(200);
await send("Input.insertText", { text: PROMPT });
await sleep(300);
for (const type of ["rawKeyDown", "char", "keyUp"]) {
	await send("Input.dispatchKeyEvent", {
		type,
		key: "Enter",
		code: "Enter",
		windowsVirtualKeyCode: 13,
		nativeVirtualKeyCode: 13,
		...(type === "char" ? { text: "\r", unmodifiedText: "\r" } : {}),
	});
}
for (let i = 0; i < 120; i += 1) {
	if ((await evaluate("document.querySelectorAll('.row.is-streaming').length")) > 0) break;
	await sleep(1000);
}
const point = await evaluate(`(() => {
	const scroll = document.querySelector('.scroll').getBoundingClientRect();
	return { x: Math.round(scroll.x + scroll.width / 2), y: Math.round(scroll.y + scroll.height / 2) };
})()`);

/* ---- 一个阶段：可以先滚，再统计这一段的每帧成本 ---- */
async function phase(label, deltaY, seconds) {
	const streamingBefore = await evaluate("document.querySelectorAll('.row.is-streaming').length");
	const before = await metrics();
	await evaluate(`(() => {
		window.__gaps = []; window.__long = []; window.__on = true; let last = performance.now();
		try {
			const observer = new PerformanceObserver((list) => {
				for (const entry of list.getEntries()) window.__long.push(Math.round(entry.duration));
			});
			observer.observe({ entryTypes: ['longtask'] });
		} catch {}
		const step = (now) => {
			window.__gaps.push(now - last); last = now;
			if (window.__on) requestAnimationFrame(step);
		};
		requestAnimationFrame(step);
		return 1;
	})()`);
	const started = Date.now();
	let events = 0;
	while ((Date.now() - started) / 1000 < seconds) {
		if (deltaY !== 0) {
			await send("Input.dispatchMouseEvent", {
				type: "mouseWheel",
				x: point.x,
				y: point.y,
				deltaX: 0,
				deltaY,
			});
		}
		await sleep(15);
		events += 1;
	}
	const elapsed = (Date.now() - started) / 1000;
	const sample = await evaluate(`(async () => {
		window.__on = false;
		await new Promise((resolve) => setTimeout(resolve, 150));
		const sorted = window.__gaps.slice(1).sort((a, b) => a - b);
		const at = (q) => +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(2);
		return {
			frames: sorted.length,
			p50: at(0.5),
			p95: at(0.95),
			max: +sorted[sorted.length - 1].toFixed(2),
			over10: sorted.filter((value) => value > 10.6).length,
			over16: sorted.filter((value) => value > 16.7).length,
			longtasks: window.__long,
			streamingAfter: document.querySelectorAll('.row.is-streaming').length,
		};
	})()`);
	const after = await metrics();
	const perSecond = (key) => ((after[key] ?? 0) - (before[key] ?? 0)) / elapsed;

	console.log(
		`\n${label}（${elapsed.toFixed(1)}s，滚轮 ${events} 次，流式 ${streamingBefore}→${sample.streamingAfter}）`,
	);
	console.log(
		`  每帧 p50 ${sample.p50}ms  p95 ${sample.p95}ms  max ${sample.max}ms   帧 ${sample.frames}   长任务 ${sample.longtasks.length === 0 ? "0" : sample.longtasks.join("/")}`,
	);
	if (unlimited) {
		console.log(
			`  每秒：Task ${(perSecond("TaskDuration") * 1000).toFixed(0)}ms  Script ${(perSecond("ScriptDuration") * 1000).toFixed(0)}ms  ` +
				`Layout ${(perSecond("LayoutDuration") * 1000).toFixed(0)}ms  Recalc ${(perSecond("RecalcStyleDuration") * 1000).toFixed(0)}ms`,
		);
		const script = perSecond("ScriptDuration") * 1000;
		const task = perSecond("TaskDuration") * 1000;
		console.log(
			`  JS 占主线程忙时的 ${((script / Math.max(task, 1)) * 100).toFixed(0)}%（其余是层化/绘制/提交）`,
		);
		for (const hz of REFRESH_RATES) {
			const budget = 1000 / hz;
			const p95Use = (sample.p95 / budget) * 100;
			const verdict = p95Use <= 80 ? "满帧有余量" : p95Use <= 100 ? "擦线" : "会掉帧";
			console.log(
				`    ${hz}Hz 预算 ${budget.toFixed(2)}ms：p50 用 ${((sample.p50 / budget) * 100).toFixed(0)}%、p95 用 ${p95Use.toFixed(0)}% → ${verdict}`,
			);
		}
	} else {
		const fps = sample.frames / elapsed;
		console.log(
			`  实测 ${fps.toFixed(1)} FPS   超 10.6ms ${sample.over10}/${sample.frames}  超 16.7ms ${sample.over16}/${sample.frames}   ` +
				`Task ${(perSecond("TaskDuration") * 1000).toFixed(0)}ms/s  Script ${(perSecond("ScriptDuration") * 1000).toFixed(0)}ms/s`,
		);
	}
}

await phase("① 流式 + 不滚（基线）", 0, 2);
await phase("② 流式 + 往上滚", 120, 3);
await phase("③ 流式 + 往下滚", -120, 3);
await waitIdle();
await phase("④ 不流式 + 往上滚（对照）", 120, 3);

ws.close();
