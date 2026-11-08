/**
 * 跨边界的类型契约。
 *
 * 设备侧、端点层与界面层共用这里的结构，因此包内只允许类型与常量，
 * 不引入任何运行时依赖。任何一端都不得在本包之外另立同名结构。
 */
export type * from "./approval.ts";
export type * from "./content.ts";
export type * from "./event.ts";
export type * from "./message.ts";
export type * from "./model.ts";
export type * from "./request.ts";
export type * from "./session.ts";
export * from "./wire.ts";
