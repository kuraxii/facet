/* CSS Modules 的默认导出：键是源文件里的类名。 */
declare module "*.module.css" {
	const classes: { readonly [key: string]: string };
	export default classes;
}

/**
 * 构建期注入的最小环境描述。
 *
 * 只声明本包用到的 `DEV`：它由打包器静态替换，生产构建里相关分支会被整段去掉。
 * 不引入整套 `vite/client` 类型，免得 UI 包被绑死在某个打包器上。
 */
interface ImportMeta {
	/** 是否为开发构建 */
	readonly env: { readonly DEV: boolean };
}
