# UniSchedule 课程表系统

当前完成第一步的应用界面基础及第二步的 PostgreSQL、Drizzle 迁移和合成测试数据接入。**尚未实现登录、注册、密码重置、设备记忆、会话或权限验证。** 表单只演示输入、密码显隐和提示，不发送或保存凭据；请勿用真实密码演示。

## 项目结构

```text
00_客户需求/             客户范围和目标
01_需求工程/             需求、用户故事与可追溯性
02_软件设计与架构/       架构、数据模型、接口与 Figma 原型
03_施工步骤/             分阶段施工计划
app/                    独立 Next.js 工程
  src/app/              App Router 页面、布局和全局样式
  src/components/       登录表单及通用 ui 组件
  src/lib/              样式合并等共用工具
  src/server/db/        Drizzle 表结构、连接与测试资料
  src/server/integrations/ 数据源适配器和原子导入
  src/server/services/  内部课表数据读取
  drizzle/              可审查的 SQL 迁移和元数据
  fixtures/             合成测试数据
  scripts/              本地数据库、迁移、导入与检查命令
  tests/                真实 PostgreSQL 集成测试
  docs/database.md      数据库及导入规则说明
  public/images/        已下载的 Figma 插画与图标
  components.json       shadcn/ui 配置
  .env.example          无密钥的环境变量说明
  package-lock.json     npm 依赖锁定文件
.github/workflows/       类型、代码和正式构建检查
```

`src/server/auth` 和 `api` 随第三步认证及后续 tRPC 接入建立。内部读取函数未开放为 HTTP 接口，也不代表鉴权完成。

## 环境与安装

使用 Node.js **22.14.0**（`.nvmrc`）及 npm **10.9.2**，支持 Node 22.14+ 的 22.x 和 npm 10.x。工程使用 Next.js 16、React 19、TypeScript、Tailwind CSS 4 和 shadcn/ui 风格的本地组件。依赖精确解析见 `app/package-lock.json`，团队和 CI 均使用 `npm ci`。

在仓库根目录执行：

```sh
nvm use                 # 已安装对应 Node 时；不使用 nvm 可自行安装上述 Node
cd app
npm ci
npm run dev
```

打开 <http://localhost:3000>。当前首页就是登录页。静态登录页不要求数据库在线；执行数据库命令前按下节配置 `.env.local`。`.env.local` 已被忽略，不应提交真实密钥。

## 数据库与测试数据

安装 PostgreSQL 18，并将 `initdb`、`pg_ctl` 加入 PATH。在 `app/` 下执行：

```sh
cp .env.example .env.local  # 已有配置时手动合并
npm run db:up              # 项目专属实例：127.0.0.1:55432
npm run db:migrate         # 空库执行迁移，可重复执行
npm run db:seed            # 合成数据；再次运行不会重复创建
npm run db:inspect         # 检查两位学生及空课表，保留容量 null/0
npm run test:db            # 独立临时数据库，测试后自动清理
```

用 `npm run db:down` 停止实例并保留数据。修改表结构后运行 `npm run db:generate`，审查并提交生成的迁移，再执行 `db:migrate`。测试连接用户须有创建数据库权限，测试不会清空开发库。

详细环境说明、身份衔接、全量/增量/故障处理及测试记录见 [数据库说明](app/docs/database.md)。当前只有合成测试来源，**FR-01 批准数据源验收仍待数据负责人确认**；不会将测试数据标记为 verified 或 official。

## 检查与正式运行

以下命令均在 `app/` 下执行：

```sh
npm run typecheck      # 先生成路由类型，再检查 TypeScript；全新拉取也可运行
npm run lint           # ESLint，警告也视为失败
npm run build          # 正式构建
npm run check          # 按顺序执行以上三项
npm start              # 先 build，再在 localhost:3000 启动正式服务
```

GitHub Actions 在 push 和 pull request 上执行 `npm ci`、`npm run check`、迁移漂移检查及 PostgreSQL 集成测试。CI 配置已提供，远程运行结果以 GitHub 为准。

## 界面与基础组件

设计来源：[Figma 登录页 26:4](https://www.figma.com/design/F9PdvZ2BAiF2pOJ6lmr6uY/Untitled?node-id=26-4)。保留英文文案、校园插画、半透明面板、Geist 字体、主色 `#e64626`、文字 `#111111` / `#666666`、边框 `#e5e5e5`、输入框/按钮 10px 圆角、面板 20px 圆角，以及 8/16/20/32px 常用间距。

原画板固定为 1440×900；实现使用弹性高度，并修正原稿 420px 表单超出面板内容区的问题。1024px 以下改为顶部校园图与单列表单，320px 宽度仍可使用。增加了预览提示、键盘焦点和表单标签；未假装实现认证。记住设备仅切换当前页面复选框，不持久化。

样式变量集中在 `app/src/app/globals.css`；共用 `Button`、`Input`、`FormField` 位于 `src/components/ui/`。`components.json` 已配置 shadcn/ui 的别名和 Tailwind 4 CSS 入口；按钮使用其 CVA / Radix Slot 组合方式，可按需扩展组件。Geist 通过 `@fontsource/geist` 本地打包，正式构建不依赖 Google Fonts 网络请求。Figma 原始资源保存于 `public/images/`，不依赖七天有效的临时地址。

人工验收：在桌面与窄屏打开首页，检查插画、表单与页脚，使用 Tab 导航，输入演示邮箱和密码、切换密码显示和复选框，再点击 Sign In、Forgot password?、Sign up，确认只显示预览提示，没有真实登录或跳转。

配置参考：[Next.js 安装文档](https://nextjs.org/docs/app/getting-started/installation)、[shadcn/ui Next.js 文档](https://ui.shadcn.com/docs/installation/next)。后续施工顺序见 `03_施工步骤/01_施工计划.md`。
