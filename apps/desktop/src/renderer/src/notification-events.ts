/**
 * 会话状态的变化能翻成哪几条系统通知。
 *
 * 主机推来的 `SessionStatus` 只陈述事实：在不在忙、最近一轮怎么收的尾、有几个交互在等人。
 * 「该不该弹」由这里推：一次推送与上一次比，**只有状态真的换了才弹**，否则每一帧都弹一条。
 *
 * 不弹的两种：新出现的会话（它的历史收尾是旧事，弹出来是噪音）、用户自己中止的一轮
 * （主机不给这一轮记收尾，见 `SessionSettle`）。
 */
import type { SessionStatus } from "@facet/protocol";

/** 一条通知说的是哪种事。 */
export type NotificationKind = "settled" | "needsInput" | "failed";

/** 一个会话的判据：只留"上一次是什么样"用得上的三个事实。 */
export interface SessionSignal {
	/** 最近一轮收尾的时刻；为空表示没有收尾可报 */
	readonly settleAt: number | undefined;
	/** 那次收尾是不是失败（`turnOutcome` 只有完成与失败两档） */
	readonly failed: boolean;
	/** 此刻有没有交互在等人回答 */
	readonly needsInput: boolean;
}

/** 一条待弹的通知。 */
export interface NotificationEvent {
	/** 发通知的会话文件，点通知后要切过去 */
	readonly file: string;
	/** 这次发生了什么 */
	readonly kind: NotificationKind;
}

/** 从主机状态取出判据。 */
export function signalOf(status: SessionStatus): SessionSignal {
	return {
		settleAt: status.settle?.at,
		failed: status.settle?.outcome === "failed",
		needsInput: status.pendingInput > 0,
	};
}

/** 一次推送里所有会话的判据，键是会话文件。 */
export type SignalMap = ReadonlyMap<string, SessionSignal>;

/**
 * 两份判据之间该弹哪些通知。
 *
 * 同一帧里既收了尾又在等人时只弹「需要你回答」——那一件在等用户动手，更有用。收尾时刻没变
 * 就不弹，所以重连、换主机、重复推送都不会把同一条再弹一次。
 */
export function collectNotifications(previous: SignalMap, next: SignalMap): readonly NotificationEvent[] {
	const events: NotificationEvent[] = [];
	for (const [file, signal] of next) {
		const before = previous.get(file);
		if (before === undefined) {
			continue;
		}
		if (signal.needsInput && !before.needsInput) {
			events.push({ file, kind: "needsInput" });
			continue;
		}
		if (signal.settleAt === undefined || signal.settleAt === before.settleAt) {
			continue;
		}
		events.push({ file, kind: signal.failed ? "failed" : "settled" });
	}
	return events;
}
