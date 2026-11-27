/**
 * 外部 ACP 会话的轻量本地索引。
 *
 * 只保存侧栏展示与恢复需要的元数据（backendId、externalSessionId、cwd、title 与时间戳），
 * 不镜像消息正文；聊天历史在恢复运行态时直接通过 ACP `session/load` 回放。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { makeAcpLocator, type SessionSummary } from "@facet/protocol";
import { writeFileAtomic } from "../atomic-write.ts";
import { normalizeProjectPath } from "../projects.ts";

const INDEX_SCHEMA_VERSION = 1;
const INDEX_FILENAME = "acp-sessions.json";

/** 索引里的单条 ACP 会话记录。 */
export interface AcpSessionRecord {
	/** 所属 ACP 后端标识 */
	backendId: string;
	/** ACP 服务端分配的会话标识 */
	externalSessionId: string;
	/** 定位符：`acp://<backendId>/<externalSessionId>` */
	path: string;
	/** 规范化后的工作目录 */
	cwd: string;
	/** 用户重命名后的标题 */
	name?: string;
	/** Unix 毫秒创建时刻 */
	created: number;
	/** Unix 毫秒最近活跃时刻 */
	modified: number;
	/** 首条用户消息摘要 */
	firstMessage: string;
}

interface StoredIndex {
	version: number;
	sessions: AcpSessionRecord[];
}

function toSummary(record: AcpSessionRecord): SessionSummary {
	return {
		id: record.externalSessionId,
		backendId: record.backendId,
		path: record.path,
		cwd: record.cwd,
		name: record.name,
		parentSessionPath: undefined,
		created: record.created,
		modified: record.modified,
		firstMessage: record.firstMessage,
	};
}

/** ACP 轻量会话索引的磁盘存储。 */
export class AcpSessionIndex {
	readonly filePath: string;
	private records = new Map<string, AcpSessionRecord>();
	private loaded = false;

	constructor(agentDir: string) {
		this.filePath = join(agentDir, INDEX_FILENAME);
	}

	/** 列出 ACP 会话摘要，按最近活跃时间倒序。 */
	list(cwd?: string, backendId?: string): SessionSummary[] {
		this.ensureLoaded();
		const wantCwd = cwd === undefined ? undefined : normalizeProjectPath(cwd);
		const items: SessionSummary[] = [];
		for (const record of this.records.values()) {
			if (backendId !== undefined && record.backendId !== backendId) {
				continue;
			}
			if (wantCwd !== undefined && record.cwd !== wantCwd) {
				continue;
			}
			items.push(toSummary(record));
		}
		return items.sort((left, right) => right.modified - left.modified);
	}

	/** 按定位符取回单条索引记录。 */
	get(locator: string): AcpSessionRecord | undefined {
		this.ensureLoaded();
		return this.records.get(locator);
	}

	/** 按定位符获取侧栏摘要。 */
	summaryOf(locator: string): SessionSummary | undefined {
		const record = this.get(locator);
		return record === undefined ? undefined : toSummary(record);
	}

	/** 新建或更新一条 ACP 会话元数据并原子写盘。 */
	async upsert(input: {
		backendId: string;
		externalSessionId: string;
		cwd: string;
		name?: string;
		created?: number;
		modified?: number;
		firstMessage?: string;
	}): Promise<AcpSessionRecord> {
		this.ensureLoaded();
		const path = makeAcpLocator(input.backendId, input.externalSessionId);
		const existing = this.records.get(path);
		const now = Date.now();
		const record: AcpSessionRecord = {
			backendId: input.backendId,
			externalSessionId: input.externalSessionId,
			path,
			cwd: normalizeProjectPath(input.cwd),
			name: input.name !== undefined ? input.name : existing?.name,
			created: existing?.created ?? input.created ?? now,
			modified: input.modified ?? now,
			firstMessage:
				existing !== undefined && existing.firstMessage.length > 0
					? existing.firstMessage
					: (input.firstMessage ?? ""),
		};
		this.records.set(path, record);
		await this.flush();
		return record;
	}

	/** 重命名一条 ACP 会话（空名清除自定义标题）。 */
	async rename(locator: string, name: string | undefined): Promise<SessionSummary | undefined> {
		this.ensureLoaded();
		const existing = this.records.get(locator);
		if (existing === undefined) {
			return undefined;
		}
		const trimmed = name?.trim();
		const updated: AcpSessionRecord = {
			...existing,
			name: trimmed !== undefined && trimmed.length > 0 ? trimmed : undefined,
		};
		this.records.set(locator, updated);
		await this.flush();
		return toSummary(updated);
	}

	/** 从本地索引删除一条 ACP 会话记录。 */
	async remove(locator: string): Promise<boolean> {
		this.ensureLoaded();
		const existed = this.records.delete(locator);
		if (existed) {
			await this.flush();
		}
		return existed;
	}

	private ensureLoaded(): void {
		if (this.loaded) {
			return;
		}
		this.loaded = true;
		if (!existsSync(this.filePath)) {
			return;
		}
		try {
			const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<StoredIndex>;
			const list = Array.isArray(parsed.sessions) ? parsed.sessions : [];
			for (const item of list) {
				if (
					typeof item?.backendId === "string" &&
					typeof item.externalSessionId === "string" &&
					typeof item.cwd === "string"
				) {
					const path = makeAcpLocator(item.backendId, item.externalSessionId);
					this.records.set(path, {
						backendId: item.backendId,
						externalSessionId: item.externalSessionId,
						path,
						cwd: normalizeProjectPath(item.cwd),
						name: typeof item.name === "string" ? item.name : undefined,
						created: typeof item.created === "number" ? item.created : Date.now(),
						modified: typeof item.modified === "number" ? item.modified : Date.now(),
						firstMessage: typeof item.firstMessage === "string" ? item.firstMessage : "",
					});
				}
			}
		} catch {
			// 损坏索引按空处理，避免阻断其余功能
		}
	}

	private async flush(): Promise<void> {
		const payload: StoredIndex = {
			version: INDEX_SCHEMA_VERSION,
			sessions: [...this.records.values()],
		};
		await writeFileAtomic(this.filePath, `${JSON.stringify(payload, null, "\t")}\n`);
	}
}
