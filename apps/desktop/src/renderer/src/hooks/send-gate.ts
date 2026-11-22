/**
 * 发送闸门。
 *
 * 慢回执时输入区看起来仍然「有内容、可以发」：草稿要等主机确认才收，而 React 的重绘又要等一帧，
 * 于是同一帧里的连点、长按回车的连发都会各自走到一次派发。闸门是这件事唯一的同步判据：
 *
 * - 按草稿键占位，占住期间同一个键再来就放弃，**不会**重复编码同一批图片；
 * - 占位之前再问一次本端有没有待确认的发送，有就不开始；
 * - 键之间互不牵连：会话 A 在等回执时切到 B，B 照样发得出去。
 *
 * 闸门只管「谁先占住」，编码与派发仍由调用方做，做完调 `close()` 解开。
 */
export interface SendTicket {
	/** 编码与派发都结束了（成功、失败或会话被切走），解开闸门；重复调用无副作用 */
	close(): void;
}

export interface SendGate {
	/** 这个草稿是否正在编码图片，界面据此把发送入口置灰 */
	isEncoding(key: string): boolean;
	/**
	 * 同步占位。
	 *
	 * 这个键正在编码、或本端已有待确认的发送时返回 `undefined`，调用方直接放弃这一次；
	 * 否则返回票据，调用方跑完编码与派发后必须 `close()`。
	 */
	begin(key: string): SendTicket | undefined;
}

export interface SendGateOptions {
	/** 本端此刻有没有待确认的一轮发送，同步读取 */
	hasPendingSend: () => boolean;
	/** 正在编码的草稿键变化后回调，参数是当前全部在编码的键 */
	onChange: (encoding: ReadonlySet<string>) => void;
}

/** 建一份闸门。 */
export function createSendGate(options: SendGateOptions): SendGate {
	const encoding = new Set<string>();
	// 每次都给一份新副本：界面拿到的集合不随后续变化而变，React 才看得出前后不同
	const publish = () => options.onChange(new Set(encoding));
	return {
		isEncoding: (key) => encoding.has(key),
		begin(key) {
			if (encoding.has(key) || options.hasPendingSend()) {
				return undefined;
			}
			encoding.add(key);
			publish();
			let closed = false;
			return {
				close: () => {
					// 编码失败与「中途切走会话」都会走到这里，只解一次
					if (closed) {
						return;
					}
					closed = true;
					encoding.delete(key);
					publish();
				},
			};
		},
	};
}
