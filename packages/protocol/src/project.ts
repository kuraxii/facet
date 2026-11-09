/**
 * 项目。
 *
 * 项目由用户手动添加并持久化在设备上；会话目录里扫描出的目录只是添加时的候选。
 */

/** 一个已添加的项目。 */
export interface ProjectInfo {
	/** 标识，由项目目录派生 */
	id: string;
	/** 项目目录，绝对路径 */
	cwd: string;
	/** 自定义名称，缺省时按目录名显示 */
	name?: string;
	/** 添加时间，Unix 毫秒 */
	createdAt: number;
}
