/**
 * 展开与收起的指示箭头。
 *
 * 收起时朝下、展开时朝上，两态各用一个 lucide 图标；用图标而不是画边框，箭头两臂的粗细与
 * 长度都跟界面其它图标一致。
 */
import { ChevronDown, ChevronUp } from "lucide-react";

/** 展开箭头。 */
export function ChevronIcon({ isOpen, size = 12 }: { isOpen: boolean; size?: number }) {
	return isOpen ? <ChevronUp size={size} strokeWidth={1.5} /> : <ChevronDown size={size} strokeWidth={1.5} />;
}
