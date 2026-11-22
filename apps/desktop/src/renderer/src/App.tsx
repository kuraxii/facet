/**
 * 界面外壳。
 *
 * 外壳之下只有「当前前台的那台主机」一份工作区：换主机就换一份运行时、整棵子树重挂，
 * 界面里不会同时存在两台主机的节点。后台连着的主机由运行时自己维持，不占 DOM。
 */
import type { LanguageSetting } from "@facet/i18n";
import { I18nProvider, ImagePreviewProvider } from "@facet/ui";
import { useCallback, useEffect, useState } from "react";
import { bridge } from "./bridge.ts";
import { useHostConnection } from "./hooks/useHostConnection.ts";
import { useHosts } from "./hooks/useHosts.ts";
import { useWindowResizeFreeze } from "./hooks/useWindowResizeFreeze.ts";
import { HostRuntimeProvider } from "./host-context.tsx";
import { ToastProvider } from "./toast-provider.tsx";
import { BootScreen } from "./views/boot-screen.tsx";
import { HostWorkspace } from "./views/host-workspace.tsx";

/** 界面外壳参数；语言状态在外层维护，切换语言不重建 AppView 的无关心状态。 */
interface AppViewProps {
	languageSetting: LanguageSetting;
	onLanguageChange: (setting: LanguageSetting) => void;
}

/** 界面语言从本机桥读入，切换时由主进程或 Web 桥解析实际语言。 */
export function App(): React.JSX.Element {
	const [languageSetting, setLanguageSetting] = useState(bridge.languageSetting);
	const [language, setLanguage] = useState(bridge.language);
	// 界面语言换了就同步到根节点：读屏按它选发音，浏览器按它断行
	useEffect(() => {
		document.documentElement.lang = language;
	}, [language]);
	const changeLanguage = useCallback((setting: LanguageSetting) => {
		setLanguageSetting(setting);
		void bridge
			.setLanguage(setting)
			.then(setLanguage)
			.catch(() => undefined);
	}, []);
	return (
		<I18nProvider language={language}>
			<ToastProvider>
				<ImagePreviewProvider>
					<AppView languageSetting={languageSetting} onLanguageChange={changeLanguage} />
				</ImagePreviewProvider>
			</ToastProvider>
		</I18nProvider>
	);
}

function AppView({ languageSetting, onLanguageChange }: AppViewProps) {
	const hosts = useHosts();
	const host = useHostConnection({ runtime: hosts.runtime, hosts });
	// 拖窗口边缘期间把全仓过渡冻住：否则每一帧的尺寸变化会叠成一条追赶动画
	useWindowResizeFreeze();

	// 连不上与连接中各占一屏，主工作区只在可用之后渲染
	if (host.phase !== "ready") {
		return <BootScreen host={host} />;
	}

	return (
		<HostRuntimeProvider runtime={hosts.runtime}>
			<HostWorkspace
				key={hosts.activeEndpoint}
				host={host}
				languageSetting={languageSetting}
				onLanguageChange={onLanguageChange}
			/>
		</HostRuntimeProvider>
	);
}
