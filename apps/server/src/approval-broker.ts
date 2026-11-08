/**
 * 审批应答的中转。
 *
 * 工具执行时 PiAgent 通过 handler 等待一个决定；端点收到审批事件后调用 respond 回填。
 * 没有端点应答时工具调用保持挂起，会话被释放或设备关闭时统一按拒绝处理。
 */
import type { ApprovalHandler } from "@facet/agent";
import type { ApprovalDecision, ApprovalRequest } from "@facet/protocol";

export class ApprovalBroker {
	private readonly pending = new Map<string, (decision: ApprovalDecision) => void>();
	private closed = false;

	/** 交给 PiAgent 的处理函数。等待期间请求保留在 pending 中。 */
	readonly handler: ApprovalHandler = (request: ApprovalRequest) => this.ask(request);

	/** 尚未应答的请求数。 */
	get pendingCount(): number {
		return this.pending.size;
	}

	/** 回填一个决定。requestId 未知时返回假，表示该请求已超时或已随会话释放。 */
	respond(requestId: string, decision: ApprovalDecision): boolean {
		const resolve = this.pending.get(requestId);
		if (!resolve) {
			return false;
		}
		this.pending.delete(requestId);
		resolve(decision);
		return true;
	}

	/** 关闭中转，所有未应答请求按拒绝返回，之后到来的请求直接被拒绝。 */
	release(reason: string): void {
		this.closed = true;
		for (const [requestId, resolve] of [...this.pending]) {
			this.pending.delete(requestId);
			resolve({ action: "deny", reason });
		}
	}

	private ask(request: ApprovalRequest): Promise<ApprovalDecision> {
		if (this.closed) {
			return Promise.resolve({ action: "deny", reason: "会话已释放" });
		}
		return new Promise<ApprovalDecision>((resolve) => {
			this.pending.set(request.id, resolve);
		});
	}
}
