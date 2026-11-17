/**
 * 会话文件上的离线操作。
 *
 * 会话没被打开时也要能改名：这里只打开文件、追加一条会话信息条目，不建立运行态。
 * pi SDK 的物理布局只在这个包里出现，服务端不直接碰。
 */
import { SessionManager } from "@earendil-works/pi-coding-agent";

/**
 * 给一个没打开的会话文件改名。
 *
 * 名字为空时写入空串，等于去掉自定义名。同步执行：调用方拿到返回时条目已经落盘，
 * 与打开着的会话走运行态改名是同一份结果。
 */
export function renamePersistedSession(sessionFile: string, name: string | undefined): void {
	const trimmed = name?.trim() ?? "";
	const manager = SessionManager.open(sessionFile);
	manager.appendSessionInfo(trimmed);
}
