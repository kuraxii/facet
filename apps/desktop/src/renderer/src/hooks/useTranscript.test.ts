/**
 * @vitest-environment jsdom
 *
 * 竖轨顶端「补一页」的可用状态。
 *
 * `client.hasMore` 是运行期游标上的取值：首屏那一页回来之前是 `false`，补完最后一页又归零，
 * 这两种变化都不会投影到 chat view。这一组只关心一件事——游标变了，交出去给竖轨用的
 * `hasMore` 也跟着变，不会停在挂载那一刻的取值上（那样「…」会一直灰着点不动）。
 */
import type { SessionClient } from "@facet/client-core";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { type Transcript, useTranscript } from "./useTranscript.ts";

// React 19 的 act 只在测试环境里开关作批处理，这个开关是 React 的约定
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | undefined;

afterEach(() => {
	act(() => root?.unmount());
	root = undefined;
	document.body.innerHTML = "";
});

/** 一台只记账的客户端：游标可以随时改，`loadOlder` 按排好的结果收场。 */
function fakeClient(): {
	client: SessionClient;
	setHasMore: (value: boolean) => void;
	queuePage: (page: { loaded: number; hasMore: boolean }) => void;
} {
	let hasMore = false;
	const queued: Array<{ loaded: number; hasMore: boolean }> = [];
	const client = {
		get hasMore() {
			return hasMore;
		},
		loadOlder: async () => {
			const page = queued.shift() ?? { loaded: 0, hasMore: false };
			hasMore = page.hasMore;
			return page;
		},
		chatView: () => undefined,
	} as unknown as SessionClient;
	return {
		client,
		setHasMore: (value: boolean) => {
			hasMore = value;
		},
		queuePage: (page) => queued.push(page),
	};
}

/**
 * 把 hook 的返回值抬出来给断言用。
 *
 * 组件放在模块层：每次渲染换一个组件类型会让 React 卸载重挂、状态被重置，
 * 那样根本测不到"游标变了以后要不要跟着对齐"。
 */
function TranscriptProbe(props: {
	client: SessionClient;
	activeFile: string;
	sink: { current: Transcript | undefined };
}): null {
	props.sink.current = useTranscript({
		client: props.client,
		chat: undefined,
		activeFile: props.activeFile,
		openedSessionId: "s1",
	});
	return null;
}

/** 挂一次宿主，返回把结果抬出来的 sink */
function mount(): {
	sink: { current: Transcript | undefined };
	render: (client: SessionClient, activeFile: string) => void;
} {
	const sink: { current: Transcript | undefined } = { current: undefined };
	const host = document.createElement("div");
	document.body.append(host);
	root = createRoot(host);
	return {
		sink,
		render: (client, activeFile) => {
			act(() => root?.render(createElement(TranscriptProbe, { client, activeFile, sink })));
		},
	};
}

describe("补一页的可用状态", () => {
	it("首屏那一页回来之后跟着变可用", () => {
		const { client, setHasMore } = fakeClient();
		const view = mount();

		view.render(client, "a.jsonl");
		expect(view.sink.current?.hasMore).toBe(false);

		// 首页到达：游标有了值，但没有引起投影变化，只能靠一次渲染对齐
		setHasMore(true);
		view.render(client, "b.jsonl");
		expect(view.sink.current?.hasMore).toBe(true);
	});

	it("补到最后一页之后重新变回不可用", async () => {
		const { client, setHasMore, queuePage } = fakeClient();
		setHasMore(true);
		queuePage({ loaded: 42, hasMore: false });
		const view = mount();

		view.render(client, "a.jsonl");
		expect(view.sink.current?.hasMore).toBe(true);

		await act(async () => {
			view.sink.current?.loadOlderNow();
		});
		expect(view.sink.current?.hasMore).toBe(false);
	});
});
