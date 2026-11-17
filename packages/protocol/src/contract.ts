/**
 * 请求与动作的契约。
 *
 * 权限档与参数校验都由 `schema/contracts.ts` 的 Schema 在构建期生成，落在
 * `generated/checks.ts`；这里只放生成物与网关共用的形状，运行时不依赖任何校验库。
 */

/**
 * 一个方法或动作要求的权限档。
 *
 * - public：任何档位都能调用
 * - write：只读档不能调用
 * - admin：只有能改主机配置的连接能调用，浏览器入口一律不放行
 */
export type AuthTier = "public" | "write" | "admin";

/** 生成物里一条请求方法的记录。 */
export interface RequestContract {
	/** 需要的权限档 */
	readonly auth: AuthTier;
	/** 参数校验，结构合法时返回 true */
	readonly check: (value: unknown) => boolean;
}

/** 生成物里一条客户端可派发动作的记录。 */
export interface DispatchContract {
	/** 需要的权限档 */
	readonly auth: AuthTier;
	/** 整条动作的校验，含 type 字段，主机内部事件会被挡下 */
	readonly check: (value: unknown) => boolean;
}
