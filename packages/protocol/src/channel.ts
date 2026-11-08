/**
 * 通道 URI。
 *
 * 通道是订阅与路由的键:每条动作都归属于一个通道,订阅以通道为单位。会话通道只承载
 * 元信息与阻塞项,对话通道承载轮次内容,两者分开订阅,侧栏因此不必接收流式增量。
 */

/** 通道的种类。每种对应一类可独立定序、独立订阅的资源。 */
export type ChannelKind = "session" | "chat" | "diff" | "terminal";

/** 通道 URI,形如 `chat:/<sessionId>`。 */
export type Channel = `${ChannelKind}:/${string}`;

const CHANNEL_PATTERN = /^(session|chat|diff|terminal):\/(.+)$/;

/** 拼出通道 URI。 */
export function makeChannel(kind: ChannelKind, id: string): Channel {
	return `${kind}:/${id}`;
}

/** 解析通道 URI。格式不符时返回 undefined,调用方据此拒绝请求。 */
export function parseChannel(channel: string): { kind: ChannelKind; id: string } | undefined {
	const matched = CHANNEL_PATTERN.exec(channel);
	if (!matched) {
		return undefined;
	}
	const kind = matched[1];
	const id = matched[2];
	if (!kind || !id) {
		return undefined;
	}
	return { kind: kind as ChannelKind, id };
}
