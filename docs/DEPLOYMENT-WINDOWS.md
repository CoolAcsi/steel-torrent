# Steel Tide — 阿里云 Windows 服务器部署手册

## 版本管理与发布（GitHub）

- 远程仓库：`git@github.com:CoolAcsi/steel-torrent.git`（<https://github.com/CoolAcsi/steel-torrent>）
- 主分支 `main`，每个上线版本打一个标签（当前 `v8`）。改代码后：

```bash
git add -A && git commit -m "说明这次改了什么"
git tag v9 && git push origin main --tags
```

- 从仓库出 Windows 部署包（源码 + 运行时依赖 `ws`，不含 test/docs/poc 与本地工具配置）：

```bash
npm ci --omit=dev=false   # 需要 node_modules/ws 存在
./scripts/make-win-bundle.sh /tmp/steel-tide-v9.zip
```

- 把包传到服务器后，用本手册"版本升级"里的 `install.ps1` 命令升级即可。
- 仓库里不入库：`node_modules/`、`.env`、`.DS_Store`，以及 `.agents` / `.aiden` / `.coco` / `.hermes` / `.trae*` / `.claude` / `agentbuddy*.yaml` 这些本地开发工具配置。

这是 `docs/DEPLOYMENT.md`（Linux + systemd + Caddy/nginx）的 Windows 落地版本，并在 v2 上完成过一次真实升级。
游戏本身不需要改代码：它只是一个 Node 进程，服务页面、脚本和 `/ws` WebSocket。Windows 上换掉的只是
"怎么让进程活着"和"谁来终止 TLS"。

## 与 Linux 方案的对应关系

| Linux 文档里的做法 | Windows 上的做法 |
| --- | --- |
| `systemd` 单元 `steel-tide.service` | 计划任务 `SteelTide`（SYSTEM 身份、开机启动） |
| `useradd --system steeltide` 降权运行 | 目前用 SYSTEM；要降权可改 `LOCAL SERVICE` + 目录 ACL（见"加固"） |
| `journalctl -u steel-tide -f` | `Get-Content C:\steel-tide\app\logs\steel-tide-*.log -Tail 20 -Wait` |
| `systemctl restart steel-tide` | `Stop-ScheduledTask SteelTide; Start-ScheduledTask SteelTide` |
| 进程崩溃后 systemd 拉起 | 项目自带的 `run.ps1` 守护循环，退出后 2 秒重启；计划任务再兜底 |
| Caddy / nginx 终止 TLS | 同左（Caddy 有 Windows 原生 exe，或 IIS + ARR）；当前直接暴露端口 |
| `cp -r . /opt/steel-tide` | `Expand-Archive` 到 `C:\steel-tide\app` |

## 本机部署参数（v2 现状）

| 项 | 值 |
| --- | --- |
| 实例 | `iZer7hfbnh8h8qZ`（Windows Server 2025，build 26100，AMD64） |
| 公网 IP | `101.132.126.224` |
| 访问地址 | <http://101.132.126.224:3000> |
| 构建号 | `1d068d84917d`（v1 `9b77644b4354` → … → v6 `111c095011a9` → v7 `95b140418e63` → v8） |
| 程序目录 | `C:\steel-tide\app` |
| Node 运行时 | 系统已装 `C:\Program Files\nodejs\node.exe`，v24.19.0 |
| 守护脚本 | `C:\steel-tide\run.ps1`（项目自带，退出即重启 + 日志按天轮转） |
| 日志 | `C:\steel-tide\app\logs\steel-tide-YYYYMMDD.log`（保留 14 天） |
| 计划任务 | `SteelTide`（AtStartup，SYSTEM，`powershell.exe -File run.ps1`） |
| 防火墙规则 | `Steel Tide 3000`（入站 TCP 3000，Domain/Private/Public） |

部署通道：Workbench 网页终端执行 PowerShell，不落地任何 AK/SK；安装包通过临时 CDN 链接下发到服务器。

## 目录结构

