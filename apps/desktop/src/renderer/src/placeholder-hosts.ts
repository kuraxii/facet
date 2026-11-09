/**
 * 远程主机的占位数据。
 *
 * 多主机与远端读取尚未接入，这里先给出界面需要的形状。删掉这一份即可回到只有本机的状态。
 */
import type { SidebarHost } from "@facet/ui";

const now = Date.now();

/** 距今若干分钟的时间戳。 */
function minutesAgo(minutes: number): number {
	return now - minutes * 60_000;
}

export const PLACEHOLDER_HOSTS: readonly SidebarHost[] = [
	{
		id: "dev-box",
		name: "dev-box",
		detail: "zhu@10.0.2.15",
		state: "connected",
		isLocal: false,
		latencyMs: 28,
		isPlaceholder: true,
		projects: [
			{
				cwd: "/srv/gateway",
				name: "gateway",
				isPlaceholder: true,
				sessions: [
					{
						path: "placeholder://dev-box/gateway/stress",
						title: "压测脚本调整",
						modified: minutesAgo(8),
						messageCount: 34,
						isRunning: false,
						project: "gateway",
						host: "dev-box",
						isPlaceholder: true,
					},
					{
						path: "placeholder://dev-box/gateway/rating",
						title: "限流策略评审",
						modified: minutesAgo(60 * 30),
						messageCount: 21,
						isRunning: false,
						project: "gateway",
						host: "dev-box",
						isPlaceholder: true,
					},
				],
			},
			{
				cwd: "/srv/ml-train",
				name: "ml-train",
				isPlaceholder: true,
				sessions: [
					{
						path: "placeholder://dev-box/ml-train/profiling",
						title: "训练脚本排查",
						modified: minutesAgo(60 * 52),
						messageCount: 18,
						isRunning: false,
						project: "ml-train",
						host: "dev-box",
						isPlaceholder: true,
					},
				],
			},
		],
	},
	{
		id: "staging",
		name: "staging",
		detail: "zhu@staging.lan",
		state: "connecting",
		isLocal: false,
		isPlaceholder: true,
		projects: [],
	},
	{
		id: "gpu-box",
		name: "gpu-box",
		detail: "",
		state: "offline",
		isLocal: false,
		lastSeen: "昨天 16:20",
		isPlaceholder: true,
		projects: [],
	},
];
