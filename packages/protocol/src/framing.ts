/**
 * 帧的线编码。
 *
 * 一条帧是一行 JSON：JSON 会把换行转义，所以按行切分不会切坏内容。WebSocket 一条消息
 * 就是一帧，用不到切分；跑在字节流上的传输（unix socket、SSH 通道）按行切。
 */
import type { ClientFrame, ServerFrame } from "./wire.ts";

/**
 * 一行帧的长度上限，超过按协议错误处理，避免对端用超长行占满内存。
 *
 * 按 UTF-16 码元计，实际字节数最多是它的三倍；这个上限本来只用来挡住明显异常的帧。
 */
export const MAX_FRAME_LENGTH = 32 * 1024 * 1024;

/** 把一帧编成一行文本，含结尾换行。 */
export function encodeFrame(frame: ClientFrame | ServerFrame): string {
	return `${JSON.stringify(frame)}\n`;
}

/**
 * 按行累积的解码器。
 *
 * 分片到达时把字节攒起来，凑够整行才交出去；行超长时返回错误，由调用方断开连接。
 */
export class FrameDecoder {
	private buffer = "";

	/** 追加一段字节，取出行、可能剩半行。超长时抛错。 */
	push(chunk: string): string[] {
		this.buffer += chunk;
		if (this.buffer.length > MAX_FRAME_LENGTH) {
			this.buffer = "";
			throw new Error("帧超过上限");
		}
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		return lines.filter((line) => line.length > 0);
	}

	/** 清掉攒下的半行，连接结束时用。 */
	clear(): void {
		this.buffer = "";
	}
}
