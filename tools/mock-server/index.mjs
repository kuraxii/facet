/**
 * 假主机。
 *
 * 按 facet 的线格式与界面通信，给界面喂可参数化的数据：会话数、单会话历史长度、流式速率、
 * 工具输出长度。界面用 FACET_ENDPOINT 连过来，走的还是同一条 transport → store → 渲染
 * 路径，只是数据来源换成这里，因此可以重复地压渲染层，不需要真实模型与会话文件。
 *
 * 只实现界面真正会用到的那部分协议：握手、清单与会话的读取、三条通道的订阅与动作推送、
 * 发送消息之后的假流式。其余请求一律回 unknown_method，日志里能看到还缺什么。
 */

import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";

const PRESETS = {
	/** 日常用几个月：会话数不多，单个会话写得很长 */
	small: { sessions: 200, turns: 50, streamRate: 120, streamSeconds: 12, toolOutput: 60 },
	/** 会话很多、每个都不长：压侧栏与清单 */
	many: { sessions: 1000, turns: 20, streamRate: 120, streamSeconds: 12, toolOutput: 60 },
	/** 会话不多但每个都很长：压历史装载与滚动 */
	long: { sessions: 20, turns: 800, streamRate: 120, streamSeconds: 12, toolOutput: 120 },
};

/** 解析命令行参数，未给出的项取预设值。 */
function readOptions(argv) {
	const options = { port: 4319, preset: "small" };
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		const value = argv[index + 1];
		if (!key?.startsWith("--")) {
			continue;
		}
		const name = key.slice(2);
		if (name === "preset") {
			options.preset = value;
			index += 1;
			continue;
		}
		options[name] = Number(value);
		index += 1;
	}
	const preset = PRESETS[options.preset] ?? PRESETS.small;
	return {
		port: options.port,
		sessions: options.sessions ?? preset.sessions,
		turns: options.turns ?? preset.turns,
		streamRate: options.streamRate ?? preset.streamRate,
		streamSeconds: options.streamSeconds ?? preset.streamSeconds,
		toolOutput: options.toolOutput ?? preset.toolOutput,
	};
}

const options = readOptions(process.argv.slice(2));
options.controlPort = Number(process.env.MOCK_CONTROL_PORT ?? 4320);

/** 流式参数，控制口可以随时改，界面不必重连。 */
const stream = { rate: options.streamRate, seconds: options.streamSeconds };

const HOST_ID = "mockhost00000001";
const CWD = "/mock/project";
const SESSION_DIR = "/mock/sessions";

/** 会话池。摘要与条目都留在内存里，分页按游标从后往前取。 */
const sessions = [];

/** 推状态到清单通道的实现，连接建立后由 createConnection 装上。 */
let broadcastStatus = () => {};

/** 造一段带 Markdown 结构的正文，长度接近真实回复。 */
function bodyText(index, size) {
	const paragraphs = [
		"## 结论",
		`第 ${index} 轮：这条回复用来压渲染，正文里混入标题、列表、代码块与表格。`,
		"",
		"1. 第一点说明，含 `inline code` 与一段较长的中文描述。",
		"2. 第二点说明，存在换行的折行文本，用来撑高行高。",
		"",
		"```ts",
		"function sample(value: number): number {",
		"\treturn value * 2;",
		"}",
		"```",
		"",
	];
	let text = paragraphs.join("\n");
	while (text.length < size) {
		text += `补充段落 ${text.length}：这段文字只服务一个目的，让一条消息的高度接近真实长回复。\n\n`;
	}
	return text;
}

/** 造一段工具输出，行数由参数决定。 */
function toolOutputText(index, lines) {
	const rows = [];
	for (let line = 0; line < lines; line += 1) {
		rows.push(`${String(line).padStart(4, "0")}  build  artifact-${index}-${line}.js  ${line * 13} bytes`);
	}
	return rows.join("\n");
}

/** 一条用户消息。 */
function userMessage(index, timestamp) {
	return {
		role: "user",
		content: [{ type: "text", text: `第 ${index} 轮的问题，用来压历史装载与分页。` }],
		timestamp,
	};
}

