/**
 * 展开与收起的指示箭头。
 *
 * 收起时朝下、展开时朝上，两态各用一个 lucide 图标；用图标而不是画边框，箭头两臂的粗细与
 * 长度都跟界面其它图标一致。
 */
import { ChevronDown, ChevronRight, ChevronUp } from "lucide-react";
import { ICON_SIZE } from "../styles/visual-contract.ts";

/** 展开箭头。 */
export function ChevronIcon({ isOpen, size = ICON_SIZE.sm }: { isOpen: boolean; size?: number }) {
	return isOpen ? <ChevronUp size={size} /> : <ChevronDown size={size} />;
}

/**
 * 树的展开箭头。
 *
 * 收起朝右、展开朝下，与文件树、目录树的一般习惯一致；卡片那种「收起就是往上折」的地方用
 * 上面的 `ChevronIcon`。
 *
 * 用一枚 `ChevronRight` 转 90° 而不是换两个图标：换图标是瞬切，转是过渡，展开的那一刻箭头
 * 跟着内容一起动。`data-open` 让样式表去转，组件不管动画细节。
 */
export function TreeChevron({ isOpen, size = ICON_SIZE.sm }: { isOpen: boolean; size?: number }) {
	return <ChevronRight className="tree-chevron" data-open={isOpen ? "true" : "false"} size={size} />;
}
