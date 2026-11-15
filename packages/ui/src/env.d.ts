/* CSS Modules 的默认导出：键是源文件里的类名。 */
declare module "*.module.css" {
	const classes: { readonly [key: string]: string };
	export default classes;
}
