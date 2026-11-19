#!/usr/bin/env bash
# 从本机的完整 Maple Mono CN 生成界面用的 woff2。
#
# 只留 Latin 与 Latin 扩展、标点与符号、制表符与框线、以及 Nerd Font 图标（私有区）；
# 汉字与全角标点全部去掉，等宽语境里的汉字交给 `--font-mono` 栈第二位的界面中文字体。
# 只出 400 与 600 两档：界面里没有把等宽文字设成 500 的地方，加粗按 600 取。
#
# 字体来自 Maple Mono NL NF CN v7.9，OFL-1.1，许可文本随字体一起放在
# packages/ui/src/assets/fonts/LICENSE.txt。
#
# 用法：scripts/build-fonts.sh [字体目录]，缺省读 ~/.fonts。
set -euo pipefail

source_dir="${1:-$HOME/.fonts}"
target_dir="$(dirname "$0")/../packages/ui/src/assets/fonts"

# 保留的码位：Basic Latin 与 Latin-1/扩展、组合符与修饰符、通用标点、上下标、货币、
# 类字母符号、箭头、数学与杂项技术符号、框线、块元素、几何图形、杂项符号与 Dingbats、
# 变体选择符，以及 Nerd Font 图标所在的私有区
unicodes="U+0000-024F,U+0300-036F,U+02B0-02FF,U+2000-206F,U+2070-209F,U+20A0-20CF,U+2100-214F,U+2190-21FF,U+2200-23FF,U+2500-257F,U+2580-259F,U+25A0-25FF,U+2600-27BF,U+FE00-FE0F,U+E000-F8FF"

mkdir -p "$target_dir"
for pair in Regular:400 SemiBold:600; do
	weight="${pair%%:*}"
	name="${pair##*:}"
	uvx --with brotli --from fonttools pyftsubset \
		"$source_dir/MapleMonoNL-NF-CN-$weight.ttf" \
		--unicodes="$unicodes" \
		--layout-features='*' \
		--flavor=woff2 \
		--output-file="$target_dir/maple-mono-cn-$name.woff2"
done
echo "字体已生成到 $target_dir"
