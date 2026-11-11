/**
 * 远程设备的占位数据。
 *
 * 多设备与远端读取尚未接入，这里先给出设备条与项目过滤器需要的形状。
 */
import type { SidebarHost } from "@facet/ui";

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
			{ cwd: "/srv/gateway", name: "gateway", host: "dev-box", sessionCount: 2, isPlaceholder: true },
			{ cwd: "/srv/ml-train", name: "ml-train", host: "dev-box", sessionCount: 1, isPlaceholder: true },
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
