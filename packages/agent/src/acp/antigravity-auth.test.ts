import { describe, expect, it } from "vitest";
import {
	ANTIGRAVITY_AUTH_STDOUT_PREFIX,
	ANTIGRAVITY_CODE_REDIRECT_URI,
	extractAntigravityAuthUrl,
	parseAntigravityAuthUrl,
	prepareAntigravityAuthEnv,
} from "./antigravity-auth.ts";

const LOOPBACK_URL =
	"https://accounts.google.com/o/oauth2/v2/auth?client_id=123&redirect_uri=http%3A%2F%2F127.0.0.1%3A43123%2F&response_type=code&state=abc123";

const CODE_LOGIN_URL = `https://accounts.google.com/o/oauth2/auth?client_id=123&redirect_uri=${encodeURIComponent(ANTIGRAVITY_CODE_REDIRECT_URI)}&response_type=code&state=abc123`;

describe("Antigravity OAuth 认证辅助", () => {
	it("校验合法的 Google OAuth 授权链接", () => {
		expect(parseAntigravityAuthUrl(LOOPBACK_URL)).toBe(LOOPBACK_URL);
		expect(parseAntigravityAuthUrl(CODE_LOGIN_URL)).toBe(CODE_LOGIN_URL);
		expect(parseAntigravityAuthUrl("https://evil.example/auth?state=1")).toBeUndefined();
		expect(
			parseAntigravityAuthUrl(
				"https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=https%3A%2F%2Fevil.com%2F&response_type=code&state=1",
			),
		).toBeUndefined();
		expect(
			parseAntigravityAuthUrl(
				"https://accounts.google.com/o/oauth2/v2/auth?redirect_uri=http%3A%2F%2F127.0.0.1%3A80%2F&response_type=code&state=1",
			),
		).toBeUndefined();
	});

	it("从 --login 行与 stdout 前缀行提取授权链接", () => {
		expect(extractAntigravityAuthUrl(CODE_LOGIN_URL)).toBe(CODE_LOGIN_URL);
		expect(extractAntigravityAuthUrl(`${ANTIGRAVITY_AUTH_STDOUT_PREFIX}${LOOPBACK_URL}`)).toBe(LOOPBACK_URL);
		expect(extractAntigravityAuthUrl("normal log line")).toBeUndefined();
	});

	it("剥离会干扰 OAuth 凭据源与无头登录的环境变量", () => {
		const env = prepareAntigravityAuthEnv({
			PATH: "C:\\bin",
			GEMINI_API_KEY: "secret",
			GOOGLE_API_KEY: "secret2",
			AGY_ACP_ENABLE_OAUTH: "0",
			DISPLAY: ":0",
			BROWSER: "chrome",
		});
		expect(env.PATH).toBe("C:\\bin");
		expect(env.GEMINI_API_KEY).toBeUndefined();
		expect(env.GOOGLE_API_KEY).toBeUndefined();
		expect(env.AGY_ACP_ENABLE_OAUTH).toBeUndefined();
		expect(env.DISPLAY).toBeUndefined();
		expect(env.BROWSER).toBeUndefined();
	});
});
