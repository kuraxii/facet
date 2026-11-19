/**
 * 提供方登录编排的用例。
 *
 * 假 runtime 只做一件真流程会做的事：按 provider 的实现去问、去通知、去等中止。用例盯的是
 * 转接层——问题有没有送到界面、回答有没有回到流程、取消与失败有没有各自落到对的终局。
 */
import type { AuthPrompt, Credential } from "@earendil-works/pi-ai";
import type { ProviderLoginPrompt } from "@facet/protocol";
import { describe, expect, it, vi } from "vitest";
import { ProviderLoginBusyError, ProviderLoginService, type ProviderLoginUpdate } from "./provider-login.ts";

/** 一条能落盘的凭证，流程只要它有这几项。 */
function credential(): Credential {
	return { type: "oauth", access: "access", refresh: "refresh", expires: Date.now() + 60_000 };
}

/** 从事件流里挑出第一类某型事件。 */
function firstMatch<T extends ProviderLoginUpdate["event"]["type"]>(
	events: readonly ProviderLoginUpdate[],
	type: T,
): Extract<ProviderLoginUpdate["event"], { type: T }> | undefined {
	for (const update of events) {
		if (update.event.type === type) {
			return update.event as Extract<ProviderLoginUpdate["event"], { type: T }>;
		}
	}
	return undefined;
}

