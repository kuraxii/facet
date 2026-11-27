/**
 * @vitest-environment jsdom
 *
 * 输入区的发送闸门。
 *
 * 慢回执期间输入区看起来仍然「有内容、可以发」：草稿要等主机确认才收。这一组用例只关心一件
 * 事——同一段时间里点多少下都只发一条，并且主机的三种收场（回执、被拒、断线重连）之后还能
 * 接着发。图片编码用假的顶掉，好数它被调了几次。
 */
import type { ReclaimedQueueItem, SessionClient, SessionView } from "@facet/client-core";
import { PI_AGENT_CAPABILITIES, PI_AGENT_ID } from "@facet/protocol";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encodeImage } from "../image-encode.ts";
import { type Composer, useComposer } from "./useComposer.ts";

// 编码这一步要数次数：真的读 Blob 既慢又和用例无关
vi.mock("../image-encode.ts", async (importOriginal) => {
	const actual = await importOriginal<typeof import("../image-encode.ts")>();
	return {
		...actual,
		encodeImage: vi.fn(async (image: { mimeType: string }) => ({
			type: "image" as const,
			data: "AA==",
			mimeType: image.mimeType,
		})),
	};
});

// React 19 的 act 只在测试环境里开关作批处理，这个开关是 React 的约定
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 会话视图：只有这份用例用到的字段是真的，别的按空闲态填。 */
function sessionView(file: string, hasPendingSend: boolean): SessionView {
	return {
		channel: `session:/${file}` as SessionView["channel"],
		state: {
			agentId: PI_AGENT_ID,
			capabilities: PI_AGENT_CAPABILITIES,
			acpMode: undefined,
			acpConfigOptions: [],
			initialization: { kind: "ready" },
			extensionUi: { prompts: [] },
			file,
			cwd: "/w",
			title: undefined,
			model: undefined,
			thinkingLevel: "off",
			availableThinkingLevels: [],
			phase: "idle",
			maintenance: undefined,
			contextUsage: undefined,
			stats: undefined,
			queued: { steering: [], followUp: [] },
			hasPendingSend,
		},
	};
}

/** 一台只记账不发包的客户端。 */
function fakeClient() {
	const state = {
		pending: false,
		sent: [] as string[],
		demoted: 0,
		reclaimListeners: new Set<(items: ReclaimedQueueItem[], sessionId: string) => void>(),
	};
	const client = {
		hasPendingSend: () => state.pending,
		send: (text: string) => {
			state.sent.push(text);
			return state.sent.length;
		},
		demoteSteering: () => {
			state.demoted += 1;
			return state.demoted;
		},
		listCommands: async () => [],
		onSent: () => () => {},
		onQueueReclaimed: (listener: (items: ReclaimedQueueItem[], sessionId: string) => void) => {
			state.reclaimListeners.add(listener);
			return () => {
				state.reclaimListeners.delete(listener);
			};
		},
	} as unknown as SessionClient;
	return {
		client,
		state,
		emitReclaimed: (items: ReclaimedQueueItem[], sessionId = "a") => {
			for (const listener of [...state.reclaimListeners]) {
				listener(items, sessionId);
			}
		},
	};
}

/** 一次渲染要用的那几样东西。 */
interface ProbeProps {
	/** 假的会话客户端 */
	client: SessionClient;
	/** 当时的会话视图 */
	view: { file: string; hasPendingSend: boolean; pending: boolean };
	/** 每次渲染把 Hook 的返回值交回来 */
	sink: (composer: Composer) => void;
}

/** 只负责把 Hook 挂起来的空组件：什么都不画，结果走 `sink`。 */
function Probe({ client, view, sink }: ProbeProps): null {
	sink(
		useComposer({
			client,
			session: sessionView(view.file, view.hasPendingSend),
			openedSessionId: "a",
			activeFile: view.file,
			activity: "idle",
			host: undefined,
			setSessionError: () => {},
			withTrust: (_cwd, run) => run(),
			runSessionAction: (action) => void action(),
			refreshSessions: async () => {},
		}),
	);
	return null;
}

