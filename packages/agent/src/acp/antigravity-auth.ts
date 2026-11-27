/**
 * Antigravity ACP 的 Google OAuth 认证辅助模块（对齐 t3code 实现）。
 *
 * 负责校验与提取 `agy acp --login` / `authenticate` 产生的 Google OAuth 授权链接，
 * 并清理会干扰 OAuth 凭据判定的外部环境变量。
 */

/** `agy acp` 在 stdout/stderr 打印授权链接的固定前缀。 */
export const ANTIGRAVITY_AUTH_STDOUT_PREFIX = "Open the following link to authenticate the ACP server: ";

/** `agy acp --login` 使用的官方 OAuth 回调地址。 */
export const ANTIGRAVITY_CODE_REDIRECT_URI = "https://antigravity.google/oauth-callback";

const MAX_AUTHORIZATION_URL_LENGTH = 16_384;

/** 会干扰 `agy acp` `oauth-personal` 凭据源判定的外部环境变量。 */
const STRIPPED_ANTIGRAVITY_ENV_KEYS = [
	"GEMINI_API_KEY",
	"GOOGLE_API_KEY",
	"GOOGLE_APPLICATION_CREDENTIALS",
	"GOOGLE_CLOUD_PROJECT",
	"GOOGLE_CLOUD_LOCATION",
	"GOOGLE_CLOUD_QUOTA_PROJECT",
	"GOOGLE_GENAI_USE_VERTEXAI",
	"GCLOUD_PROJECT",
	"CLOUDSDK_CORE_PROJECT",
	"AGY_ACP_CCPA_PROJECT",
	"AGY_ACP_ENABLE_OAUTH",
	"AGY_CLI_DISABLE_AUTO_UPDATE",
	"BROWSER",
	"DISPLAY",
	"WAYLAND_DISPLAY",
] as const;

/** 构造 `agy acp` 认证与会话所需的干净子进程环境变量。 */
export function prepareAntigravityAuthEnv(baseEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
	const next: NodeJS.ProcessEnv = { ...baseEnv };
	for (const key of STRIPPED_ANTIGRAVITY_ENV_KEYS) {
		delete next[key];
	}
	return next;
}

/**
 * 校验从 `agy` 捕获的 Google OAuth 授权链接是否合法。
 *
 * 支持 `agy acp --login` 的 `https://antigravity.google/oauth-callback` 授权码模式，
 * 以及 `http://127.0.0.1:<port>/`（端口 >= 1024）的本机环回模式。
 */
export function parseAntigravityAuthUrl(rawUrl: string): string | undefined {
	const trimmed = rawUrl.trim();
	if (trimmed.length === 0 || trimmed.length > MAX_AUTHORIZATION_URL_LENGTH || /\s/.test(trimmed)) {
		return undefined;
	}
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		return undefined;
	}
	const state = parsed.searchParams.get("state");
	const redirectUri = parsed.searchParams.get("redirect_uri");
	const isLoopback =
		parsed.pathname === "/o/oauth2/v2/auth" &&
		redirectUri !== null &&
		/^http:\/\/127\.0\.0\.1:[1-9][0-9]{0,4}\/$/.test(redirectUri);
	const isCodeLogin =
		(parsed.pathname === "/o/oauth2/auth" || parsed.pathname === "/o/oauth2/v2/auth") &&
		redirectUri === ANTIGRAVITY_CODE_REDIRECT_URI;
	if (
		parsed.origin !== "https://accounts.google.com" ||
		(!isLoopback && !isCodeLogin) ||
		parsed.username !== "" ||
		parsed.password !== "" ||
		parsed.hash !== "" ||
		parsed.searchParams.getAll("state").length !== 1 ||
		parsed.searchParams.getAll("redirect_uri").length !== 1 ||
		parsed.searchParams.getAll("response_type").length !== 1 ||
		parsed.searchParams.get("response_type") !== "code" ||
		state === null ||
		state.length === 0 ||
		state.length > 512 ||
		/\s/.test(state)
	) {
		return undefined;
	}
	if (isLoopback && redirectUri !== null) {
		try {
			if (Number(new URL(redirectUri).port) < 1024) {
				return undefined;
			}
		} catch {
			return undefined;
		}
	}
	return parsed.toString();
}

/** 从 `agy` 子进程的一行输出中提取合法的 Google OAuth 授权链接。 */
export function extractAntigravityAuthUrl(line: string): string | undefined {
	const trimmed = line.trim();
	if (trimmed.startsWith("https://accounts.google.com/")) {
		return parseAntigravityAuthUrl(trimmed);
	}
	const prefixIndex = trimmed.indexOf(ANTIGRAVITY_AUTH_STDOUT_PREFIX);
	if (prefixIndex >= 0) {
		const candidate = trimmed.slice(prefixIndex + ANTIGRAVITY_AUTH_STDOUT_PREFIX.length).trim();
		return parseAntigravityAuthUrl(candidate);
	}
	return undefined;
}
