/**
 * 界面包的测试环境。
 *
 * 输入区换成富文本之后，测试要在真实 DOM 上跑：编辑器只有挂进 contenteditable 才谈得上
 * 输入、组合与选区，服务端渲染那套静态 HTML 断言覆盖不到这些。jsdom 只承担浏览器职责，
 * 不模拟真实布局。
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		environment: "jsdom",
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["./vitest.setup.ts"],
	},
});