```
C:\steel-tide\
├── app\                  # 程序文件（server.js、game\、public\、deploy\、node_modules\ws、.env）
│   └── logs\             # steel-tide-YYYYMMDD.log，按天一个文件
├── run.ps1               # 守护脚本：跑 node → 输出到日志 → 退出后 2 秒重启 → 清理 14 天前的日志
├── install.ps1           # 安装/升级脚本
├── verify.ps1            # 校验脚本
├── uninstall.ps1         # 卸载脚本
└── app8.zip              # 最近一次部署包（v8；app2–app7 为历史版本）
```

进程工作目录是 `C:\steel-tide\app`，由 `run.ps1` 以 `node --env-file=.env server.js` 启动，
所以**配置只认 `.env`**，不依赖系统环境变量。

## 安装

``` powershell
# 首次安装（Node 已装则传 NodeDir/NodeVersion 跳过下载）
powershell -ExecutionPolicy Bypass -File C:\steel-tide\install.ps1 `
  -AppZip C:\steel-tide\app.zip `
  -NodeDir "C:\Program Files\nodejs" -NodeVersion v24.19.0 `
  -Port 3000 -PublicUrl http://101.132.126.224:3000
```

脚本幂等：停任务 → 替换 `app\`（**保留 `.env`**）→ 重建任务 → 等 `/healthz`。

若机器上没有 Node，去掉 `-NodeDir/-NodeVersion`，脚本会从 npmmirror 拉 `node-v22.23.5-win-x64.zip`
（失败回退 nodejs.org），解压到 `C:\steel-tide\node`。部署包内已带 `node_modules\ws`，
服务器**无需联网 npm install**。

## 版本升级（最近一次为 v7 → v8）

同一套脚本已升级过两次（v1 → v2 → v3），流程不变：

``` powershell
# 1. 传包到服务器（本次用 CDN 链接；长期建议放内网或 OSS）
iwr https://aka.doubaocdn.com/s/7UbaG6zn11 -OutFile C:\steel-tide\app8.zip -UseBasicParsing

# 2. 幂等升级：不传 -PublicUrl 即保留旧 .env
powershell -ExecutionPolicy Bypass -File C:\steel-tide\install.ps1 `
  -AppZip C:\steel-tide\app8.zip -NodeDir "C:\Program Files\nodejs" -NodeVersion v24.19.0 -Port 3000

# 3. 复查
powershell -ExecutionPolicy Bypass -File C:\steel-tide\verify.ps1 -Port 3000
```

要点（两次升级的实测经验）：

- 中断约 5 秒（停任务 → 换文件 → 起进程）。内存态对局会丢失，玩家回菜单重开。
- 客户端与服务端协议强绑定：v3 起把军队变成道路实体并新增技能 / 超级武器 / 补给箱，
  旧页面必须刷新，否则会因协议不匹配触发重连重载；v5 换了 3D 引擎，v6 增加暂停/倍速，v7/v8 改自动出兵，都要求刷新。
- 构建号会变，所有 `/v/<build>/...` 资源 URL 一次性换新，已打开页面会提示刷新。
- `run.ps1` 会被安装脚本重新覆盖到 `C:\steel-tide\run.ps1`；计划任务保持
  `powershell.exe -File run.ps1 -AppDir <app> -NodeExe <node>`，不需要手工改。
- `.env` 全程未改动；依赖仍只有 `ws`，服务器没有联网 npm。
- 回滚：把上一版的 zip（`app7.zip` = v7）用同样命令再跑一次即可，`.env` 不受影响。

## 配置（`C:\steel-tide\app\.env`）

v2 使用的环境变量与 v1 完全一致，升级时无需改动：

``` ini
NODE_ENV=production
HOST=0.0.0.0            # 直连暴露；前面加反向代理时改 127.0.0.1
PORT=3000
PUBLIC_URL=http://101.132.126.224:3000
ALLOWED_ORIGINS=
TRUST_PROXY=0           # 有反向代理时改 1
MAX_CLIENTS=1000
MAX_ROOMS=200
MAX_CONN_PER_IP=20
RECONNECT_GRACE_MS=60000
LOG_LEVEL=info
```

两条必须记住的规则：

