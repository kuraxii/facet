import { describe, expect, it } from "vitest";
import { extractLangToken, PLAIN, resolveCodeLang } from "./code-lang.ts";

describe("围栏语言标记", () => {
	it("取第一段并去掉属性与冒号之后的内容", () => {
		expect(extractLangToken("python")).toBe("python");
		expect(extractLangToken("  PYTHON  ")).toBe("python");
		expect(extractLangToken("python {.line-numbers}")).toBe("python");
		expect(extractLangToken("python{.line-numbers}")).toBe("python");
		expect(extractLangToken("ts:app.ts")).toBe("ts");
		expect(extractLangToken("python title=x")).toBe("python");
		expect(extractLangToken("")).toBe("");
		expect(extractLangToken(null)).toBe("");
		expect(extractLangToken(undefined)).toBe("");
	});

	it("别名映射到 shiki 语言 id", () => {
		expect(resolveCodeLang("bash")).toBe("shellscript");
		expect(resolveCodeLang("sh")).toBe("shellscript");
		expect(resolveCodeLang("py")).toBe("python");
		expect(resolveCodeLang("rs")).toBe("rust");
		expect(resolveCodeLang("c++")).toBe("cpp");
		expect(resolveCodeLang("c#")).toBe("csharp");
		expect(resolveCodeLang("yml")).toBe("yaml");
		expect(resolveCodeLang("ts")).toBe("typescript");
	});

	it("半截词与不认识的标记按纯文本处理", () => {
		expect(resolveCodeLang("pyt")).toBe(PLAIN);
		expect(resolveCodeLang("rus")).toBe(PLAIN);
		expect(resolveCodeLang("notalanguage")).toBe(PLAIN);
		expect(resolveCodeLang("")).toBe(PLAIN);
		expect(resolveCodeLang(undefined)).toBe(PLAIN);
		expect(resolveCodeLang("text")).toBe(PLAIN);
	});

	it("同一写法与规范名解析到同一个 id", () => {
		expect(resolveCodeLang("sh")).toBe(resolveCodeLang("shellscript"));
		expect(resolveCodeLang("ts")).toBe(resolveCodeLang("typescript"));
	});
});