describe("提供方登录", () => {
	it("要回答的一步推到界面，回答回到流程，成功后发 done", async () => {
		let received: string | undefined;
		const service = new ProviderLoginService({
			runtime: {
				login: async (_providerId, _type, interaction) => {
					received = await interaction.prompt({ type: "text", message: "账号" });
					return credential();
				},
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));

		const { loginId } = service.start("gateway", "oauth");
		await vi.waitFor(() => expect(firstMatch(events, "prompt")).toBeDefined());
		const prompt = firstMatch(events, "prompt")?.prompt;
		expect(prompt?.kind).toBe("text");
		expect(events[0]?.providerId).toBe("gateway");
		expect(events[0]?.loginId).toBe(loginId);

		expect(service.respond(loginId, prompt?.promptId ?? "", "alice")).toBe(true);
		await vi.waitFor(() => expect(firstMatch(events, "done")).toBeDefined());
		expect(received).toBe("alice");
	});

	it("四种 prompt 各自对应到线格式的 kind", async () => {
		const service = new ProviderLoginService({
			runtime: {
				login: async (_providerId, _type, interaction) => {
					const kinds: AuthPrompt[] = [
						{ type: "text", message: "文本" },
						{ type: "secret", message: "密钥", placeholder: "粘贴" },
						{ type: "manual_code", message: "回调地址" },
						{
							type: "select",
							message: "选一个",
							options: [{ id: "a", label: "A", description: "第一个" }],
						},
					];
					for (const prompt of kinds) {
						await interaction.prompt(prompt);
					}
					return credential();
				},
			},
		});
		const prompted: ProviderLoginPrompt[] = [];
		// 每来一步就答一步，流程才走得下去
		service.subscribe((update) => {
			if (update.event.type !== "prompt") {
				return;
			}
			prompted.push(update.event.prompt);
			service.respond(
				update.loginId,
				update.event.prompt.promptId,
				update.event.prompt.kind === "select" ? "a" : "x",
			);
		});
		service.start("p", "oauth");
		await vi.waitFor(() => expect(prompted.length).toBe(4));
		expect(prompted.map((prompt) => prompt.kind)).toEqual(["text", "secret", "manualCode", "select"]);
		expect(prompted[1]?.placeholder).toBe("粘贴");
		expect(prompted[3]?.options?.[0]?.description).toBe("第一个");
	});

	it("provider 收掉一步时只撤那一条，整条登录继续", async () => {
		const manual = new AbortController();
		const service = new ProviderLoginService({
			runtime: {
				login: async (_providerId, _type, interaction) => {
					// 浏览器回调先回来的情形：provider 自己撤掉粘贴框那一步
					const pending = interaction.prompt({
						type: "manual_code",
						message: "回调地址",
						signal: manual.signal,
					});
					manual.abort();
					await pending.catch(() => undefined);
					return credential();
				},
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));
		service.start("p", "oauth");
		await vi.waitFor(() => expect(firstMatch(events, "done")).toBeDefined());
		const prompt = firstMatch(events, "prompt")?.prompt;
		expect(prompt?.kind).toBe("manualCode");
		expect(firstMatch(events, "promptResolved")?.promptId).toBe(prompt?.promptId);
		expect(firstMatch(events, "cancelled")).toBeUndefined();
	});

	it("取消中止整条登录并发 cancelled", async () => {
		const service = new ProviderLoginService({
			runtime: {
				login: (_providerId, _type, interaction) =>
					new Promise<Credential>((_resolve, reject) => {
						interaction.signal?.addEventListener("abort", () => reject(new Error("Login cancelled")));
					}),
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));
		const { loginId } = service.start("p", "oauth");
		expect(service.cancel(loginId)).toBe(true);
		await vi.waitFor(() => expect(firstMatch(events, "cancelled")).toBeDefined());
		// 收尾之后同一条登录再取消或应答都不再生效
		expect(service.cancel(loginId)).toBe(false);
		expect(service.respond(loginId, "prompt-1", "x")).toBe(false);
	});

	it("失败把主机原话带出来", async () => {
		const service = new ProviderLoginService({
			runtime: {
				login: async () => {
					throw new Error("Port 1455 is in use");
				},
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));
		service.start("p", "oauth");
		await vi.waitFor(() => expect(firstMatch(events, "failed")).toBeDefined());
		expect(firstMatch(events, "failed")?.message).toBe("Port 1455 is in use");
	});

	it("authorization 与设备码按线格式转发", async () => {
		const service = new ProviderLoginService({
			runtime: {
				login: async (_providerId, _type, interaction) => {
					interaction.notify({ type: "auth_url", url: "https://example.com/auth", instructions: "去浏览器" });
					interaction.notify({
						type: "device_code",
						userCode: "ABCD-1234",
						verificationUri: "https://example.com/device",
						intervalSeconds: 5,
					});
					interaction.notify({ type: "info", message: "账号已选" });
					interaction.notify({ type: "progress", message: "换 token" });
					return credential();
				},
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));
		service.start("p", "oauth");
		await vi.waitFor(() => expect(firstMatch(events, "done")).toBeDefined());
		expect(firstMatch(events, "authUrl")).toMatchObject({
			url: "https://example.com/auth",
			instructions: "去浏览器",
		});
		expect(firstMatch(events, "deviceCode")).toMatchObject({ userCode: "ABCD-1234", intervalSeconds: 5 });
		expect(firstMatch(events, "info")?.message).toBe("账号已选");
		expect(firstMatch(events, "progress")?.message).toBe("换 token");
	});

	it("同一提供方同时只允许一条登录", () => {
		const service = new ProviderLoginService({
			runtime: {
				login: () => new Promise<Credential>(() => undefined),
			},
		});
		service.start("p", "oauth");
		expect(() => service.start("p", "oauth")).toThrow(ProviderLoginBusyError);
		// 换一个提供方不受影响
		expect(service.start("q", "oauth").loginId.length).toBeGreaterThan(0);
	});

	it("应答为 null 表示放弃，整条登录中止", async () => {
		const service = new ProviderLoginService({
			runtime: {
				login: async (_providerId, _type, interaction) => {
					await interaction.prompt({ type: "text", message: "账号" });
					return credential();
				},
			},
		});
		const events: ProviderLoginUpdate[] = [];
		service.subscribe((update) => events.push(update));
		const { loginId } = service.start("p", "oauth");
		await vi.waitFor(() => expect(firstMatch(events, "prompt")).toBeDefined());
		const promptId = firstMatch(events, "prompt")?.prompt.promptId ?? "";
		expect(service.respond(loginId, promptId, null)).toBe(false);
		await vi.waitFor(() => expect(firstMatch(events, "cancelled")).toBeDefined());
	});
});
