/**
 * 终端登记与通道。
 *
 * 每个终端一条 `terminal:/<id>` 通道：输出按通道序号定序，广播给所有订阅端，两台端同时
 * 看着同一个 shell 是常态。一个终端的动作量可能很大，因此有两层节流：
 *
 * - 合批：pty 侧的零碎输出在 `PtyBackend` 里已按 5ms 窗口并过；
 * - 流控：主机按未确认字符数记账，超过高水位让 pty 暂停读，端确认回来降到低水位再恢复。
 *
 * 登记同时写进数据目录的 `terminals.json`，主机重启后据此把以前开过的终端列成已结束。
 */
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeFileAtomic } from "@facet/agent";
import type {
	Action,
	ActionFrame,
	Channel,
	SubscribeResult,
	TerminalExit,
	TerminalInfo,
} from "@facet/protocol";
import { terminalChannelFor } from "@facet/protocol";
import { EventLog } from "./event-log.ts";
import type { PtyBackend, PtyHandle, PtySpawnOptions } from "./pty-host.ts";

/** 单帧最大字符数，超出就切开，避免一帧撑爆对端的解析缓冲。 */
const MAX_FRAME_CHARS = 64 * 1024;

/** 未确认字符数的高水位，超过就让 pty 暂停读。 */
const HIGH_WATERMARK_CHARS = 100_000;

/** 低水位，确认回到这个数以下再恢复。 */
const LOW_WATERMARK_CHARS = 5_000;

/** 每个终端保留的回滚文本字符数。 */
const SCROLLBACK_CHARS = 200_000;

/** 每个终端保留的帧数，断线期间的动作要落在这个范围内，超出时端靠回滚重放修正。 */
const REPLAY_FRAMES = 64;

/** 登记文件的格式版本。 */
const FILE_VERSION = 1;

/** 登记文件里的一条记录。 */
interface StoredTerminal {
	/** 终端标识 */
	id: string;
	/** 启动目录 */
	cwd: string;
	/** 启动的 shell */
	shell: string;
	/** 标题 */
	title: string;
	/** 列数 */
	cols: number;
	/** 行数 */
	rows: number;
	/** 创建时间，毫秒 */
	createdAt: number;
	/** 最近一次使用的时间，毫秒 */
	lastUsedAt: number;
	/** 结束结果，主机重启前还没结束的记为 null */
	exit: TerminalExit | null;
}

/** 订阅者。id 是端标识，send 把一帧推给它。 */
export interface TerminalSink {
	readonly id: string;
	send(frame: ActionFrame): void;
}

/** 一条已发出的数据帧的记账：帧序号与到这一帧为止发出的累计字符数。 */
interface FlowFrame {
	seq: number;
	/** 到这一帧为止累计发出的字符数 */
	sentUpTo: number;
}

/** 一个终端在主机侧的全部状态。 */
interface TerminalRow {
	info: TerminalInfo;
	/** 进程句柄，已结束或重启前留下的终端没有 */
	handle: PtyHandle | undefined;
	log: EventLog;
	sinks: Set<TerminalSink>;
	/** 回滚文本，超过上限时从头部切掉 */
	scrollback: string;
	/** 累计发出的字符数 */
	sentChars: number;
	/** 端已确认到的字符数 */
	ackedChars: number;
	/** 待确认的记账，最旧的一头在确认推进后被丢掉 */
	frames: FlowFrame[];
	/** 是否因为水位已让 pty 暂停读 */
	paused: boolean;
}

/** 开终端时界面给的参数。 */
export interface CreateTerminalOptions {
	/** 启动目录 */
	cwd: string;
	/** 列数 */
	cols: number;
	/** 行数 */
	rows: number;
	/** shell 路径，缺省用 pty 子进程的环境变量 SHELL */
	shell?: string;
}

/** 终端的当前状态与回滚内容，端挂载或重连时先取这一份。 */
export interface TerminalSnapshot {
	/** 回滚缓冲里的可见文本 */
	text: string;
	/** 当前通道序号，端从这里接着收增量 */
	seq: number;
	/** 列数 */
	cols: number;
	/** 行数 */
	rows: number;
}

export class TerminalService {
	private readonly backend: PtyBackend;
	private readonly rows = new Map<string, TerminalRow>();
	private readonly file: string | undefined;
	/** 写登记文件的队列，避免并发写把内容打散 */
	private saving: Promise<void> = Promise.resolve();

	/** file 给定时把登记写进数据目录；不给就是纯内存，测试用。 */
	constructor(options: { backend: PtyBackend; file?: string }) {
		this.backend = options.backend;
		this.file = options.file;
	}

	/** pty 后端不可用的原因，可用时为 undefined。 */
	get unavailable(): string | undefined {
		return this.backend.unavailable;
	}

