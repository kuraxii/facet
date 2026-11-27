/**
 * 假主机。
 *
 * 按 facet 的线格式与界面通信，给界面喂可参数化的数据：会话数、单会话历史长度、流式速率、
 * 工具输出长度。界面用 FACET_ENDPOINT 连过来，走的还是同一条 transport → store → 渲染
 * 路径，只是数据来源换成这里，因此可以重复地压渲染层，不需要真实模型与会话文件。
 *
 * 只实现界面真正会用到的那部分协议：握手、清单与会话的读取、三条通道的订阅与动作推送、
 * 发送消息之后的假流式。其余请求一律回 unknown_method，日志里能看到还缺什么。
 *
 * 协议本身不在这里手抄：帧的编码、版本号与入站的校验表都直接用 `@facet/protocol`，
 * 手写的只剩「造坏帧」那一小段。`--check` 打开不变量检查，客户端发错参数、发主机内部
 * 动作、clientSeq 不递增都会记一条违规并以非零码退出。
 */

import { createServer as createHttpServer } from "node:http";
import { createServer, type Socket } from "node:net";
import type {
	ActionEcho,
	ActionOrigin,
	Channel,
	ErrorCode,
	OutboundFrame,
	TurnOutcome,
} from "@facet/protocol";
import {
	DISPATCH_CONTRACTS,
	encodeFrame,
	FrameDecoder,
	PROTOCOL_VERSION,
	REQUEST_CONTRACTS,
} from "@facet/protocol";

/** 一组压测规模：会话数、每个会话的轮数、流式速率与时长、工具输出行数。 */
interface Preset {
	/** 会话个数 */
	sessions: number;
	/** 每个会话的历史轮数 */
	turns: number;
	/** 流式速率，每秒字符数 */
	streamRate: number;
	/** 流式持续秒数 */
	streamSeconds: number;
	/** 每条工具结果的行数 */
	toolOutput: number;
}

const PRESETS: Readonly<Record<string, Preset>> = {
	/** 日常用几个月：会话数不多，单个会话写得很长 */
	small: { sessions: 200, turns: 50, streamRate: 120, streamSeconds: 12, toolOutput: 60 },
	/** 会话很多、每个都不长：压侧栏与清单 */
	many: { sessions: 1000, turns: 20, streamRate: 120, streamSeconds: 12, toolOutput: 60 },
	/** 会话不多但每个都很长：压历史装载与滚动 */
	long: { sessions: 20, turns: 800, streamRate: 120, streamSeconds: 12, toolOutput: 120 },
};

/** 命令行与预设合并之后的运行参数。 */
interface Options {
	/** 协议口端口，传 0 由系统分配 */
	port: number;
	/** 控制口端口，传 0 由系统分配 */
	controlPort: number;
	/** 打开客户端违规检查 */
	check: boolean;
	sessions: number;
	turns: number;
	streamRate: number;
	streamSeconds: number;
	toolOutput: number;
}

const DEFAULT_PORT = 4319;
const DEFAULT_CONTROL_PORT = 4320;

/** 解析命令行参数，未给出的项取预设值。 */
function readOptions(argv: readonly string[]): Options {
	let check = false;
	let presetName = "small";
	const numbers = new Map<string, number>();
	for (let index = 0; index < argv.length; index += 1) {
		const key = argv[index];
		if (key === undefined || !key.startsWith("--")) {
			continue;
		}
		const name = key.slice(2);
		if (name === "check") {
			// 不带值的开关
			check = true;
			continue;
		}
		const value = argv[index + 1];
		index += 1;
		if (name === "preset") {
			presetName = value ?? presetName;
			continue;
		}
		// 短横线写法与驼峰写法都认：`--stream-seconds` 落到 `streamSeconds`
		numbers.set(
			name.replace(/-([a-z])/g, (_, char: string) => char.toUpperCase()),
			Number(value),
		);
	}
	const preset = PRESETS[presetName] ?? {
		sessions: 200,
		turns: 50,
		streamRate: 120,
		streamSeconds: 12,
		toolOutput: 60,
	};
	return {
		port: numbers.get("port") ?? DEFAULT_PORT,
		controlPort: numbers.get("control") ?? Number(process.env.MOCK_CONTROL_PORT ?? DEFAULT_CONTROL_PORT),
		check,
		sessions: numbers.get("sessions") ?? preset.sessions,
		turns: numbers.get("turns") ?? preset.turns,
		streamRate: numbers.get("streamRate") ?? preset.streamRate,
		streamSeconds: numbers.get("streamSeconds") ?? preset.streamSeconds,
		toolOutput: numbers.get("toolOutput") ?? preset.toolOutput,
	};
}

