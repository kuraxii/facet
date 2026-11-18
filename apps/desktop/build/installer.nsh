; 安装器里需要自己动手的两处：升级与卸载前停掉旧版本留下的 server。
;
; 只有卸载段有钩子：升级时 electron-builder 会先跑旧版本的卸载器，钩子跟着旧版本一起执行，
; 新版本的文件因此不会被还在跑的 server 挡住。server 是独立进程，桌面的退出不会带走它，
; 它占着固定名字的命名管道——不停掉的话，新版本的 server 监听不上同一个管道，界面会连到
; 还在跑的旧代码上。

!macro customUnInstall
  InitPluginsDir
  File "/oname=$PLUGINSDIR\stop-stale-server.ps1" "${BUILD_RESOURCES_DIR}\stop-stale-server.ps1"
  nsExec::ExecToLog 'powershell -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\stop-stale-server.ps1"'
!macroend