/** 一条助手消息，内容按需包含 thinking、正文与工具调用。 */
function assistantMessage(index, timestamp, parts) {
	const content = [];
	if (parts.thinking) {
		content.push({ type: "thinking", thinking: `第 ${index} 轮的思考过程，用来压折叠与展开。`.repeat(6) });
	}
	if (parts.text) {
		content.push({ type: "text", text: parts.text });
	}
	if (parts.toolCall !== undefined) {
		content.push({
			type: "toolCall",
			id: parts.toolCall.id,
			name: parts.toolCall.name,
			arguments: { command: `node scripts/build.mjs --round ${index}` },
		});
	}
	return {
		role: "assistant",
		content,
		provider: "mock",
		model: "mock-large",
		usage: {
			input: 1200,
			output: 480,
			cacheRead: 0,
			cacheWrite: 0,
			reasoning: 0,
			totalTokens: 1680,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: parts.toolCall === undefined ? "stop" : "toolUse",
		durationMs: 1500,
		timestamp,
	};
}

/** 造一个会话的历史条目。每轮四个条目：提问、答复、调用、结果。 */
function buildEntries(sessionIndex, turns) {
	const entries = [];
	let parentId = null;
	const base = Date.now() - turns * 60_000;
	for (let turn = 0; turn < turns; turn += 1) {
		const timestamp = base + turn * 60_000;
		const push = (kind, message) => {
			const id = `e${sessionIndex}-${entries.length}`;
			entries.push({
				id,
				parentId,
				kind,
				timestamp: new Date(timestamp).toISOString(),
				...(message === undefined ? {} : { message }),
			});
			parentId = id;
		};
		push("message", userMessage(turn, timestamp));
		push(
			"message",
			assistantMessage(turn, timestamp + 1000, {
				thinking: true,
				text: bodyText(turn, 900),
				toolCall: { id: `c${sessionIndex}-${turn}`, name: "bash" },
			}),
		);
		push("message", {
			role: "toolResult",
			callId: `c${sessionIndex}-${turn}`,
			toolName: "bash",
			content: [{ type: "text", text: toolOutputText(turn, options.toolOutput) }],
			isError: false,
			durationMs: 900,
			timestamp: timestamp + 2000,
		});
		push("message", assistantMessage(turn, timestamp + 3000, { text: bodyText(turn, 900) }));
	}
	return entries;
}

/** 建会话池。 */
for (let index = 0; index < options.sessions; index += 1) {
	const id = `mock-session-${index}`;
	sessions.push({
		id,
		file: `${SESSION_DIR}/s-${index}.jsonl`,
		cwd: CWD,
		name: index % 7 === 0 ? undefined : `压测会话 ${index}`,
		created: Date.now() - index * 86_400_000,
		modified: Date.now() - index * 60_000,
		firstMessage: `第 ${index} 个会话的首条消息，用来生成侧栏标题。`,
		entries: buildEntries(index, options.turns),
		// 侧栏状态：收尾信息与已读水位，控制口可以改这两项来试三种未读提示
		settle: undefined,
		seenAt: 0,
		pendingInput: 0,
	});
}

const settings = {
	version: 1,
	appearance: {
		theme: "zinc",
		codeTheme: "github",
		codeFont: "",
		editorFont: "",
		editorFontSize: 13,
		terminalFont: "",
		terminalFontSize: 12.5,
		reducedMotion: false,
		liveMotion: "pulse",
		outlineScale: 100,
	},
	input: { sendKey: "enter" },
	layout: { sidebarWidth: 272 },
};

const model = {
	id: "mock-large",
	name: "Mock Large",
	provider: "mock",
	api: "openai-completions",
	reasoning: true,
	contextWindow: 200000,
	maxTokens: 8192,
	input: ["text", "image"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
	baseUrl: "mock://local",
};

/** 一个会话的运行时状态。 */
function sessionSnapshot(session) {
	const last = session.entries.at(-1);
	const lastTime = last === undefined ? session.modified : Date.parse(last.timestamp);
	return {
		id: session.id,
		file: session.file,
		cwd: session.cwd,
		name: session.name,
		phase: session.phase ?? "idle",
		maintenance: undefined,
		model,
		thinkingLevel: "medium",
		availableThinkingLevels: ["off", "low", "medium", "high"],
		activeToolNames: ["bash", "read"],
		queued: { steering: [], followUp: [] },
		contextUsage: { tokens: 21000, contextWindow: 200000, percent: 10.5 },
		stats: {
			sessionId: session.id,
			sessionFile: session.file,
			userMessages: session.entries.length / 4,
			assistantMessages: session.entries.length / 2,
			toolCalls: session.entries.length / 4,
			toolResults: session.entries.length / 4,
			totalMessages: session.entries.length,
			tokens: { input: 1200, output: 480, cacheRead: 0, cacheWrite: 0, total: 1680 },
			cost: 0,
			contextUsage: { tokens: 21000, contextWindow: 200000, percent: 10.5 },
		},
		initialization: { kind: "ready" },
		extensionUi: { prompts: [] },
		modelFallbackMessage: undefined,
		lastTime,
	};
}

/** 一条连接。序号按通道各自递增，界面据此判重与察觉缺口。 */
function createConnection(socket) {
	const seqs = new Map();
	const subscriptions = new Set();
	let streaming;
	const send = (frame) => {
		if (!socket.destroyed) {
			socket.write(`${JSON.stringify(frame)}\n`);
		}
	};
	const nextSeq = (channel) => {
		const next = (seqs.get(channel) ?? 0) + 1;
		seqs.set(channel, next);
		return next;
	};
	const push = (channel, action) => {
		if (!subscriptions.has(channel)) {
			// 没有订阅就不推：真实主机也只发给订阅者，界面这边不应该收到没订的通道
			return;
		}
		send({ type: "action", channel, action, serverSeq: nextSeq(channel), origin: undefined });
	};
	const ok = (id, data) => send({ type: "response", id, ok: true, data });
	const fail = (id, code, message) => send({ type: "response", id, ok: false, error: { code, message } });

	/** 会话此刻的状态，字段与协议里的 SessionStatus 一致。 */
	const statusOf = (session) => ({
		activity: session.phase === "running" ? "running" : "idle",
		settle: session.settle,
		pendingInput: session.pendingInput,
		seenAt: session.seenAt,
	});

	/** 推一条状态到清单通道，界面据此更新侧栏那一行。 */
	const noteStatus = (session) => {
		push(`sessions:/${HOST_ID}`, { type: "sessions/status", path: session.file, status: statusOf(session) });
	};
	broadcastStatus = (session) => noteStatus(session);

	/** 假流式：按速率把一段正文切成 delta 推出去，中间插一次工具调用。 */
	const startStreaming = (session, chatChannel, sessionChannel) => {
		if (streaming !== undefined) {
			clearInterval(streaming);
		}
		session.phase = "running";
		const messageId = `m${Date.now()}`;
		// 每 16 毫秒一批，速率由参数决定；总长度按「速率 × 时长」推出来，各速率跑同样长
		const perTick = Math.max(1, Math.round((stream.rate * 16) / 1000));
		const charsPerTick = perTick * 6;
		const total = Math.round(charsPerTick * ((stream.seconds * 1000) / 16));
		let sent = 0;
		let started = false;
		push(sessionChannel, {
			type: "session/phase",
			phase: "running",
			maintenance: undefined,
		});
		push(chatChannel, {
			type: "chat/messageAppended",
			messageId,
			message: assistantMessage(0, Date.now(), { text: "" }),
		});
		streaming = setInterval(() => {
			for (let index = 0; index < perTick && sent < total; index += 1) {
				const piece = `${sent % 40 === 0 ? "\n" : ""}词${sent} `;
				push(chatChannel, {
					type: "chat/delta",
					messageId,
					partIndex: 0,
					kind: "text",
					delta: piece,
				});
				sent += piece.length;
			}
			if (!started && sent > total / 3) {
				started = true;
				push(chatChannel, {
					type: "chat/toolCallStarted",
					callId: "mock-call",
					toolName: "bash",
					input: { command: "node scripts/build.mjs" },
				});
				push(chatChannel, {
					type: "chat/toolCallEnded",
					callId: "mock-call",
					toolName: "bash",
					output: {
						content: [{ type: "text", text: toolOutputText(0, options.toolOutput) }],
						details: undefined,
					},
					isError: false,
					durationMs: 900,
				});
			}
			if (sent >= total) {
				clearInterval(streaming);
				streaming = undefined;
				session.phase = "idle";
				push(chatChannel, {
					type: "chat/messageUpdated",
					messageId,
					message: assistantMessage(0, Date.now(), { text: "" }),
				});
				// 收尾写进状态：界面拿它和已读水位比，未读时就显示「待查看」或「失败」
				session.settle =
					session.nextOutcome === undefined
						? { at: Date.now(), outcome: "completed", message: undefined }
						: {
								at: Date.now(),
								outcome: session.nextOutcome,
								message: session.nextOutcome === "failed" ? "假主机造出来的失败" : undefined,
							};
				session.nextOutcome = undefined;
				push(chatChannel, { type: "chat/settled", aborted: false });
				push(sessionChannel, { type: "session/phase", phase: "idle", maintenance: undefined });
				noteStatus(session);
			}
		}, 16);
	};

	const handleRequest = (frame) => {
		const { id, method, params } = frame;
		if (process.env.MOCK_TRACE === "1") {
			console.log(`[mock] 请求 ${method} ${params === undefined ? "" : JSON.stringify(params).slice(0, 90)}`);
		}
		switch (method) {
			case "markSessionsSeen": {
				const files = params?.sessionFiles ?? [];
				for (const file of files) {
					const session = sessions.find((item) => item.file === file);
					if (session === undefined) {
						continue;
					}
					session.seenAt = Date.now();
					noteStatus(session);
				}
				ok(id, {});
				return;
			}
			case "listProjects":
				ok(id, { projects: [{ id: "mock-project", cwd: CWD, name: "mock" }] });
				return;
			case "listSessions":
				ok(id, {
					sessions: sessions.map((session) => ({
						summary: {
							id: session.id,
							path: session.file,
							cwd: session.cwd,
							name: session.name,
							parentSessionPath: undefined,
							created: session.created,
							modified: session.modified,
							firstMessage: session.firstMessage,
						},
						status: statusOf(session),
					})),
				});
				return;
			case "openSession": {
				const file = params?.sessionFile;
				const session = sessions.find((item) => item.file === file);
				if (session === undefined) {
					fail(id, "unknown_session", `no such session: ${file}`);
					return;
				}
				const snapshot = sessionSnapshot(session);
				if (process.env.MOCK_TRACE === "1") {
					console.log(`[mock] openSession 返回 phase=${snapshot.phase}`);
				}
				ok(id, snapshot);
				return;
			}
			case "subscribe": {
				const channel = params?.channel;
				subscriptions.add(channel);
				const result = { seq: seqs.get(channel) ?? 0, resync: false };
				const parsed = /^session:\/(.+)$/.exec(channel ?? "");
				if (parsed !== null) {
					const session = sessions.find((item) => item.id === parsed[1]);
					if (session !== undefined) {
						const snapshot = sessionSnapshot(session);
						delete snapshot.lastTime;
						result.session = snapshot;
					}
				}
				ok(id, result);
				return;
			}
			case "unsubscribe":
				subscriptions.delete(params?.channel);
				ok(id, {});
				return;
			case "entries": {
				const session = sessions.find((item) => item.id === params?.sessionId);
				if (session === undefined) {
					fail(id, "unknown_session", "no such session");
					return;
				}
				const limit = Math.min(Math.max(params?.limit ?? 50, 1), 500);
				const all = session.entries;
				// 游标是上一条已读条目的 id；没给就是从末尾往前取一页
				const end =
					params?.cursor === undefined ? all.length : all.findIndex((entry) => entry.id === params.cursor);
				const stop = end < 0 ? all.length : end;
				const start = Math.max(0, stop - limit);
				const page = all.slice(start, stop);
				ok(id, { entries: page, nextCursor: start > 0 ? page[0]?.id : undefined });
				return;
			}
			case "entriesAfter":
				// 一轮结束后界面用它把实时消息提升为历史；压测里不给新条目，界面沿用自己的视图
				ok(id, { entries: [], leafId: null });
				return;
			case "listCommands":
				ok(id, { commands: [] });
				return;
			case "getSettings":
				ok(id, { settings });
				return;
			case "availableModels":
			case "models":
				ok(id, { models: [model] });
				return;
			case "providers":
				ok(id, { providers: [{ id: "mock", name: "Mock", hasCredential: true }] });
				return;
			case "busySessions":
				ok(id, { files: [] });
				return;
			case "projectTrust":
				ok(id, { hasProjectResources: false, trusted: true });
				return;
			case "listCustomProviders":
				ok(id, { providers: [] });
				return;
			case "listTerminals":
				ok(id, { terminals: [] });
				return;
			case "gitStatus":
				// 干净仓库：右侧变更面板走最简单的分支，压测只关心主区
				ok(id, { isRepo: true, branch: "mock", files: [] });
				return;
			case "gitCommits":
				ok(id, { isRepo: true, commits: [] });
				return;
			case "gitDiff":
				ok(id, { patch: "", truncated: false, binary: false });
				return;
			case "listDirectory":
				// 右侧的文件树会逐个目录展开，给空目录即可，压测用不到文件内容
				ok(id, { entries: [] });
				return;
			default:
				console.log(`[mock] 未实现的请求: ${method}`);
				fail(id, "unknown_method", `mock does not implement ${method}`);
		}
	};

	const handleDispatch = (frame) => {
		const { channel, action, clientSeq } = frame;
		console.log(`[mock] 派发 ${channel} ${action?.type} seq=${clientSeq}`);
		// 运行态下界面把消息走 session 通道排队，压测里同样当成一次发送
		if (action?.type === "session/pendingMessageSet") {
			const parsed = /^session:\/(.+)$/.exec(channel ?? "");
			const target = parsed === null ? undefined : sessions.find((item) => item.id === parsed[1]);
			if (target !== undefined) {
				startStreaming(target, `chat:/${target.id}`, channel);
			}
			return;
		}
		const parsed = /^chat:\/(.+)$/.exec(channel ?? "");
		const session = parsed === null ? undefined : sessions.find((item) => item.id === parsed[1]);
		if (session === undefined) {
			return;
		}
		if (action?.type === "chat/turnStarted") {
			// 先回执受理，再开始假流式；与真实主机一样，动作的进展靠后续推送反映
			push(channel, { type: "chat/inputHandled" });
			startStreaming(session, channel, `session:/${session.id}`);
			console.log(`[mock] 开始流式: ${session.id} 速率 ${stream.rate}/s 时长 ${stream.seconds}s`);
			return;
		}
		if (action?.type === "chat/turnCancelled") {
			if (streaming !== undefined) {
				clearInterval(streaming);
				streaming = undefined;
			}
			session.phase = "idle";
			push(channel, { type: "chat/settled", aborted: true });
			push(`session:/${session.id}`, { type: "session/phase", phase: "idle", maintenance: undefined });
			console.log(`[mock] 已中止: ${session.id} clientSeq=${clientSeq}`);
		}
	};

	let buffer = "";
	socket.setEncoding("utf8");
	socket.on("data", (chunk) => {
		buffer += chunk;
		let index = buffer.indexOf("\n");
		while (index >= 0) {
			const line = buffer.slice(0, index);
			buffer = buffer.slice(index + 1);
			index = buffer.indexOf("\n");
			if (line.trim().length === 0) {
				continue;
			}
			let frame;
			try {
				frame = JSON.parse(line);
			} catch {
				continue;
			}
			if (frame.type === "auth") {
				send({
					type: "hello",
					protocolVersion: 2,
					hostId: HOST_ID,
					hostName: "mock host",
					clientId: `mock-client-${Math.random().toString(36).slice(2, 8)}`,
					role: "admin",
					canManage: true,
					agentDir: `${CWD}/agent`,
					capabilities: ["dispatch", "tools", "compaction", "extensionUi"],
				});
				console.log("[mock] 握手完成");
				continue;
			}
			if (frame.type === "request") {
				handleRequest(frame);
				continue;
			}
			if (frame.type === "dispatch") {
				handleDispatch(frame);
			}
		}
	});
	socket.on("close", () => {
		if (streaming !== undefined) {
			clearInterval(streaming);
			streaming = undefined;
		}
	});
}

const server = createServer((socket) => {
	console.log("[mock] 有连接接入");
	createConnection(socket);
});

/** 控制口：改流式速率与时长，压测脚本据此在同一连接上跑不同速率。 */
const control = createHttpServer((request, response) => {
	if (request.method !== "POST") {
		response.writeHead(405).end();
		return;
	}
	let body = "";
	request.setEncoding("utf8");
	request.on("data", (chunk) => {
		body += chunk;
	});
	request.on("end", () => {
		try {
			const next = JSON.parse(body);
			if (typeof next.rate === "number") stream.rate = next.rate;
			if (typeof next.seconds === "number") stream.seconds = next.seconds;
			// 造状态用：下一次流式按指定结果收尾，或直接给某个会话挂上待答交互
			if (typeof next.sessionIndex === "number" && sessions[next.sessionIndex] !== undefined) {
				const target = sessions[next.sessionIndex];
				if (next.outcome === "completed" || next.outcome === "failed") {
					target.nextOutcome = next.outcome;
				}
				if (typeof next.pendingInput === "number") {
					target.pendingInput = next.pendingInput;
					broadcastStatus(target);
				}
				if (next.unread === true) {
					const outcome = next.outcome === "failed" ? "failed" : "completed";
					target.settle = {
						at: Date.now(),
						outcome,
						message: outcome === "failed" ? "假主机造出来的失败" : undefined,
					};
					target.seenAt = 0;
					broadcastStatus(target);
				}
			}
		} catch {
			response.writeHead(400).end("bad json");
			return;
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify(stream));
		console.log(`[mock] 参数已更新: 速率 ${stream.rate}/s 时长 ${stream.seconds}s`);
	});
});
control.listen(options.controlPort, "127.0.0.1");

server.listen(options.port, "127.0.0.1", () => {
	console.log(
		`[mock] 监听 127.0.0.1:${options.port}  会话 ${options.sessions} 个  每个 ${options.turns} 轮  ` +
			`流式 ${stream.rate}/s 持续 ${stream.seconds}s  工具输出 ${options.toolOutput} 行`,
	);
	console.log(`[mock] 用 FACET_ENDPOINT=127.0.0.1:${options.port} npm run dev 连过来`);
});