const options = readOptions(process.argv.slice(2));

/** 流式参数，控制口可以随时改，界面不必重连。 */
const stream = { rate: options.streamRate, seconds: options.streamSeconds };

/** 故障注入的几种时序。 */
type FaultKind = "gap" | "out-of-order" | "resync" | "reject" | "late-receipt" | "dup-receipt";

/** 延后多少毫秒再发回执；`late-receipt` 专用。 */
interface LateReceiptFault {
	kind: "late-receipt";
	ms: number;
}

/** 拒绝这条派发时给出的原因；`reject` 专用。 */
interface RejectFault {
	kind: "reject";
	reason: string;
}

/** 命中即触发、不带参数的一类故障。 */
interface SimpleFault {
	kind: "gap" | "out-of-order" | "resync" | "dup-receipt";
}

type Fault = LateReceiptFault | RejectFault | SimpleFault;

/** 故障注入，控制口写入，命中一次即清掉。 */
let fault: Fault | undefined;

/** 实际监听的端口，传 0 时由系统分配，两个口都起来之后打一行 ready。 */
let endpointPort = 0;
let controlPort = 0;
let announced = false;

/** 两个口都开始监听后打一行机器可读的 ready，集成测试按它拿实际端口。 */
function maybeAnnounce(): void {
	if (announced || endpointPort === 0 || controlPort === 0) {
		return;
	}
	announced = true;
	console.log(`[mock] ready endpoint=127.0.0.1:${endpointPort} control=127.0.0.1:${controlPort}`);
	console.log(`[mock] 故障注入: curl -X POST localhost:${controlPort} -d '{"fault":{"kind":"dup-receipt"}}'`);
}

/** --check 下记下的客户端违规，退出时汇总。 */
const violations: string[] = [];

/** 记一条违规：--check 下打日志并让进程以非零码退出。 */
function violation(message: string): void {
	if (!options.check) {
		return;
	}
	violations.push(message);
	console.log(`[mock][违规] ${message}`);
	process.exitCode = 1;
}

/**
 * 取走当前故障。
 *
 * `kind` 对得上才消费，免得一个故障被别的路径吃掉；返回值的类型按 `kind` 收窄，
 * 调用处因此不必再判断 `ms`、`reason` 在不在。
 */
function takeFault(kind: "late-receipt"): LateReceiptFault | undefined;
function takeFault(kind: "reject"): RejectFault | undefined;
function takeFault(kind: "gap" | "out-of-order" | "resync" | "dup-receipt"): SimpleFault | undefined;
function takeFault(kind: FaultKind): Fault | undefined;
function takeFault(kind: FaultKind): Fault | undefined {
	if (fault === undefined || fault.kind !== kind) {
		return undefined;
	}
	const taken = fault;
	fault = undefined;
	return taken;
}

