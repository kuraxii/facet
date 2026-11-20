/**
 * 工作树通道。
 *
 * 一个项目目录一条 `workspace:/<cwd>` 通道：谁订上就替谁盯着那个目录，最后一个订阅者走了
 * 就把监听停掉。同一个目录只建一份监听，多端共用一份事件。
 *
 * 动作只带「变了」这一件事，不带状态：状态由端自己按需来取，几个端于是各自拿到自己那一刻
 * 的快照，主机不必为每个端缓存一份。
 */
import { stat } from "node:fs/promises";
import type { Action, ActionFrame, Channel, SubscribeResult } from "@facet/protocol";
import { parseChannel } from "@facet/protocol";
import { EventLog, replayAndSubscribe } from "./event-log.ts";
import { debugLog } from "./log.ts";
import { ProjectWatch } from "./project-watch.ts";

/** 订阅者。id 是端标识，send 把一帧推给它。 */
export interface WorkspaceSink {
	readonly id: string;
	send(frame: ActionFrame): void;
}

/** 一个目录在主机侧的全部状态。 */
interface Entry {
	/** 目录绝对路径 */
	cwd: string;
	/** 这条通道的动作序号与回放缓冲 */
	log: EventLog<Action>;
	/** 当前订阅者 */
	sinks: Set<WorkspaceSink>;
	/** 目录监听；没有订阅者时为空 */
	watch: ProjectWatch | undefined;
}

/** 回放缓冲条数：工作树变化很稀疏，留几条够断线期间补上。 */
const REPLAY_LIMIT = 16;

/** 监听参数。 */
export interface WorkspaceServiceOptions {
	/** 不挂监听的目录名，与文件树共用一份 */
	ignored: ReadonlySet<string>;
	/** 合并窗口，毫秒，缺省 500 */
	debounceMs?: number;
}

export class WorkspaceService {
	private readonly options: WorkspaceServiceOptions;
	private readonly entries = new Map<Channel, Entry>();

	constructor(options: WorkspaceServiceOptions) {
		this.options = options;
	}

	/**
	 * 订阅一个目录。
	 *
	 * 目录不存在或不是目录时返回 undefined，由调用方按未知通道拒绝——通道标识就是目录，
	 * 对不上的标识不该建出一条永远不会有事件的通道。
	 */
	async subscribe(
		channel: Channel,
		since: number | undefined,
		sink: WorkspaceSink,
	): Promise<SubscribeResult | undefined> {
		const cwd = parseChannel(channel)?.id;
		if (cwd === undefined) {
			return undefined;
		}
		const info = await stat(cwd).catch(() => undefined);
		if (info === undefined || !info.isDirectory()) {
			return undefined;
		}
		const entry = this.entries.get(channel) ?? {
			cwd,
			log: new EventLog<Action>(REPLAY_LIMIT),
			sinks: new Set<WorkspaceSink>(),
			watch: undefined,
		};
		this.entries.set(channel, entry);
		if (entry.watch === undefined) {
			// 第一个订阅者到了才建监听，没人看的时候主机不为任何目录付出代价；
			// 建好再返回，否则订阅刚成功就写盘的那一拍会漏掉
			const watch = this.createWatch(channel, entry);
			entry.watch = watch;
			await watch.start().catch((error: unknown) => {
				// 监听建不起来不影响订阅：端照样可以自己按需重取，只是收不到信号
				debugLog("workspace", "Failed to watch a project directory", {
					cwd: entry.cwd,
					error: String(error),
				});
			});
		}
		const { seq, resync } = replayAndSubscribe(
			entry.log,
			entry.sinks,
			sink,
			(item) => toFrame(channel, item.action, item.seq),
			since,
		);
		return { seq, resync };
	}

	/** 退掉一个订阅者；最后一个走了就停监听。 */
	unsubscribe(channel: Channel, sink: WorkspaceSink): void {
		const entry = this.entries.get(channel);
		if (entry === undefined) {
			return;
		}
		entry.sinks.delete(sink);
		if (entry.sinks.size > 0) {
			return;
		}
		entry.watch?.stop();
		entry.watch = undefined;
	}

	/** 主机退出时全部停掉。 */
	stopAll(): void {
		for (const entry of this.entries.values()) {
			entry.watch?.stop();
			entry.watch = undefined;
		}
		this.entries.clear();
	}

	/** 这个目录此刻有几个订阅者，测试用。 */
	subscriberCount(channel: Channel): number {
		return this.entries.get(channel)?.sinks.size ?? 0;
	}

	/** 建出目录监听：变化到点后追加一条动作，推给此刻的订阅者。 */
	private createWatch(channel: Channel, entry: Entry): ProjectWatch {
		const watch = new ProjectWatch({
			cwd: entry.cwd,
			ignored: this.options.ignored,
			...(this.options.debounceMs === undefined ? {} : { debounceMs: this.options.debounceMs }),
			onChange: (change) => {
				const sequenced = entry.log.append({ type: "workspace/changed", history: change.history });
				const frame = toFrame(channel, sequenced.action, sequenced.seq);
				for (const sink of [...entry.sinks]) {
					sink.send(frame);
				}
			},
		});
		return watch;
	}
}

/** 把一条动作拼成帧。 */
function toFrame(channel: Channel, action: Action, seq: number): ActionFrame {
	return { type: "action", channel, action, serverSeq: seq, origin: undefined };
}