- **`PUBLIC_URL` 会被加入 WebSocket 来源白名单**（`server.js:34`），生产模式只认这个 origin。
  用 `http://127.0.0.1:3000` 打开页面会一直"重连中"——这是预期行为。换域名/换 IP 必须同步改它。
- `PUBLIC_URL` 为 `https://` 时才下发 HSTS。
- 改 `.env` 后要重启任务（`run.ps1` 只在启动时读一次）。

## 运维命令

``` powershell
# 状态
Get-ScheduledTask SteelTide | Select State
Get-NetTCPConnection -LocalPort 3000 -State Listen
Invoke-RestMethod http://127.0.0.1:3000/healthz        # {"status":"ok","build":...}

# 停 / 起 / 重启（改完 .env 用这个）
Stop-ScheduledTask SteelTide; Start-ScheduledTask SteelTide

# 日志（JSON 一行一事件：listening / room_create / match_start / ws_reject / wrapper_restart）
Get-Content C:\steel-tide\app\logs\steel-tide-*.log -Tail 20 -Wait

# 选定某天的日志
Get-Content "C:\steel-tide\app\logs\steel-tide-$(Get-Date -f yyyyMMdd).log" -Tail 50

# 完整校验（任务/端口/healthz/CSP/同源 101/异源 403）
powershell -ExecutionPolicy Bypass -File C:\steel-tide\verify.ps1 -Port 3000

# 卸载（保留文件），或 -RemoveFiles 一并删除
powershell -ExecutionPolicy Bypass -File C:\steel-tide\uninstall.ps1
```

日志轮转由 `run.ps1` 自己完成：每次（重）启动前删除 14 天前的 `steel-tide-*.log`，不需要额外计划任务。

## 验收结果（v8，构建 1d068d84917d）

上线前开发机测试全绿：

```
模拟（编成/城防/超武/全局技能/补给箱/统计/确定性）、路由 21 组（7615 组城市对）、时钟 10 组
自动出兵 18 组：手动与自动订单共存、并行路线、a→b→c 接力、replace 覆盖、按路段取消、
  全局比例 setAutoPct、跨重连保持
i18n 167 引用键 ok、内置引擎 40 模块 101 条 import、首屏 21 个文件 456 KB / 122 KB brotli
网络：lan 4ms / 宽带 52ms / 移动 213ms / 丢包抖动 192ms，gaps 0、checksum 0
暂停倍速：1x=1.03、2x=2.02、0.5x=0.49、1.5x=1.52、0.75x=0.73
指令幂等、房间选项、desync 恢复、断线 1317ms 回座、12 局 36 人并发、限流 ok
```

服务器与外部：

```
verify.ps1 六项 PASS（task Running / 0.0.0.0:3000 / healthz build 1d068d84917d /
  index CSP 200 / 同源 ws 101 / 异源 403）
GET /                            200（17261 bytes）
GET /v/1d068d84917d/js/game.js   200（108842 bytes）
GET /v/1d068d84917d/style.css    200（35511 bytes）
```

浏览器实操（建房 `QNEM` + 一名简单 AI）：

- HUD 新增"集结/进攻"按钮，点击后进入"选择目标中"，工具栏右侧出现"确认出兵（N目标）"。
- 点击敌方城市可选中（蓝色选中环 + "×"移出标记），按钮变为"确认出兵（1目标）"。
- 并行路线、接力路线、均分兵力、按路段取消的实际效果由 18 组自动化用例覆盖；
  界面上"确认出兵"点下去之后的路线绘制我在这一局里没来得及逐帧确认（AI 扩张太快）。

补充：v8 改动了 `server.js` / `game/sim.js` / `public/js/route.js` 与渲染层，
新增了自动派兵的多路线协议字段（`pairs` / `segFrom` / `segTo` / `setPct`），
但环境变量集合与 v6/v7 完全一致，`.env` 无需改动。

## 版本记录