	/**
	 * 读回上次的登记。
	 *
	 * 主机重启后 pty 子进程也跟着结束，所以读回来的记录一律标成 restored：能看历史与回滚
	 * 的空壳，不能再写入。
	 */
	async load(): Promise<void> {
		const file = this.file;
		if (file === undefined) {
			return;
		}
		let raw: string;
		try {
			raw = await readFile(file, "utf8");
		} catch {
			return;
		}
		for (const record of parseStoredFile(raw)) {
			if (this.rows.has(record.id)) {
				continue;
			}
			this.rows.set(record.id, {
				info: {
					id: record.id,
					cwd: record.cwd,
					shell: record.shell,
					title: record.title,
					cols: record.cols,
					rows: record.rows,
					pid: 0,
					createdAt: record.createdAt,
					lastUsedAt: record.lastUsedAt,
					exit: record.exit,
					restored: true,
				},
				handle: undefined,
				log: new EventLog(REPLAY_FRAMES),
				sinks: new Set(),
				scrollback: "",
				sentChars: 0,
				ackedChars: 0,
				frames: [],
				paused: false,
			});
		}
	}

	/** 全部终端，还在跑的排在前面，其余按最近使用时间从新到旧。 */
	list(): TerminalInfo[] {
		return [...this.rows.values()]
			.map((row) => ({ ...row.info }))
			.sort((left, right) => {
				const leftRunning = isRunning(left);
				const rightRunning = isRunning(right);
				if (leftRunning !== rightRunning) {
					return leftRunning ? -1 : 1;
				}
				return right.lastUsedAt - left.lastUsedAt;
			});
	}

	/** 取一个终端的状态，不存在时返回 undefined。 */
	get(id: string): TerminalInfo | undefined {
		const row = this.rows.get(id);
		return row === undefined ? undefined : { ...row.info };
	}

	/** 开一个终端。创建动作不走通道：还没订阅的端拿不到，清单靠 listTerminals 取。 */
	async create(options: CreateTerminalOptions): Promise<TerminalInfo> {
		const failure = this.unavailable;
		if (failure !== undefined) {
			throw new Error(failure);
		}
		const id = randomUUID();
		// 先登记再起进程：pty 一启动就可能吐输出，回调里要能找到对应的行
		const row: TerminalRow = {
			info: {
				id,
				cwd: options.cwd,
				shell: options.shell ?? defaultShell(),
				title: "",
				cols: Math.max(2, Math.round(options.cols)),
				rows: Math.max(2, Math.round(options.rows)),
				pid: 0,
				createdAt: Date.now(),
				lastUsedAt: Date.now(),
				exit: null,
				restored: false,
			},
			handle: undefined,
			log: new EventLog(REPLAY_FRAMES),
			sinks: new Set(),
			scrollback: "",
			sentChars: 0,
			ackedChars: 0,
			frames: [],
			paused: false,
		};
		this.rows.set(id, row);
		const spawnOptions: PtySpawnOptions = {
			cwd: options.cwd,
			cols: row.info.cols,
			rows: row.info.rows,
			shell: options.shell,
		};
		try {
			row.handle = await this.backend.spawn(spawnOptions, {
				data: (text) => this.onData(row, text),
				exit: (result) => this.onExit(row, result),
			});
		} catch (error) {
			this.rows.delete(id);
			throw error;
		}
		row.info.pid = row.handle.pid;
		row.info.shell = row.handle.shell;
		row.info.title = shellTitle(row.handle.shell);
		void this.save();
		return { ...row.info };
	}

	/** 写入按键。已结束的终端不接受写入。 */
	write(id: string, data: string): void {
		const row = this.running(id);
		row.info.lastUsedAt = Date.now();
		row.handle?.write(data);
	}

	/** 改尺寸并把新尺寸推给其他端。 */
	resize(id: string, cols: number, rows: number): void {
		const row = this.rows.get(id);
		if (row === undefined) {
			throw new Error(`没有这个终端：${id}`);
		}
		const nextCols = Math.max(2, Math.round(cols));
		const nextRows = Math.max(2, Math.round(rows));
		if (row.info.cols === nextCols && row.info.rows === nextRows) {
			return;
		}
		row.info.cols = nextCols;
		row.info.rows = nextRows;
		row.info.lastUsedAt = Date.now();
		row.handle?.resize(nextCols, nextRows);
		this.publish(terminalChannelFor(id), row, {
			type: "terminal/resized",
			id,
			cols: nextCols,
			rows: nextRows,
		});
	}

	/** 挂断终端并从登记里移除。 */
	kill(id: string): void {
		const row = this.rows.get(id);
		if (row === undefined) {
			throw new Error(`没有这个终端：${id}`);
		}
		const handle = row.handle;
		row.handle = undefined;
		if (handle !== undefined) {
			handle.kill();
		}
		this.rows.delete(id);
		this.publish(terminalChannelFor(id), row, { type: "terminal/closed", id });
		void this.save();
	}