/** 一份挂好的输入区：`current` 是最近一次渲染拿到的 Composer。 */
interface Harness {
	/** 最近一次渲染的返回值 */
	current: Composer;
	/** 交给客户端的那些文本，按派发顺序 */
	readonly sent: readonly string[];
	/** 改草稿并等渲染落定 */
	type(text: string): Promise<void>;
	/** 往当前草稿加一张待发图片 */
	addImage(): Promise<void>;
	/** 点一次发送（同一个事件循环里连点就是连点） */
	send(times?: number): Promise<void>;
	/** 换一份会话视图重渲染，模拟回执到达或切会话 */
	render(next: { file: string; hasPendingSend: boolean; pending: boolean }): Promise<void>;
	unmount(): void;
}

/** 把 Hook 挂进 jsdom。 */
async function mount(): Promise<Harness> {
	const { client, state } = fakeClient();
	let current: Composer | undefined;
	let view = { file: "/w/a.jsonl", hasPendingSend: false, pending: false };
	const container = document.createElement("div");
	document.body.append(container);
	const root: Root = createRoot(container);

	const sink = (composer: Composer) => {
		current = composer;
	};

	await act(async () => {
		root.render(createElement(Probe, { client, view, sink }));
	});

	const composer = (): Composer => {
		if (current === undefined) {
			throw new Error("Hook 没有渲染");
		}
		return current;
	};

	return {
		get current() {
			return composer();
		},
		get sent() {
			return state.sent;
		},
		async type(text) {
			await act(async () => {
				composer().updateDraft(text);
			});
		},
		async addImage() {
			await act(async () => {
				composer().addImages([new File([new Uint8Array([1, 2, 3])], "shot.png", { type: "image/png" })]);
			});
		},
		async send(times = 1) {
			await act(async () => {
				for (let index = 0; index < times; index += 1) {
					composer().send();
				}
				// 让编码那一小段异步跑完
				await Promise.resolve();
				await Promise.resolve();
			});
		},
		async render(next) {
			view = next;
			state.pending = next.pending;
			await act(async () => {
				root.render(createElement(Probe, { client, view, sink }));
			});
		},
		unmount() {
			act(() => {
				root.unmount();
			});
			container.remove();
		},
	} satisfies Harness;
}

/**
 * 内存里的 localStorage。
 *
 * 这个 jsdom 环境没带它（草稿落盘才用到），用例给它一份最小实现：能写能读能清就够。
 */
function installLocalStorage(): void {
	const store = new Map<string, string>();
	Object.defineProperty(globalThis, "localStorage", {
		configurable: true,
		value: {
			getItem: (key: string) => store.get(key) ?? null,
			setItem: (key: string, value: string) => void store.set(key, value),
			removeItem: (key: string) => void store.delete(key),
			clear: () => store.clear(),
		},
	});
}

beforeEach(() => {
	vi.mocked(encodeImage).mockClear();
	// jsdom 没有 objectURL：待发图片的预览地址只需要一个字符串
	(globalThis.URL as unknown as { createObjectURL: () => string }).createObjectURL = () => "blob:preview";
	installLocalStorage();
});

afterEach(() => {
	document.body.innerHTML = "";
});

