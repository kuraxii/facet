/**
 * 终端。
 *
 * 终端跑在主机的 pty 子进程里，动作走 `terminal:/<id>` 通道广播给所有订阅端：两台端同时
 * 看着同一个 shell 是常态，因此输入不做仲裁，输出按通道序号定序。
 */

/** 终端的退出结果。 */
export interface TerminalExit {
	/** 退出码，被信号终止时表示信号编号 */
	exitCode: number;
	/** 收到信号时的编号，正常退出时没有 */
	signal?: number;
}

/**
 * 一个终端的状态。
 *
 * 主机重启后重新列出以前开过的终端时 restored 为真，这些只能看历史，不能再写入。
 */
export interface TerminalInfo {
	/** 终端标识，通道 URI 里的那段 */
	id: string;
	/** 启动时的工作目录 */
	cwd: string;
	/** 实际启动的 shell 路径 */
	shell: string;
	/** 标题，取 shell 给出的窗口标题，缺省用 shell 文件名 */
	title: string;
	/** 当前列数 */
	cols: number;
	/** 当前行数 */
	rows: number;
	/** shell 进程号，启动失败前为 0 */
	pid: number;
	/** 创建时间，毫秒时间戳 */
	createdAt: number;
	/** 最近一次被写入或订阅的时间，毫秒时间戳 */
	lastUsedAt: number;
	/** 结束结果，还在跑时为 null */
	exit: TerminalExit | null;
	/** 是否是主机重启后从记录里重新列出的终端，这种只能看，不能写 */
	restored: boolean;
}

/** 终端动作。 */
export type TerminalAction =
	/** 主机侧：一段输出。通道序号在帧上，端据此发现缺口。 */
	| { type: "terminal/data"; id: string; text: string }
	/** 主机侧：进程结束 */
	| { type: "terminal/exit"; id: string; exit: TerminalExit }
	/** 主机侧：终端被别的端关掉，登记里不再存在 */
	| { type: "terminal/closed"; id: string }
	/** 主机侧：尺寸变化，动画以外的端据此跟着改 */
	| { type: "terminal/resized"; id: string; cols: number; rows: number };

/** 终端通道。一个终端一条。 */
export function terminalChannelFor(terminalId: string): `terminal:/${string}` {
	return `terminal:/${terminalId}`;
}