	/** 回滚文本与当前序号。已结束的终端也能取回滚内容。 */
	serialize(id: string): TerminalSnapshot {
		const row = this.rows.get(id);
		if (row === undefined) {
			throw new Error(`没有这个终端：${id}`);
		}
		row.info.lastUsedAt = Date.now();
		return { text: row.scrollback, seq: row.log.lastSeq, cols: row.info.cols, rows: row.info.rows };
	}

	/**
	 * 确认已收到的输出。
	 *
	 * seq 及之前的帧当作端已处理，未确认字符数相应扣减；降到低水位而且之前暂停过，就让
	 * pty 继续读。
	 */
	ack(id: string, seq: number): void {
		const row = this.rows.get(id);
		if (row === undefined) {
			return;
		}
		let acked = 0;
		let keep = 0;
		for (const frame of row.frames) {
			if (frame.seq <= seq) {
				acked = frame.sentUpTo;
				keep += 1;
			} else {
				break;
			}
		}
		row.frames = row.frames.slice(keep);
		row.ackedChars = Math.max(row.ackedChars, acked);
		if (row.paused && row.sentChars - row.ackedChars <= LOW_WATERMARK_CHARS) {
			row.paused = false;
			row.handle?.resume();
		}
	}

	/** 未发出确认的输出量，诊断与测试用。 */
	pendingChars(id: string): number {
		const row = this.rows.get(id);
		return row === undefined ? 0 : row.sentChars - row.ackedChars;
	}

	/** 订阅一个终端通道，先补发缓冲里的动作再收实时动作。 */
	subscribe(channel: Channel, since: number | undefined, sink: TerminalSink): SubscribeResult {
		const row = this.rows.get(terminalIdFromChannel(channel) ?? "");
		if (row === undefined) {
			return { seq: 0, resync: true };
		}
		const { actions, resync } = row.log.replay(since ?? row.log.lastSeq);
		row.info.lastUsedAt = Date.now();
		row.sinks.add(sink);
		for (const item of actions) {
			sink.send(toFrame(channel, item.action, item.seq));
		}
		return { seq: row.log.lastSeq, resync };
	}

	/** 取消订阅。 */
	unsubscribe(channel: Channel, sink: TerminalSink): void {
		const id = terminalIdFromChannel(channel);
		if (id === undefined) {
			return;
		}
		this.rows.get(id)?.sinks.delete(sink);
	}

	/** 全部订阅者断开，端点关闭时用。 */
	clear(): void {
		for (const row of this.rows.values()) {
			row.sinks.clear();
		}
	}

	/** 关掉全部终端并停掉 pty 子进程。 */
	dispose(): void {
		for (const row of this.rows.values()) {
			if (row.handle !== undefined) {
				row.handle.kill();
				row.handle = undefined;
			}
			row.sinks.clear();
		}
		this.backend.dispose();
	}

	/** 取一个还在跑的终端，已结束或重启前留下的直接拒绝。 */
	private running(id: string): TerminalRow {
		const row = this.rows.get(id);
		if (row === undefined) {
			throw new Error(`没有这个终端：${id}`);
		}
		if (row.handle === undefined || row.info.restored) {
			throw new Error("这个终端已经结束");
		}
		return row;
	}

	/** pty 有输出：写回滚、按帧切分、按序号发布、记账并视水位暂停。 */
	private onData(row: TerminalRow, text: string): void {
		if (text.length === 0) {
			return;
		}
		row.scrollback = trimScrollback(row.scrollback + text);
		row.info.lastUsedAt = Date.now();
		const channel = terminalChannelFor(row.info.id);
		for (const chunk of splitChunks(text)) {
			row.sentChars += chunk.length;
			const sequenced = row.log.append({ type: "terminal/data", id: row.info.id, text: chunk });
			row.frames.push({ seq: sequenced.seq, sentUpTo: row.sentChars });
			const frame = toFrame(channel, sequenced.action, sequenced.seq);
			for (const sink of [...row.sinks]) {
				sink.send(frame);
			}
		}
		if (!row.paused && row.sentChars - row.ackedChars > HIGH_WATERMARK_CHARS) {
			row.paused = true;
			row.handle?.pause();
		}
	}

	/** pty 结束：记下退出结果并广播。手工结束以外的终点不移除登记，界面还能看回滚。 */
	private onExit(row: TerminalRow, result: TerminalExit): void {
		row.handle = undefined;
		row.info.exit = result;
		this.publish(terminalChannelFor(row.info.id), row, {
			type: "terminal/exit",
			id: row.info.id,
			exit: result,
		});
		void this.save();
	}

