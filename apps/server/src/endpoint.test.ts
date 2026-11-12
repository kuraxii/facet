import { describe, expect, it } from "vitest";
import { isLoopbackAddress } from "./endpoint.ts";

describe("isLoopbackAddress", () => {
	it("IPv4 回环与 IPv6 回环都算", () => {
		expect(isLoopbackAddress("127.0.0.1")).toBe(true);
		expect(isLoopbackAddress("127.10.0.2")).toBe(true);
		expect(isLoopbackAddress("::1")).toBe(true);
		expect(isLoopbackAddress("::ffff:127.0.0.1")).toBe(true);
		expect(isLoopbackAddress("localhost")).toBe(true);
	});

	it("局域网、公网与读不到地址时都不算", () => {
		expect(isLoopbackAddress("192.168.1.20")).toBe(false);
		expect(isLoopbackAddress("::ffff:192.168.1.20")).toBe(false);
		expect(isLoopbackAddress("10.0.0.1")).toBe(false);
		expect(isLoopbackAddress(undefined)).toBe(false);
	});
});
