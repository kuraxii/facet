import { describe, expect, it } from "vitest";
import { isAllowedBrowserUrl, normalizeBrowserUrl } from "./browser-url.ts";

describe("browser-url", () => {
	it("识别并拦截非 http/https 危险协议", () => {
		expect(isAllowedBrowserUrl("https://example.com")).toBe(true);
		expect(isAllowedBrowserUrl("http://localhost:5173")).toBe(true);
		expect(isAllowedBrowserUrl("about:blank")).toBe(true);
		expect(isAllowedBrowserUrl("file:///etc/passwd")).toBe(false);
		expect(isAllowedBrowserUrl("javascript:alert(1)")).toBe(false);
		expect(isAllowedBrowserUrl("data:text/html,hi")).toBe(false);
		expect(normalizeBrowserUrl("file:///C:/Windows")).toBeUndefined();
		expect(normalizeBrowserUrl("javascript:void(0)")).toBeUndefined();
		expect(normalizeBrowserUrl("javascript:evil.com")).toBeUndefined();
	});

	it("自动补全本地端口、局域网地址、域名与搜索词", () => {
		expect(normalizeBrowserUrl("5173")).toBe("http://localhost:5173");
		expect(normalizeBrowserUrl(":3000/app")).toBe("http://localhost:3000/app");
		expect(normalizeBrowserUrl("localhost:8080/health")).toBe("http://localhost:8080/health");
		expect(normalizeBrowserUrl("127.0.0.1:4173")).toBe("http://127.0.0.1:4173");
		expect(normalizeBrowserUrl("192.168.1.20:3000")).toBe("http://192.168.1.20:3000");
		expect(normalizeBrowserUrl("electronjs.org/docs")).toBe("https://electronjs.org/docs");
		expect(normalizeBrowserUrl("example.com:8443/api")).toBe("https://example.com:8443/api");
		expect(normalizeBrowserUrl("electron WebContentsView")).toBe(
			"https://www.google.com/search?q=electron%20WebContentsView",
		);
		expect(normalizeBrowserUrl("   ")).toBeUndefined();
	});
});