	/** 追加一条动作并推给所有订阅者。 */
	private publish(channel: Channel, row: TerminalRow, action: Action): void {
		const sequenced = row.log.append(action);
		const frame = toFrame(channel, sequenced.action, sequenced.seq);
		for (const sink of [...row.sinks]) {
			sink.send(frame);
		}
	}

	/** 把登记写回数据目录。写失败只影响重启后能不能列出来，不打断终端本身。 */
	private async save(): Promise<void> {
		const file = this.file;
		if (file === undefined) {
			return;
		}
		const records: StoredTerminal[] = [...this.rows.values()]
			.filter((row) => !row.info.restored)
			.map((row) => ({
				id: row.info.id,
				cwd: row.info.cwd,
				shell: row.info.shell,
				title: row.info.title,
				cols: row.info.cols,
				rows: row.info.rows,
				createdAt: row.info.createdAt,
				lastUsedAt: row.info.lastUsedAt,
				exit: row.info.exit,
			}));
		const payload = `${JSON.stringify({ version: FILE_VERSION, terminals: records }, null, 2)}\n`;
		this.saving = this.saving
			.then(() => writeFileAtomic(file, payload))
			.catch((error: unknown) => {
				console.error("终端登记写入失败", error);
			});
	}
}

/** 是否还在跑。 */
function isRunning(info: TerminalInfo): boolean {
	return info.exit === null && !info.restored;
}

/** 从通道 URI 里取终端标识，格式不符时返回 undefined。 */
function terminalIdFromChannel(channel: Channel): string | undefined {
	const prefix = "terminal:/";
	return channel.startsWith(prefix) ? channel.slice(prefix.length) : undefined;
}

/** 组装一帧动作。 */
function toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
	return { type: "action", channel, action, serverSeq: seq, origin: undefined };
}

/** 把一段输出切成不超过单帧上限的若干段。 */
function splitChunks(text: string): string[] {
	if (text.length <= MAX_FRAME_CHARS) {
		return [text];
	}
	const chunks: string[] = [];
	for (let index = 0; index < text.length; index += MAX_FRAME_CHARS) {
		chunks.push(text.slice(index, index + MAX_FRAME_CHARS));
	}
	return chunks;
}

/** 回滚文本超过上限时只留尾部，避免一个 `yes` 把主机的内存占满。 */
function trimScrollback(text: string): string {
	return text.length <= SCROLLBACK_CHARS ? text : text.slice(text.length - SCROLLBACK_CHARS);
}

/** 标题缺省取 shell 的文件名，例如 `/bin/bash` 取 `bash`。 */
function shellTitle(shell: string): string {
	const name = shell
		.split("/")
		.filter((part) => part.length > 0)
		.pop();
	return name ?? shell;
}

/** 后端没给 shell 时先按环境变量猜一个，spawn 之后以回执为准。 */
function defaultShell(): string {
	return process.env.SHELL?.trim() || "/bin/sh";
}

/** 读登记文件，格式不对时当作空。 */
function parseStoredFile(raw: string): StoredTerminal[] {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	if (typeof parsed !== "object" || parsed === null) {
		return [];
	}
	const terminals = (parsed as { terminals?: unknown }).terminals;
	if (!Array.isArray(terminals)) {
		return [];
	}
	const records: StoredTerminal[] = [];
	for (const item of terminals) {
		const record = parseStoredTerminal(item);
		if (record !== undefined) {
			records.push(record);
		}
	}
	return records;
}

/** 校验一条记录，字段不全的丢掉。 */
function parseStoredTerminal(value: unknown): StoredTerminal | undefined {
	if (typeof value !== "object" || value === null) {
		return undefined;
	}
	const source = value as Record<string, unknown>;
	const id = source.id;
	const cwd = source.cwd;
	const shell = source.shell;
	if (typeof id !== "string" || typeof cwd !== "string" || typeof shell !== "string") {
		return undefined;
	}
	const exit = source.exit;
	const exitRecord =
		typeof exit === "object" && exit !== null ? (exit as Record<string, unknown>) : undefined;
	return {
		id,
		cwd,
		shell,
		title: typeof source.title === "string" ? source.title : shellTitle(shell),
		cols: typeof source.cols === "number" ? source.cols : 80,
		rows: typeof source.rows === "number" ? source.rows : 24,
		createdAt: typeof source.createdAt === "number" ? source.createdAt : Date.now(),
		lastUsedAt: typeof source.lastUsedAt === "number" ? source.lastUsedAt : Date.now(),
		exit:
			exitRecord !== undefined && typeof exitRecord.exitCode === "number"
				? {
						exitCode: exitRecord.exitCode,
						signal: typeof exitRecord.signal === "number" ? exitRecord.signal : undefined,
					}
				: null,
	};
}
