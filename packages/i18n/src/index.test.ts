import { describe, expect, it } from "vitest";
import {
	createI18n,
	normalizeSystemLanguage,
	readLanguageSetting,
	resolveLanguage,
	translate,
} from "./index.ts";

describe("normalizeSystemLanguage", () => {
	it("中文区域统一落到 zh-CN", () => {
		expect(normalizeSystemLanguage("zh")).toBe("zh-CN");
		expect(normalizeSystemLanguage("zh_CN")).toBe("zh-CN");
		expect(normalizeSystemLanguage("zh-Hans-CN")).toBe("zh-CN");
		expect(normalizeSystemLanguage("zh-TW")).toBe("zh-CN");
	});

	it("英文区域落到 en", () => {
		expect(normalizeSystemLanguage("en")).toBe("en");
		expect(normalizeSystemLanguage("en_US")).toBe("en");
	});

	it("其它语言回退到 en", () => {
		expect(normalizeSystemLanguage("ja-JP")).toBe("en");
		expect(normalizeSystemLanguage("")).toBe("en");
	});
});

describe("resolveLanguage", () => {
	it("明确的用户选择优先于系统语言", () => {
		expect(resolveLanguage("en", "zh-CN")).toBe("en");
		expect(resolveLanguage("zh-CN", "en-US")).toBe("zh-CN");
	});

	it("auto 按系统语言解析", () => {
		expect(resolveLanguage("auto", "zh-CN")).toBe("zh-CN");
		expect(resolveLanguage(undefined, "en-US")).toBe("en");
	});
});

describe("readLanguageSetting", () => {
	it("只接受已知取值", () => {
		expect(readLanguageSetting("auto")).toBe("auto");
		expect(readLanguageSetting("en")).toBe("en");
		expect(readLanguageSetting("zh-CN")).toBe("zh-CN");
		expect(readLanguageSetting("fr")).toBeUndefined();
		expect(readLanguageSetting(1)).toBeUndefined();
	});
});

describe("createI18n", () => {
	it("按语言返回对应译文并支持插值", () => {
		const en = createI18n("en");
		const zh = createI18n("zh-CN");
		expect(en.t("settings.language")).toBe("Language");
		expect(zh.t("settings.language")).toBe("语言");
		expect(en.t("dialog.quit.detail", { count: 2 })).toContain("2 sessions");
		expect(zh.t("dialog.quit.detail", { count: 2 })).toContain("2 个会话");
	});

	it("未知语言回退到 en", () => {
		expect(createI18n("ja").t("settings.language")).toBe("Language");
	});
});

describe("translate", () => {
	it("保留复数基名并返回字符串", () => {
		const t = translate(createI18n("en"));
		expect(t("panel.filesCount", { count: 2 })).toBe("2 files");
		expect(t("panel.filesCount", { count: 1 })).toBe("1 file");
	});

	it("同一键与选项只问一次 i18next，换语言后重取", async () => {
		const instance = createI18n("en");
		const t = translate(instance);
		let asked = 0;
		const original = instance.t.bind(instance);
		// 只换一层计数器：包住实例自身的 t，其余行为不变
		(instance as unknown as { t: (key: string, options?: Record<string, unknown>) => string }).t = (
			key,
			options,
		) => {
			asked += 1;
			return String(original(key as never, options as never));
		};
		expect(t("settings.language")).toBe("Language");
		expect(t("settings.language")).toBe("Language");
		expect(asked).toBe(1);
		// 插值不同就是不同的条目，不能共用结果
		expect(t("panel.filesCount", { count: 2 })).toBe("2 files");
		expect(t("panel.filesCount", { count: 1 })).toBe("1 file");
		expect(asked).toBe(3);
		await instance.changeLanguage("zh-CN");
		expect(t("settings.language")).toBe("语言");
	});
});