| 版本 | 构建号 | 主要变化 |
| --- | --- | --- |
| v1 | `9b77644b4354` | 首个上线版本（房间 / AI / 中英双语） |
| v2 | `1124a759e2fa` | 快捷键面板、模拟与文案调整 |
| v3 | `3daeb852ca49` | 军队成为道路实体（拦截交战）、城防技能、超级武器、全局技能、补给箱、统计 |
| v4 | `41a865fd4976` | 默认 WebGL2 三维渲染（阴影/深度/自由旋转），Canvas 2D 回退与画质设置 |
| v5 | `728988aa53a3` | 换成内置 three.js 的 3D 世界（城市楼群、景物、路线系统），新增 `route.js`/`scenery.js`；服务端新增路线校验与 `MATCH_SEED`（仅非生产用） |
| v6 | `111c095011a9` | 自动出兵（持续订单）、暂停与 0.5×–2× 倍速（房主控制、模拟时钟）、`clock.js`、3D 材质纹理 |
| v7 | `95b140418e63` | 自动出兵的操作重做：HUD"自动/单次"切换（R）、路线上的"×"取消、拖拽划过多个己方基地同时下令 |
| v8 | `1d068d84917d` | 自动出兵支持多路线并行与均分兵力、a→b→c 接力路线、按路段取消；新增"集结/进攻"（G）多选目标自动规划 |

## 故障排查（Windows 版）

| 现象 | 原因与处理 |
| --- | --- |
| 任务 Running 但页面打不开 | 先 `Invoke-RestMethod http://127.0.0.1:3000/healthz`；本机通 → 防火墙/安全组；不通 → 看当天日志 |
| 改了 `.env` 没生效 | `run.ps1` 只在启动时读配置，必须 `Stop-ScheduledTask` + `Start-ScheduledTask` |
| 页面一直"重连中" | 多数是 `PUBLIC_URL` 与浏览器地址不一致（日志 `ws_reject why=origin`）；或代理没转发 `Upgrade` |
| `ws_reject why=per_ip` | 同一 NAT 后玩家过多 → 提高 `MAX_CONN_PER_IP`；全员命中则是 `TRUST_PROXY` 与链路不匹配 |
| 端口冲突 | `Get-NetTCPConnection -LocalPort 3000`；换端口重跑安装脚本（会同步加防火墙规则） |
| 计划任务启动失败 | `Get-ScheduledTaskInfo SteelTide` 看 `LastTaskResult`；常见是 `run.ps1` 路径/参数引号问题 |
| 进程反复重启 | 日志里会出现 `wrapper_restart exitCode=N`；按退出码排查（常见是 `.env` 写错或端口占用） |
| 日志不明显 | `LOG_LEVEL=debug` 后重启；玩家名、地址、token、消息内容按设计从不落日志 |

## 限制与后续

1. **只能跑一个实例。** 房间状态在进程内存里，多实例或负载均衡会拆散玩家。
2. **当前没有 TLS。** `http://IP:3000` 直接暴露在公网。上 HTTPS 的路径：域名 A 记录指向
   `101.132.126.224` → 装 Caddy（Windows exe；或用项目自带的 `deploy\windows\setup-iis.ps1` + IIS/ARR）
   → `PUBLIC_URL=https://域名`、`HOST=127.0.0.1`、`TRUST_PROXY=1` → 安全组撤掉 3000，只留 80/443。
3. **安全组收敛。** 3000 目前对全网可达（已实测）。只想给固定人群玩就把授权对象收窄到具体 IP 段。
4. **重启存活未验证。** 计划任务是 AtStartup + SYSTEM，设计上开机即起，但没实际重启过机器
   （重启会中断对局，需你确认后另做）。
5. **降权可选。** 现在以 SYSTEM 运行；更稳妥是建本地服务账号，授予 `C:\steel-tide` 读、`app\logs` 写，
   再用该账号注册计划任务。
6. **邀请文案。** 邀请区仍写"邀请同一网络的玩家"，但链接其实是公网地址（v2 未改，
   `public/js/locales/zh-CN.js:51`），公网场景下容易误解。
7. **项目自带的 Windows 脚本未启用。** v2 起项目带了 `setup-iis.ps1`、`web.config`、以及它自己的
   `install.ps1`（LOCAL SERVICE + `npm ci`）。本次沿用已验证的安装脚本 + 项目自带 `run.ps1`，
   没有切到 IIS 路线；将来要走 IIS 反代时再单独评估。
