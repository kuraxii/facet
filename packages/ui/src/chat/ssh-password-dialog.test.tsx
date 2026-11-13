import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SshPasswordDialog } from "./SshPasswordDialog.tsx";

function render(host: string, isRetry: boolean): string {
	return renderToStaticMarkup(
		createElement(SshPasswordDialog, { host, isRetry, onSubmit: () => {}, onCancel: () => {} }),
	);
}

describe("SSH 密码框", () => {
	it("标题写清连的是哪台主机，密码框不打明文", () => {
		const html = render("root@10.1.10.152", false);
		expect(html).toContain("连接到 root@10.1.10.152");
		expect(html).toMatch(/type="password"/);
	});

	it("第一次问密码不提示错误", () => {
		expect(render("root@10.1.10.152", false)).not.toContain("密码不对");
	});

	it("上一次被拒时说明密码不对", () => {
		expect(render("root@10.1.10.152", true)).toContain("密码不对");
	});

	it("密码为空时连接按钮置灰", () => {
		expect(render("root@10.1.10.152", false)).toMatch(/class="dialog-primary"[^>]*disabled/);
	});
});
