/**
 * 通道 URI。
 *
 * 通道是订阅与路由的键:每条动作都归属于一个通道,订阅以通道为单位。会话通道只承载
 * 元信息与阻塞项,对话通道承载轮次内容,两者分开订阅,侧栏因此不必接收流式增量。
 */

/** 通道的种类。每种对应一类可独立定序、独立订阅的资源。 */
export type ChannelKind = "session" | "chat" | "terminal" | "sessions" | "models" | "workspace";

/** 通道 URI,形如 `chat:/<sessionId>`。 */
export type Channel = `${ChannelKind}:/${string}`;

const CHANNEL_PATTERN = /^(session|chat|terminal|sessions|models|workspace):\/(.+)$/;

/** 拼出通道 URI。 */
export function makeChannel(kind: ChannelKind, id: string): Channel {
	return `${kind}:/${id}`;
}

/** 会话清单通道,一个主机一条,id 是主机标识。多个端订阅同一条,拿到同一份清单变化。 */
export function sessionsChannelFor(hostId: string): Channel {
	return makeChannel("sessions", hostId);
}

/**
 * 模型通道,一个主机一条,id 是主机标识。
 *
 * 承载与具体会话无关的模型侧状态。目前只有提供方登录的推进：登录要用到浏览器回调
 * 与多步问答，不是一次请求能说完的，所以用一条可回放的通道推给所有端。
 */
export function modelsChannelFor(hostId: string): Channel {
	return makeChannel("models", hostId);
}

/**
 * 工作树通道,一个项目目录一条,id 是目录的绝对路径。
 *
 * 变更页要跟着工作树自己更新,而工作树在主机上:订阅即表示「替我盯着这个目录」,
 * 主机按订阅者把监听建起来,没人看了就停。一个目录只建一份监听,多端共用。
 */
export function workspaceChannelFor(cwd: string): Channel {
	return makeChannel("workspace", cwd);
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