describe("输入区的发送闸门", () => {
	it("慢回执期间连点三次只发一条，也只编码一次", async () => {
		const harness = await mount();
		await harness.type("你好");
		await harness.addImage();
		// 主机还没确认：客户端那边随时可能变，但这一帧里三次调用是连着来的
		await harness.send(3);

		expect(encodeImage).toHaveBeenCalledTimes(1);
		expect(harness.sent).toEqual(["你好"]);
		harness.unmount();
	});

	it("纯文本连点同样只发一条", async () => {
		const harness = await mount();
		await harness.type("你好");
		await harness.send(3);
		// 没有图片时编码不会跑，闸门靠占位与在途状态挡住后两下
		expect(encodeImage).not.toHaveBeenCalled();
		expect(harness.sent).toEqual(["你好"]);
		harness.unmount();
	});

	it("回执到达之后能接着发下一条", async () => {
		const harness = await mount();
		await harness.type("第一条");
		await harness.send();
		// 主机确认：在途状态清掉，草稿也被收走
		await harness.render({ file: "/w/a.jsonl", hasPendingSend: false, pending: false });
		await harness.type("第二条");
		await harness.send();

		expect(harness.sent).toEqual(["第一条", "第二条"]);
		harness.unmount();
	});

	it("在途时再点也不发，解锁后才发", async () => {
		const harness = await mount();
		await harness.type("还在路上");
		await harness.render({ file: "/w/a.jsonl", hasPendingSend: true, pending: true });
		// 客户端那一侧说还有一条没确认：闸门直接放弃，连编码都不该开始
		await harness.addImage();
		await harness.send(2);
		expect(encodeImage).not.toHaveBeenCalled();
		expect(harness.sent).toEqual([]);

		await harness.render({ file: "/w/a.jsonl", hasPendingSend: false, pending: false });
		await harness.send();
		expect(encodeImage).toHaveBeenCalledTimes(1);
		expect(harness.sent).toEqual(["还在路上"]);
		harness.unmount();
	});

	it("会话 A 在途时切到会话 B，B 照常发得出去", async () => {
		const harness = await mount();
		await harness.type("发给 A 的");
		// A 有一条还没确认
		await harness.render({ file: "/w/a.jsonl", hasPendingSend: true, pending: true });
		expect(harness.current.isSending).toBe(true);

		// 切到 B：B 自己没有在途发送，客户端读的也是 B
		await harness.render({ file: "/w/b.jsonl", hasPendingSend: false, pending: false });
		expect(harness.current.isSending).toBe(false);
		expect(harness.current.draft).toBe("");
		await harness.type("发给 B 的");
		await harness.send(2);
		expect(harness.sent).toEqual(["发给 B 的"]);
		harness.unmount();
	});

	it("删除会话调用 forgetDraft 后清掉对应草稿", async () => {
		const harness = await mount();
		await harness.type("待清理的草稿");
		expect(harness.current.draft).toBe("待清理的草稿");
		await act(async () => {
			harness.current.forgetDraft("/w/a.jsonl");
		});
		expect(harness.current.draft).toBe("");
		harness.unmount();
	});

	it("demoteSteering 转发到客户端，收到本会话队列回收时按序还原文本与图片", async () => {
		const fake = fakeClient();
		let current!: Composer;
		const host = document.createElement("div");
		const root = createRoot(host);
		await act(async () => {
			root.render(
				createElement(Probe, {
					client: fake.client,
					view: { file: "/w/a.jsonl", hasPendingSend: false, pending: false },
					sink: (value) => {
						current = value;
					},
				}),
			);
		});

		await act(async () => {
			current.demoteSteering();
		});
		expect(fake.state.demoted).toBe(1);

		await act(async () => {
			current.updateDraft("正在输入的草稿");
		});
		// 其他会话的回收通知不会污染当前输入框
		await act(async () => {
			fake.emitReclaimed([{ text: "别的会话" }], "other-session");
		});
		expect(current.draft).toBe("正在输入的草稿");

		await act(async () => {
			fake.emitReclaimed([
				{ text: "插话一" },
				{ text: "后续二", images: [{ type: "image", data: "AA==", mimeType: "image/png" }] },
			]);
		});
		expect(current.draft).toBe("插话一\n\n后续二\n\n正在输入的草稿");
		expect(current.pendingImages).toHaveLength(1);
		expect(current.pendingImages[0]?.mimeType).toBe("image/png");

		await act(async () => {
			root.unmount();
		});
	});
});
