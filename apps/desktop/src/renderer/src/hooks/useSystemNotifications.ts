/**
 * 把会话状态的变化翻成系统通知。
 *
 * 只在桌面端有用：主进程负责"窗口在不在前台"的判断与真正的弹窗（`main/notify.ts`），浏览器
 * 桥没有这两个能力，这里能力检测缺失就什么都不做。
 *
 * 每次状态推送都与上一次比（`notification-events.ts`），只有真的换了才发一条；点通知由主进程
 * 把窗口拉到前台，再回到这里把那个会话切出来。
 */

import type { SessionClient } from "@facet/client-core";
import { DEFAULT_NOTIFICATION_SETTINGS, type NotificationSettings } from "@facet/protocol";
import { useI18n } from "@facet/ui";
import { useEffect, useRef } from "react";
import { bridge } from "../bridge.ts";
import {
	collectNotifications,
	type NotificationKind,
	type SignalMap,
	signalOf,
} from "../notification-events.ts";

/** 通知正文的文案键；标题由主进程给，界面不管。 */
const BODY_KEYS = {
	settled: "notification.settled",
	needsInput: "notification.needsInput",
	failed: "notification.failed",
} as const satisfies Record<NotificationKind, string>;

export interface SystemNotificationOptions {
	/** 这台主机的会话客户端：状态从这里读 */
	readonly client: SessionClient;
	/** 点了通知之后切到那个会话 */
	readonly onOpen: (path: string) => void;
	/** 本机通知开关与触发粒度；省略时全开 */
	readonly settings?: NotificationSettings;
}

/** 读一次全部会话的判据。 */
function readSignals(client: SessionClient): SignalMap {
	const next = new Map<string, ReturnType<typeof signalOf>>();
	for (const item of client.store.sessionList()) {
		next.set(item.summary.path, signalOf(item.status));
	}
	return next;
}

function shouldSendKind(kind: NotificationKind, settings: NotificationSettings): boolean {
	if (!settings.enabled) {
		return false;
	}
	if (kind === "needsInput") {
		return settings.onNeedsInput;
	}
	return settings.onSettled;
}

export function useSystemNotifications(options: SystemNotificationOptions): void {
	const { client, onOpen, settings = DEFAULT_NOTIFICATION_SETTINGS } = options;
	const { t } = useI18n();
	// 回调与配置随渲染变化，但订阅只建一次：语言、切会话与过滤策略都经 ref 取最新那一份
	const translate = useRef(t);
	translate.current = t;
	const open = useRef(onOpen);
	open.current = onOpen;
	const policy = useRef(settings);
	policy.current = settings;

	useEffect(() => {
		const notify = bridge.notify;
		if (notify === undefined) {
			return;
		}
		// 第一次读到的状态只记账不弹：里面每一条收尾都是旧事
		let previous = readSignals(client);
		return client.store.subscribe(() => {
			const next = readSignals(client);
			const events = collectNotifications(previous, next);
			previous = next;
			for (const event of events) {
				if (shouldSendKind(event.kind, policy.current)) {
					void notify({ file: event.file, body: translate.current(BODY_KEYS[event.kind]) });
				}
			}
		});
	}, [client]);

	useEffect(() => {
		const subscribe = bridge.onNotifyClick;
		if (subscribe === undefined) {
			return;
		}
		return subscribe((file) => open.current(file));
	}, []);
}
