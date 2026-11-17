/**
 * 一次连接里已处理过的派发序号。
 *
 * 端点的派发帧带 `clientSeq`，界面重试或同一端重复投递时同一个 `(clientId, clientSeq)`
 * 会再来一次。`clientId` 由主机在连接建立时分配（`hello` 帧带回），连接关闭即失效，所以
 * 窗口按连接挂：连接没了窗口跟着没，长连接下也有固定上限，不会无限涨。
 *
 * 命中窗口时的语义：
 *
 * - `accepted`：跳过处理器，绝不二次触发 `withSession` / `prompt` / 写操作；当初产生过消费
 *   回执的，补发同一条回执。
 * - `rejected`：原样回发同样的拒绝原因。
 * - `inflight`：首条还没出结果，丢弃重复帧，等首条的结果。
 */
export type DispatchRecord =
	| { readonly state: "inflight" }
	| { readonly state: "accepted"; readonly handled: boolean }
	| { readonly state: "rejected"; readonly reason: string };

/** 每次连接保留多少个已处理序号，按插入顺序淘汰最旧的。 */
export const DISPATCH_WINDOW = 512;

export class DispatchLog {
	/** 插入顺序即处理顺序，淘汰时取第一个键。 */
	private readonly entries = new Map<number, DispatchRecord>();

	/** 这条序号处理过没有。 */
	peek(clientSeq: number): DispatchRecord | undefined {
		return this.entries.get(clientSeq);
	}

	/** 记下「正在处理」。重复帧进来时靠它挡掉并行重入。 */
	begin(clientSeq: number): void {
		this.entries.set(clientSeq, { state: "inflight" });
		this.evict();
	}

	/** 处理完记下结果，重复帧按它原样回应。 */
	settle(clientSeq: number, record: DispatchRecord): void {
		this.entries.set(clientSeq, record);
		this.evict();
	}

	/** 当前窗口里的条目数，测试用。 */
	get size(): number {
		return this.entries.size;
	}

	private evict(): void {
		while (this.entries.size > DISPATCH_WINDOW) {
			const oldest = this.entries.keys().next();
			if (oldest.done === true) {
				return;
			}
			this.entries.delete(oldest.value);
		}
	}
}
