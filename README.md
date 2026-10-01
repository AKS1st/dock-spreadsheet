# dock-spreadsheet

为 [dock-files](https://github.com/AKS1st/dock-files) 提供独立的只读表格查看器。打开 `.xlsx`、`.xls`、`.ods`、`.csv`、`.tsv` 文件时进入 dock 浮窗；以只读在线表格风格提供工作表切换、单元格坐标与内容预览、列排序、列头筛选、跨单元格搜索和虚拟滚动。首行按数据展示，不擅自当作字段名。显示单元格格式化后的缓存值，不计算公式、执行宏、编辑或保存文件，不承诺还原样式/合并单元格/图表。

实现依赖 [SheetJS Community Edition](https://docs.sheetjs.com/docs/miscellany/formats/)（Excel/OpenDocument）、[Papa Parse](https://www.papaparse.com/)（CSV/TSV）及 [Tabulator](https://tabulator.info/)（表格交互）。SheetJS 采用官方发布包而非 npm registry 的过期版本。解析器与 Tabulator 样式表都会随 `lib/client.js` 打包，浏览器端不发起 CDN 请求。

## 功能

- **在线表格外观**：灰底字母列头、冻结行号、细网格线、单元格选中高亮和只读信息栏；点击单元格可查看坐标与完整纯文本。紧凑浮窗会自动收起辅助提示，工作表标签支持横向滚动。
- **工作表切换**：底部标签列出工作簿内所有工作表，支持点击和方向键切换；切换后按该表的行列范围重建表格并清空旧选中态。
- **URL 识别**：单元格文本中的链接渲染为可点击链接，**Ctrl/⌘+点击**在新标签页打开（`noopener,noreferrer`）；普通点击不跳转。识别范围为显式 `http(s)://` 与 `www.` 前缀，句末标点与不配对括号不计入链接，链接以外的原文逐字保留。锚点用 `textContent` 构造，不经过 `innerHTML`。
- **排序 / 筛选 / 搜索**：点击列头排序；工具栏“筛选列”按需显示列头筛选框，收起时清空列筛选以避免隐藏的筛选条件；搜索框对当前工作表所有数据列做大小写不敏感的包含匹配，清空即恢复全部行。底部状态栏显示当前可见行数、预览行数与列数。
- **坐标保真**：首行按数据呈现，不推断表头；行号列显示工作表内真实行号，空白单元格显示为空字符串，偏移起始的工作表（如从 `C3` 开始）按原坐标定位。
- **虚拟滚动**：表格按可视区渲染，大表不会一次性插入全部行节点。

## 依赖

| 依赖 | 类型 | 说明 |
| --- | --- | --- |
| [dock](https://github.com/AKS1st/dock) >= 0.2.0 | peer（必需） | 工作台外壳：`ctx.workbench`、浮窗由它提供 |
| [dock-files](https://github.com/AKS1st/dock-files) >= 0.1.0 | peer（必需） | 文件域服务：本插件作为 `spreadsheet` 查看器被分发打开 |
| DSH Web 环境 | 运行时 | 必需，客户端平台为 Web |
| `cordis` ^4.0.0-rc.7 | peer | 插件框架（DSH 自带） |
| `react` ^18.2.0 | peer（可选） | 客户端渲染需要；未提供时查看器 UI 不激活 |
| `xlsx` / `papaparse` / `tabulator-tables` | 内置（构建打包） | 解析与表格交互，随 `lib/client.js` 打包 |

## 限制与安全

- Host 只提供 `POST /dock-spreadsheet/read`，返回原始字节；请求必须通过同源/可信 Host 检查，路径须为绝对路径且扩展名匹配，文件须为常规文件；单文件上限 20 MiB。与其他 dock 查看器一致，允许查看工作区之外由会话指向的绝对路径；**不提供任何写入接口**。
- 前端只预览每张工作表前 5000 行、256 列，超出时在工具栏提示截断。CSV/TSV 按 UTF-8 解码，非 UTF-8 输入会明确报错而不是静默乱码。
- 工作簿内容视为不可信数据：单元格一律以纯文本渲染，`<b>` 这类内容不会变成 DOM 元素，也不启用 Tabulator 的 HTML 格式化器。
- URL 识别只覆盖显式 scheme 与 `www.` 前缀：裸域名（`example.com`）与邮箱地址按普通文本处理，避免在任意表格数据上误判。打开链接是浏览器行为，不受会话工作区边界约束。
- 预览上限之内，复杂工作簿仍在浏览器主线程解析，超大文件可能短暂卡顿。

## 开发

```sh
pnpm install
pnpm run check   # 生成内嵌样式 + 类型检查
pnpm test        # 构建 + 18 项测试
```

`pnpm test` 覆盖：xlsx/xls/ods/csv/tsv 解析与单元格取值、偏移坐标与非 UTF-8/公式文本的转义行为、URL 识别（边界、标点裁剪、括号配对、原文完整性）、Host 路由的信任栅栏与大小/扩展名/常规文件校验、浏览器产物在仅提供平台 React 时能否加载并注册查看器，以及在 jsdom 中真实挂载 React + Tabulator 后执行搜索、排序、单元格选中、筛选开关、工作表标签及方向键切换与链接的 Ctrl/⌘+点击。

### 真实 Web 环境验证

在隔离容器内启动真实 `dsh web`（随机端口，不触碰宿主 3080 实例）并用真实 Chromium 驱动，29/29 项通过：dock 客户端挂载、Files 入口注册、文件浏览器分发、Host 路由返回 200 与 `application/octet-stream`（实测 17096 字节）、工作表标签、单元格坐标与纯文本信息栏、只读标识、选中高亮、搜索与可见行数、按需列筛选及收起后清除隐藏条件、切表后选中态复位、URL 的 Ctrl+点击，以及 360px 窄浮窗工具栏和标签未被裁切。无页面异常，失败响应仅来自该容器已知的 `dsh-sysmon` 环境限制。复现脚本：`dsh-verify/scripts/run-dock-spreadsheet-check.sh`。

## 安装

需要 `dock` 与 `dock-files`：

```sh
dsh plugin --profile web add dock-base
dsh plugin --profile web add dock-files
dsh plugin --profile web add dock-spreadsheet
```

本地开发用 `link:`：

```sh
dsh plugin --profile web add link:/absolute/path/to/dock-spreadsheet
```

加载器通过 profile 的 `node_modules` 解析 bundle，因此安装必须真正落到该目录（`node_modules/dock-spreadsheet` 可解析），仅修改 `dsh.profile.bundles` 不足以加载。安装要求 profile 目录可写：若该路径位于只读挂载（`/` 为 `ro` 时 `~/.dsh` 就在其上），需先让文件系统可写，否则链接创建会以 `EROFS` 失败。**安装后必须由用户重启 dsh web 才会激活**：插件集合的变更在重启时生效，不要用重启替代验证。

## License

MIT
