/**
 * 对外出口。
 *
 * 传输层只搬帧与维护连接状态，不理解动作含义。WebSocket 实现由 ./ws 单独导出，
 * 便于渲染进程只引入自己需要的那一份。
 */

export type { StreamTransportOptions } from "./stream.ts";
export { StreamTransport } from "./stream.ts";
export type {
	ConnectionState,
	Handshake,
	SocketFactory,
	SocketLike,
	StreamFactory,
	StreamLike,
	Transport,
} from "./types.ts";
export { TransportError } from "./types.ts";
export type { WsTransportOptions } from "./ws.ts";
export { WsTransport } from "./ws.ts";
