/**
 * 系统通知的唯一出口。
 *
 * 界面只发"哪个会话、什么状态词"，要不要弹由这里判断：窗口在前台时用户已经看着了，弹出来
 * 只是打扰；最小化与被别的窗口盖住时 `isFocused()` 都为假，正是要弹的时候。
 *
 * 不直接 `new Notification(...)`：构造函数由调用方给（`main/index.ts` 传 Electron 的那一个），
 * 这一层只留判断与点击回传，所以能在没有 Electron 的测试环境里跑。
 */

/** 弹一条通知要什么。 */
export interface NotifyRequest {
	/** 发通知的会话文件，点通知后要切过去 */
	readonly file: string;
	/** 正文：一条状态词，见 `notification.<kind>` 文案 */
	readonly body: string;
}

/** Electron `Notification` 里这一层用得到的部分。 */
export interface NotificationLike {
	on(event: "click" | "close", listener: () => void): void;
	show(): void;
}

/**
 * 造通知对象的函数（`main/index.ts` 传 Electron 的 `Notification`）。
 *
 * 返回 `undefined` 表示这台机器上没有通知能力：`Notification.isSupported()` 要等 app ready
 * 之后才准，所以这个判断放进函数里、每次弹之前问一次，而不是启动时定死。
 */
export type NotificationFactory = (options: { title: string; body: string }) => NotificationLike | undefined;

/** 带焦点的窗口：最小化时它也是假，所以只看这一个就够了。 */
export interface FocusState {
	readonly focused: boolean;
}

/** 这次该不该弹：只有窗口不是前台时才弹。 */
export function shouldNotify(state: FocusState): boolean {
	return !state.focused;
}

export interface NotifierOptions {
	/** 造通知对象；浏览器端那种没有通知能力的宿主可以整条省略 */
	readonly createNotification: NotificationFactory | undefined;
	/** 点了某条通知：把窗口拉到前台，再让界面切到那个会话 */
	readonly onClick: (file: string) => void;
	/** 通知标题，固定是产品名 */
	readonly title: string;
}

/** 通知出口。 */
export interface Notifier {
	/** 弹一条；窗口在前台或系统不支持通知时返回 false */
	show(request: NotifyRequest, state: FocusState): boolean;
}

export function createNotifier(options: NotifierOptions): Notifier {
	// 通知对象被回收后点击不会再回到主进程，所以弹出去的那几条要在手里攥着
	const live = new Set<NotificationLike>();
	return {
		show(request, state) {
			const create = options.createNotification;
			if (create === undefined || !shouldNotify(state)) {
				return false;
			}
			const notification = create({ title: options.title, body: request.body });
			if (notification === undefined) {
				return false;
			}
			live.add(notification);
			notification.on("click", () => {
				live.delete(notification);
				options.onClick(request.file);
			});
			notification.on("close", () => {
				live.delete(notification);
			});
			notification.show();
			return true;
		},
	};
}
