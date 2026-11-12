/**
 * 装桥。
 *
 * 单独放一个模块并在入口最先导入：界面模块一加载就会读 `window.facet`，必须在那之前装好。
 */
import { installWebBridge } from "./web-bridge.ts";

if (window.facet === undefined) {
	installWebBridge();
}
