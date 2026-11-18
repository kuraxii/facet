/**
 * 通知 → 轻提示的桥。
 *
 * 只在新增通知时弹一条；换会话或整份清单被替换时只重设游标，不把历史通知重弹一遍。
 */
import type { ChatView, SessionView } from "@facet/client-core";
import type { ToastInput } from "@facet/ui";
import { useEffect, useRef } from "react";
import { freshNotices, type NoticeCursor, type NoticeLike, noticesTail } from "./notice-bridge.ts";

/** 桥的入参。 */
export interface NoticeBridgeOptions {
	/** 当前对话通道的视图；没有打开的会话时为空 */
	chat: ChatView | undefined;
	/** 当前会话的视图 */
	session: SessionView | undefined;
	/** 当前会话的标识，用来识别换会话 */
	sessionId: string | undefined;
	/** 弹一条提示 */
	show: (input: Omit<ToastInput, "now">) => void;
}

/** 一条来源的游标，键换了就重设基线。 */
interface SourceState {
	/** 来源标识：对话用通道名，会话用会话标识 */
	key: string;
	/** 已经消费到哪 */
	cursor: NoticeCursor;
}

/** 空游标。 */
const EMPTY_CURSOR: NoticeCursor = { count: 0, tail: undefined };

/** 把一组通知弹出去。 */
function emit(notices: readonly NoticeLike[], show: NoticeBridgeOptions["show"]): void {
	for (const notice of notices) {
		show({ level: notice.level, message: notice.message });
	}
}

export function useNoticeBridge({ chat, session, sessionId, show }: NoticeBridgeOptions): void {
	const chatState = useRef<SourceState>({ key: "", cursor: EMPTY_CURSOR });
	const sessionState = useRef<SourceState>({ key: "", cursor: EMPTY_CURSOR });

	const channel = chat?.channel;
	const chatNotices = chat?.notices ?? [];
	useEffect(() => {
		if (channel === undefined) {
			return;
		}
		if (chatState.current.key !== channel) {
			// 换了通道：旧通道的通知已经弹过，这里只记基线
			chatState.current = {
				key: channel,
				cursor: { count: chatNotices.length, tail: noticesTail(chatNotices) },
			};
			return;
		}
		const { cursor, fresh } = freshNotices(chatState.current.cursor, chatNotices);
		chatState.current = { key: channel, cursor };
		emit(fresh, show);
	}, [channel, chatNotices, show]);

	const extensionNotices = session?.state.extensionUi.notices ?? [];
	useEffect(() => {
		if (sessionId === undefined) {
			return;
		}
		if (sessionState.current.key !== sessionId) {
			sessionState.current = {
				key: sessionId,
				cursor: { count: extensionNotices.length, tail: noticesTail(extensionNotices) },
			};
			return;
		}
		const { cursor, fresh } = freshNotices(sessionState.current.cursor, extensionNotices);
		sessionState.current = { key: sessionId, cursor };
		emit(fresh, show);
	}, [sessionId, extensionNotices, show]);
}
