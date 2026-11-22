/**
 * 随包分发的字体族名。
 *
 * 界面字体是 Inter 加 Noto Sans SC；等宽字体是 Maple Mono 的 Nerd Font 构建的子集，只含
 * Latin、符号、制表符与 Nerd Font 图标，**不含汉字**——等宽语境里的汉字由 `--font-mono` 栈
 * 第二位的界面中文字体接手，所以这里的族名里不带 CN。
 *
 * 设置里的三处字体留空时用的就是这个族名，占位提示也写它：设了代码字体时编辑器与终端跟着走，
 * 提示跟着写那个字体。
 */
export const MONO_FONT_FAMILY = "Maple Mono NF";
