# 停掉已装版本留下的 server：升级与卸载前由 NSIS 安装器调用。
#
# server 是随包的独立 Node 进程，桌面的退出不会带走它，它还占着固定名字的命名管道。
# 不停掉的话，新版本的 server 监听不上同一个管道，界面会连到还在跑的旧代码上；
# 卸载时它还会挡住 resources\server\bin\node.exe 的删除。
#
# 只按命令行匹配 facet 的 server 入口（server.mjs 与 pty-server.mjs）：安装目录里那份
# node.exe 与用户自己的 Node 进程都不动。

$servers = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" |
  Where-Object { $_.CommandLine -like '*\resources\server\lib\*server.mjs*' }
foreach ($server in $servers) {
  Stop-Process -Id $server.ProcessId -Force -ErrorAction SilentlyContinue
}