/** 是不是一个普通对象：入站 JSON 与请求参数都先过这一层。 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 字符串取值，非字符串给 undefined。 */
function asString(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

/** 有限数字取值，其余给 undefined。 */
function asNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/** 取动作的 type，用于日志与校验表索引。 */
function actionType(action: unknown): string | undefined {
	return isRecord(action) ? asString(action.type) : undefined;
}

const HOST_ID = "mockhost00000001";
const CWD = "/mock/project";
const SESSION_DIR = "/mock/sessions";

/** 一条历史条目，字段与协议里的 `Entry` 对齐。 */
interface Entry {
	/** 条目标识，同一会话内唯一 */
	id: string;
	/** 上一条条目的标识，首条为空 */
	parentId: string | null;
	/** 条目种类 */
	kind: string;
	/** 写入时刻，ISO 字符串 */
	timestamp: string;
	/** 带消息的条目才有 */
	message?: unknown;
}

/** 最近一轮的收尾事实，字段与协议里的 `SessionSettle` 对齐。 */
interface Settle {
	/** 收尾时刻，Unix 毫秒 */
	at: number;
	/** 这一轮的结果 */
	outcome: TurnOutcome;
	/** 结果为 failed 时的原因 */
	message: string | undefined;
}

/** 会话池里的一项。摘要与条目都留在内存里，分页按游标从后往前取。 */
interface Session {
	/** 会话标识 */
	id: string;
	/** 会话文件路径 */
	file: string;
	/** 工作目录 */
	cwd: string;
	/** 会话名，未命名为空 */
	name: string | undefined;
	/** 创建时刻，Unix 毫秒 */
	created: number;
	/** 最后写入时刻，Unix 毫秒 */
	modified: number;
	/** 首条用户消息，侧栏标题用 */
	firstMessage: string;
	/** 全部历史条目 */
	entries: Entry[];
	/** 当前活动状态 */
	phase: "idle" | "running";
	/** 最近一轮的收尾 */
	settle: Settle | undefined;
	/** 已读水位，Unix 毫秒；零表示从未标记 */
	seenAt: number;
	/** 待答交互数 */
	pendingInput: number;
	/** 下一次流式按这个结果收尾 */
	nextOutcome: TurnOutcome | undefined;
}

/** 会话池。 */
const sessions: Session[] = [];

/** 推状态到清单通道的实现，连接建立后由 createConnection 装上。 */
let broadcastStatus: (session: Session) => void = () => undefined;

/** 造一段带 Markdown 结构的正文，长度接近真实回复。 */
function bodyText(index: number, size: number): string {
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
function toolOutputText(index: number, lines: number): string {
	const rows: string[] = [];
	for (let line = 0; line < lines; line += 1) {
		rows.push(`${String(line).padStart(4, "0")}  build  artifact-${index}-${line}.js  ${line * 13} bytes`);
	}
	return rows.join("\n");
}

/** 一条用户消息。 */
function userMessage(index: number, timestamp: number): Record<string, unknown> {
	return {
		role: "user",
		content: [{ type: "text", text: `第 ${index} 轮的问题，用来压历史装载与分页。` }],
		timestamp,
	};
}

/** 一条助手消息要带哪些部分。 */
interface AssistantParts {
	/** 是否带上思考过程 */
	thinking?: boolean;
	/** 正文 */
	text?: string;
	/** 是否带上一次工具调用 */
	toolCall?: { id: string; name: string };
}

/** 一条助手消息，内容按需包含 thinking、正文与工具调用。 */
function assistantMessage(index: number, timestamp: number, parts: AssistantParts): Record<string, unknown> {
	const content: Record<string, unknown>[] = [];
	if (parts.thinking === true) {
		content.push({ type: "thinking", thinking: `第 ${index} 轮的思考过程，用来压折叠与展开。`.repeat(6) });
	}
	if (parts.text !== undefined) {
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

/** 造一个会话的历史条目。每轮四个条目：提问、答复、工具结果、收尾答复。 */
function buildEntries(sessionIndex: number, turns: number): Entry[] {
	const entries: Entry[] = [];
	let parentId: string | null = null;
	const base = Date.now() - turns * 60_000;
	for (let turn = 0; turn < turns; turn += 1) {
		const timestamp = base + turn * 60_000;
		const push = (kind: string, message: unknown): void => {
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
		phase: "idle",
		// 侧栏状态：收尾信息与已读水位，控制口可以改这两项来试三种未读提示
		settle: undefined,
		seenAt: 0,
		pendingInput: 0,
		nextOutcome: undefined,
	});
}

const settings = {
	version: 1,
	appearance: {
		theme: "dark",
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

/** 会话快照；`subscribe` 时会把 `lastTime` 摘掉，因此它是可选的。 */
interface SessionSnapshot {
	id: string;
	file: string;
	cwd: string;
	name: string | undefined;
	phase: "idle" | "running";
	maintenance: undefined;
	model: typeof model;
	thinkingLevel: string;
	availableThinkingLevels: string[];
	activeToolNames: string[];
	queued: { steering: string[]; followUp: string[] };
	contextUsage: { tokens: number; contextWindow: number; percent: number };
	stats: {
		sessionId: string;
		sessionFile: string;
		userMessages: number;
		assistantMessages: number;
		toolCalls: number;
		toolResults: number;
		totalMessages: number;
		tokens: { input: number; output: number; cacheRead: number; cacheWrite: number; total: number };
		cost: number;
		contextUsage: { tokens: number; contextWindow: number; percent: number };
	};
	initialization: { kind: "ready" };
	extensionUi: { prompts: unknown[] };
	modelFallbackMessage: undefined;
	lastTime?: number;
}

/** 会话此刻的状态，字段与协议里的 SessionStatus 一致。 */
interface SessionStatus {
	activity: "running" | "idle";
	settle: Settle | undefined;
	pendingInput: number;
	seenAt: number;
}

/** 一个会话的运行时状态。 */
function sessionSnapshot(session: Session): SessionSnapshot {
	const last = session.entries.at(-1);
	const lastTime = last === undefined ? session.modified : Date.parse(last.timestamp);
	return {
		id: session.id,
		file: session.file,
		cwd: session.cwd,
		name: session.name,
		phase: session.phase,
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

/** 主机自己推的动作：载荷是假数据，形状由这一处宽松收，序列化时再按线格式出。 */
interface FakeActionFrame {
	type: "action";
	channel: string;
	action: unknown;
	serverSeq: number;
	origin: ActionOrigin | undefined;
}

/** 出站帧：协议的信封，加上主机自己推的假动作帧。 */
type Outbound = OutboundFrame | FakeActionFrame;

/** 回显客户端发来的动作：被拒的动作不保证符合约定，能带回去的只有 type 与原本的字段。 */
function echoOf(action: unknown, type: string): ActionEcho {
	if (isRecord(action)) {
		return { ...action, type };
	}
	return { type };
}

/** 一条连接。序号按通道各自递增，界面据此判重与察觉缺口。 */
function createConnection(socket: Socket): void {
	const seqs = new Map<string, number>();
	const subscriptions = new Set<string>();
	/** 这条连接自己的端标识，派发回执的 origin 要带上它 */
	const clientId = `mock-client-${Math.random().toString(36).slice(2, 8)}`;
	let streaming: ReturnType<typeof setInterval> | undefined;
	let authenticated = false;
	/** out-of-order 故障：按通道各压住一帧，同通道的下一帧到了再倒着发。 */
	const heldFrames = new Map<string, FakeActionFrame>();
	/** 上一条派发的 clientSeq，用来查单调递增 */
	let lastClientSeq = 0;

	const send = (frame: Outbound): void => {
		if (socket.destroyed) {
			return;
		}
		// 主机自己推的载荷是假数据，类型上没落到协议的动作里；线格式上它仍是一条动作帧
		socket.write(encodeFrame(frame as OutboundFrame));
	};

	const nextSeq = (channel: string): number => {
		const gap = takeFault("gap");
		if (gap !== undefined) {
			// 跳一个号：界面据此发现缺口并要求重新对齐
			console.log(`[mock][故障] 跳过 ${channel} 的一个序号`);
			seqs.set(channel, (seqs.get(channel) ?? 0) + 1);
		}
		const next = (seqs.get(channel) ?? 0) + 1;
		seqs.set(channel, next);
		return next;
	};

	const push = (channel: string, action: unknown, origin?: ActionOrigin): void => {
		if (!subscriptions.has(channel)) {
			// 没有订阅就不推：真实主机也只发给订阅者，界面这边不应该收到没订的通道
			return;
		}
		const frame: FakeActionFrame = {
			type: "action",
			channel,
			action,
			serverSeq: nextSeq(channel),
			origin,
		};
		if (takeFault("out-of-order") !== undefined) {
			heldFrames.set(channel, frame);
			return;
		}
		const held = heldFrames.get(channel);
		if (held !== undefined) {
			// 同通道里把压住的那帧放到后面发：界面先看到大的序号，再看到小的
			console.log(`[mock][故障] 乱序投递 ${channel}`);
			heldFrames.delete(channel);
			send(frame);
			send(held);
			return;
		}
		send(frame);
	};

	const ok = (id: string, data: unknown): void => send({ type: "response", id, ok: true, data });
	const fail = (id: string, code: ErrorCode, message: string): void =>
		send({ type: "response", id, ok: false, error: { code, message } });

	const statusOf = (session: Session): SessionStatus => ({
		activity: session.phase === "running" ? "running" : "idle",
		settle: session.settle,
		pendingInput: session.pendingInput,
		seenAt: session.seenAt,
	});

	/** 推一条状态到清单通道，界面据此更新侧栏那一行。 */
	const noteStatus = (session: Session): void => {
		push(`sessions:/${HOST_ID}`, { type: "sessions/status", path: session.file, status: statusOf(session) });
	};
	broadcastStatus = (session: Session): void => noteStatus(session);

	/** 假流式：按速率把一段正文切成 delta 推出去，中间插一次工具调用。 */
	const startStreaming = (session: Session, chatChannel: string, sessionChannel: string): void => {
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
				const outcome: TurnOutcome = session.nextOutcome ?? "completed";
				session.settle = {
					at: Date.now(),
					outcome,
					message: outcome === "failed" ? "假主机造出来的失败" : undefined,
				};
				session.nextOutcome = undefined;
				push(chatChannel, { type: "chat/settled", aborted: false });
				push(sessionChannel, { type: "session/phase", phase: "idle", maintenance: undefined });
				noteStatus(session);
			}
		}, 16);
	};

	/** 一条已经过参数校验的请求。 */
	interface RequestInput {
		id: string;
		method: string;
		params: unknown;
	}

	const handleRequest = (frame: RequestInput): void => {
		const { id, method } = frame;
		const params = isRecord(frame.params) ? frame.params : {};
		if (process.env.MOCK_TRACE === "1") {
			const shown = frame.params === undefined ? "" : JSON.stringify(frame.params).slice(0, 90);
			console.log(`[mock] 请求 ${method} ${shown}`);
		}
		const contract = REQUEST_CONTRACTS[method];
		if (contract === undefined) {
			violation(`请求了协议里不存在的方法 ${method}`);
		} else if (!contract.check(frame.params ?? {})) {
			// 参数按协议校验表检查，形状不对就是客户端发错了
			violation(`请求 ${method} 的参数不符合约定: ${JSON.stringify(frame.params).slice(0, 120)}`);
			fail(id, "bad_params", `invalid params for ${method}`);
			return;
		}
		switch (method) {
			case "markSessionsSeen": {
				const files = Array.isArray(params.sessionFiles)
					? params.sessionFiles.filter((item): item is string => typeof item === "string")
					: [];
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
				const file = asString(params.sessionFile);
				const session = sessions.find((item) => item.file === file);
				if (session === undefined) {
					fail(id, "unknown_session", `no such session: ${file ?? ""}`);
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
				const channel = asString(params.channel) ?? "";
				subscriptions.add(channel);
				const forced = takeFault("resync");
				const result: { seq: number; resync: boolean; session?: SessionSnapshot } = {
					seq: seqs.get(channel) ?? 0,
					resync: forced !== undefined,
				};
				const parsed = /^session:\/(.+)$/.exec(channel);
				if (parsed !== null) {
					const session = sessions.find((item) => item.id === parsed[1]);
					if (session !== undefined) {
						const snapshot = sessionSnapshot(session);
						snapshot.lastTime = undefined;
						result.session = snapshot;
					}
				}
				ok(id, result);
				return;
			}
			case "unsubscribe":
				subscriptions.delete(asString(params.channel) ?? "");
				ok(id, {});
				return;
			case "entries": {
				const session = sessions.find((item) => item.id === asString(params.sessionId));
				if (session === undefined) {
					fail(id, "unknown_session", "no such session");
					return;
				}
				const limit = Math.min(Math.max(asNumber(params.limit) ?? 50, 1), 500);
				const all = session.entries;
				const cursor = asString(params.cursor);
				// 游标是上一条已读条目的 id；没给就是从末尾往前取一页
				const end = cursor === undefined ? all.length : all.findIndex((entry) => entry.id === cursor);
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
			case "contextDetails":
				ok(id, {
					contextWindow: 200000,
					reportedTokens: 21000,
					reportedPercent: 10.5,
					estimatedTokens: 21000,
					categories: [
						{ id: "system-prompt", tokens: 3000 },
						{ id: "built-in-tools", tokens: 4000 },
						{ id: "user-messages", tokens: 2000 },
						{ id: "assistant-messages", tokens: 12000 },
					],
					hiddenTools: [],
					compactions: 0,
				});
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

	/** 一条已经取出通道的派发帧。 */
	interface DispatchInput {
		channel: string;
		action: unknown;
		clientSeq: unknown;
	}

	const handleDispatch = (frame: DispatchInput): void => {
		const { channel, action, clientSeq } = frame;
		const type = actionType(action);
		console.log(`[mock] 派发 ${channel} ${type ?? "?"} seq=${String(clientSeq)}`);
		if (!authenticated) {
			violation("鉴权之前就发来了派发帧");
			socket.destroy();
			return;
		}
		if (typeof clientSeq !== "number") {
			violation(`派发帧没有 clientSeq: ${JSON.stringify(action)?.slice(0, 80)}`);
		} else if (clientSeq <= lastClientSeq) {
			violation(`clientSeq 没有递增: ${clientSeq} 紧跟 ${lastClientSeq}`);
		} else {
			lastClientSeq = clientSeq;
		}
		const origin: ActionOrigin | undefined =
			typeof clientSeq === "number" ? { clientId, clientSeq } : undefined;
		const contract = type === undefined ? undefined : DISPATCH_CONTRACTS[type];
		if (contract === undefined) {
			violation(`派发了主机内部动作或未知动作 ${type ?? ""}`);
			send({
				type: "action",
				channel: channel as Channel,
				action: echoOf(action, type ?? ""),
				serverSeq: seqs.get(channel) ?? 0,
				origin,
				rejectionReason: `action is produced by the host: ${type ?? ""}`,
			});
			return;
		}
		if (!contract.check(action)) {
			violation(`动作 ${type} 不符合约定`);
			send({
				type: "action",
				channel: channel as Channel,
				action: echoOf(action, type ?? ""),
				serverSeq: seqs.get(channel) ?? 0,
				origin,
				rejectionReason: `bad_params: action does not match ${type ?? ""}`,
			});
			return;
		}
		const forcedReject = takeFault("reject");
		if (forcedReject !== undefined) {
			console.log(`[mock][故障] 拒绝这条派发: ${forcedReject.reason}`);
			send({
				type: "action",
				channel: channel as Channel,
				action: echoOf(action, type ?? ""),
				serverSeq: seqs.get(channel) ?? 0,
				origin,
				rejectionReason: forcedReject.reason,
			});
			return;
		}
		// 运行态下界面把消息走 session 通道排队，压测里同样当成一次发送
		if (type === "session/pendingMessageSet") {
			const parsed = /^session:\/(.+)$/.exec(channel);
			const target = parsed === null ? undefined : sessions.find((item) => item.id === parsed[1]);
			if (target !== undefined) {
				startStreaming(target, `chat:/${target.id}`, channel);
			}
			return;
		}
		const parsed = /^chat:\/(.+)$/.exec(channel);
		const session = parsed === null ? undefined : sessions.find((item) => item.id === parsed[1]);
		if (session === undefined) {
			return;
		}
		if (type === "chat/turnStarted") {
			// 先回执受理，再开始假流式；与真实主机一样，动作的进展靠后续推送反映
			const receipt = { type: "chat/inputHandled" };
			const late = takeFault("late-receipt");
			if (late !== undefined) {
				console.log(`[mock][故障] 回执延后 ${late.ms}ms`);
				setTimeout(() => push(channel, receipt, origin), late.ms);
			} else {
				push(channel, receipt, origin);
			}
			const duplicate = takeFault("dup-receipt");
			if (duplicate !== undefined) {
				// 同一条回执再发一次：界面应当按 clientSeq 认出来，不重复通知
				console.log("[mock][故障] 回执重复投递");
				push(channel, receipt, origin);
			}
			startStreaming(session, channel, `session:/${session.id}`);
			console.log(`[mock] 开始流式: ${session.id} 速率 ${stream.rate}/s 时长 ${stream.seconds}s`);
			return;
		}
		if (type === "chat/turnCancelled") {
			if (streaming !== undefined) {
				clearInterval(streaming);
				streaming = undefined;
			}
			session.phase = "idle";
			push(channel, { type: "chat/settled", aborted: true });
			push(`session:/${session.id}`, { type: "session/phase", phase: "idle", maintenance: undefined });
			console.log(`[mock] 已中止: ${session.id} clientSeq=${String(clientSeq)}`);
		}
	};

	const decoder = new FrameDecoder();
	socket.setEncoding("utf8");
	socket.on("data", (chunk: string) => {
		let lines: string[];
		try {
			lines = decoder.push(chunk);
		} catch {
			violation("单帧超过长度上限");
			socket.destroy();
			return;
		}
		for (const line of lines) {
			let parsed: unknown;
			try {
				parsed = JSON.parse(line);
			} catch {
				violation(`帧不是合法 JSON: ${line.slice(0, 80)}`);
				continue;
			}
			if (!isRecord(parsed)) {
				violation(`帧不是对象: ${line.slice(0, 80)}`);
				continue;
			}
			const frame = parsed;
			if (frame.type === "auth") {
				authenticated = true;
				send({
					type: "hello",
					protocolVersion: PROTOCOL_VERSION,
					hostId: HOST_ID,
					hostName: "mock host",
					clientId,
					role: "admin",
					canManage: true,
					agentDir: `${CWD}/agent`,
					capabilities: ["dispatch", "tools", "compaction", "extensionUi"],
				});
				console.log(`[mock] 握手完成，端标识 ${clientId}`);
				continue;
			}
			if (frame.type === "request") {
				if (!authenticated) {
					violation("鉴权之前就发来了请求帧");
					socket.destroy();
					return;
				}
				const id = asString(frame.id);
				const method = asString(frame.method);
				if (id === undefined || method === undefined) {
					violation(`请求帧缺少 id 或 method: ${line.slice(0, 80)}`);
					continue;
				}
				handleRequest({ id, method, params: frame.params });
				continue;
			}
			if (frame.type === "dispatch") {
				const channel = asString(frame.channel);
				if (channel === undefined) {
					violation(`派发帧缺少 channel: ${line.slice(0, 80)}`);
					continue;
				}
				handleDispatch({ channel, action: frame.action, clientSeq: frame.clientSeq });
				continue;
			}
			violation(`收到未知的帧类型 ${String(frame.type)}`);
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

/** 控制口能改的几项。 */
interface ControlPayload {
	/** 装载一条故障 */
	fault?: Fault;
	/** 流式速率，每秒字符数 */
	rate?: number;
	/** 流式持续秒数 */
	seconds?: number;
	/** 把状态造到第几个会话上 */
	sessionIndex?: number;
	/** 下一次流式的收尾结果 */
	outcome?: TurnOutcome;
	/** 待答交互数 */
	pendingInput?: number;
	/** 造一条未读收尾 */
	unread?: boolean;
}

/** 控制口收到的 JSON 收成已知字段，认不出的键忽略。 */
function readControlPayload(body: string): ControlPayload | undefined {
	let raw: unknown;
	try {
		raw = JSON.parse(body);
	} catch {
		return undefined;
	}
	if (!isRecord(raw)) {
		return undefined;
	}
	const payload: ControlPayload = {};
	if (raw.fault === null) {
		payload.fault = undefined;
	} else if (isRecord(raw.fault)) {
		payload.fault = parseFault(raw.fault);
	}
	const rate = asNumber(raw.rate);
	if (rate !== undefined) {
		payload.rate = rate;
	}
	const seconds = asNumber(raw.seconds);
	if (seconds !== undefined) {
		payload.seconds = seconds;
	}
	const sessionIndex = asNumber(raw.sessionIndex);
	if (sessionIndex !== undefined) {
		payload.sessionIndex = sessionIndex;
	}
	if (raw.outcome === "completed" || raw.outcome === "failed") {
		payload.outcome = raw.outcome;
	}
	const pendingInput = asNumber(raw.pendingInput);
	if (pendingInput !== undefined) {
		payload.pendingInput = pendingInput;
	}
	if (raw.unread === true) {
		payload.unread = true;
	}
	return payload;
}

/** 把控制口给的一份故障描述变成已知的故障种类，认不出就当没给。 */
function parseFault(raw: Record<string, unknown>): Fault | undefined {
	const kind = raw.kind;
	if (kind === "reject") {
		return { kind, reason: asString(raw.reason) ?? "rejected by mock" };
	}
	if (kind === "late-receipt") {
		return { kind, ms: asNumber(raw.ms) ?? 0 };
	}
	if (kind === "gap" || kind === "out-of-order" || kind === "resync" || kind === "dup-receipt") {
		return { kind };
	}
	return undefined;
}

/** 控制口：改流式速率与时长，压测脚本据此在同一连接上跑不同速率。 */
const control = createHttpServer((request, response) => {
	if (request.method !== "POST") {
		response.writeHead(405).end();
		return;
	}
	let body = "";
	request.setEncoding("utf8");
	request.on("data", (chunk: string) => {
		body += chunk;
	});
	request.on("end", () => {
		const next = readControlPayload(body);
		if (next === undefined) {
			response.writeHead(400).end("bad json");
			return;
		}
		fault = next.fault;
		if (next.fault !== undefined) {
			console.log(`[mock] 故障已装载: ${JSON.stringify(next.fault)}`);
		}
		if (next.rate !== undefined) {
			stream.rate = next.rate;
		}
		if (next.seconds !== undefined) {
			stream.seconds = next.seconds;
		}
		// 造状态用：下一次流式按指定结果收尾，或直接给某个会话挂上待答交互
		const target = next.sessionIndex === undefined ? undefined : sessions[next.sessionIndex];
		if (target !== undefined) {
			if (next.outcome !== undefined) {
				target.nextOutcome = next.outcome;
			}
			if (next.pendingInput !== undefined) {
				target.pendingInput = next.pendingInput;
				broadcastStatus(target);
			}
			if (next.unread === true) {
				const outcome: TurnOutcome = next.outcome ?? "completed";
				target.settle = {
					at: Date.now(),
					outcome,
					message: outcome === "failed" ? "假主机造出来的失败" : undefined,
				};
				target.seenAt = 0;
				broadcastStatus(target);
			}
		}
		response.writeHead(200, { "content-type": "application/json" });
		response.end(JSON.stringify({ ...stream, fault: fault ?? null, violations: violations.length }));
		console.log(`[mock] 参数已更新: 速率 ${stream.rate}/s 时长 ${stream.seconds}s`);
	});
});
control.listen(options.controlPort, "127.0.0.1", () => {
	const controlAddress = control.address();
	controlPort = typeof controlAddress === "object" && controlAddress !== null ? controlAddress.port : 0;
	maybeAnnounce();
});

/** 退出前把违规汇总打出来，--check 下这就是这一步的结论。 */
function reportViolations(): void {
	if (violations.length === 0) {
		if (options.check) {
			console.log("[mock][检查] 没有发现协议违规");
		}
		return;
	}
	console.log(`[mock][检查] 共 ${violations.length} 条违规:`);
	for (const item of violations) {
		console.log(`  - ${item}`);
	}
}

/** Ctrl+C 与 kill 都按同一套收尾：先汇总违规，再按退出码退。 */
function shutdown(): void {
	reportViolations();
	process.exit(process.exitCode ?? 0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

server.listen(options.port, "127.0.0.1", () => {
	const address = server.address();
	endpointPort = typeof address === "object" && address !== null ? address.port : 0;
	maybeAnnounce();
	console.log(
		`[mock] 监听 127.0.0.1:${endpointPort}  会话 ${options.sessions} 个  每个 ${options.turns} 轮  ` +
			`流式 ${stream.rate}/s 持续 ${stream.seconds}s  工具输出 ${options.toolOutput} 行`,
	);
	if (options.check) {
		console.log("[mock] --check 已打开：客户端发错参数、发主机内部动作、clientSeq 不递增都会记违规");
	}
	console.log(`[mock] 用 FACET_ENDPOINT=127.0.0.1:${endpointPort} npm run dev 连过来`);
});
