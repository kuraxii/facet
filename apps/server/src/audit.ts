/**
 * 远程操作审计。
 *
 * 远程连接的写操作按条记下来：时间、连接标识、权限档、操作与结果。不记参数与内容，
 * 也不记凭证，因此这份文件可以留着排查问题。
 */
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ClientRole } from "@facet/protocol";

/** 一条审计记录。 */
export interface AuditEntry {
	/** 时间，毫秒 */
	at: number;
	/** 连接标识 */
	clientId: string;
	/** 连接的权限档 */
	role: ClientRole;
	/** 记的是什么：请求方法名或动作类型 */
	name: string;
	/** 是否成功 */
	ok: boolean;
	/** 失败原因，成功时不写 */
	reason?: string;
}

export class AuditLog {
	private readonly file: string;
	/** 只剩最后一次写入的承诺，避免并发写把行打散 */
	private tail: Promise<void> = Promise.resolve();

	constructor(file: string) {
		this.file = file;
	}

	/** 追加一条记录。写失败不影响主流程，由调用方决定要不要报出来。 */
	record(entry: AuditEntry): void {
		const line = `${JSON.stringify(entry)}\n`;
		this.tail = this.tail
			.then(async () => {
				await mkdir(dirname(this.file), { recursive: true, mode: 0o700 }).catch(() => undefined);
				await appendFile(this.file, line, { encoding: "utf8", mode: 0o600 });
			})
			.catch(() => undefined);
	}

	/** 等已排队的记录写完，测试与关闭前用。 */
	async flush(): Promise<void> {
		await this.tail;
	}
}
