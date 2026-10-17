# dsh-plugin-chat-background

用一张**本地图片**作为 DeepSeek Harness 对话窗口的背景。
Use a **local image** as the DeepSeek Harness chat window background.

> 状态 / Status: **1.0.0** — 面向具体 DSH 桌面版（开发时 `0.2.0-rc.2`）实现，依赖该版本的主题令牌与插槽。
> Built against a specific DSH desktop build (`0.2.0-rc.2` at the time of writing); it relies on that build's theme tokens and slots.

---

## 安装

### 方式一：在 DSH 界面里安装（推荐）

1. 打开 **插件** 页
2. 点 **添加插件** 旁的箭头 → **安装第三方插件**
3. 填入：

   ```
   github:Nameless-Face/dsh-chat-background
   ```

4. 安装完成后按提示重启 DSH

### 方式二：命令行

```bash
dsh plugin add github:Nameless-Face/dsh-chat-background
```

> 需要 DSH 提供 `dsh plugin` 子命令；没有的话用方式一。

### 安装后

- 背景设置入口：**设置 → 背景**
- 侧栏底部另有一个快捷开关
- 插件列表里的标题来自 `locale/zh.json` / `locale/en.json`

---

## 功能

| 功能 | 说明 |
|---|---|
| 背景图 | 选择本地图片（PNG / JPG / WebP / GIF / AVIF），铺满整个对话窗口 |
| 开关 | 随时启用 / 停用；停用后完全恢复内置外观，设置全部保留 |
| 水平 / 垂直位置 | 按比例选择显示区域，不拉伸 |
| 完整显示整张图 | 等比缩放到完整可见（关闭时为铺满裁切） |
| 壁纸亮度 | 往右壁纸更亮、白纱更薄；往左更暗、文字更清楚 |
| 磨砂玻璃 | 压暗层的 `backdrop-filter`，只糊背后的壁纸，不影响界面文字 |
| 输入框不透明度 / 磨砂 | 同时控制**文字底纱**的浓度与磨砂 |
| 用量浮窗 | 输入框右侧的小按钮，点开显示轮/步、tok/s、缓存命中、上下文占用等；可拖动并吸附边缘，点外部或 Esc 收起 |
| 隐藏内置状态行 | 用浮窗取代输入框下方的内置统计与上下文环 |

---

## 设计取舍（你可能会注意到的）

- **壁纸画在 `body` 上**，两个列只做透明化。这样整窗连续、不会在两列交界处出现接缝。
- **只透明化两个令牌**：`--dsw-alias-bg-base`、`--dsw-specific-sidebar-fill`。浮层令牌（`bg-layer-*`、`bg-overlay`）一律不碰，否则设置面板、菜单、下拉会被壁纸穿透。
- **文字底纱只铺在 markdown 容器的直接子块上**，全篇恰好一层；列表由 `ul`/`ol` 整体承担，避免一行一块、各带圆角。
- **壁纸亮度方向是刻意的**：往右应该"让背景更明显"。控"压暗层浓度"的写法会让人越拉越暗、文字越糊。
- 图片以**原始字节**存进 IndexedDB（不重编码、不压缩），渲染时用 object URL。换电脑不会带走图库 —— 那属于浏览器数据。

---

## 数据与隐私

- 所有图片**只存在本机**：浏览器 IndexedDB（图库）+ `localStorage`（设置）。
- 插件**不联网**，不上传任何图片或使用数据。
- 卸载插件后，图库仍留在浏览器存储里；需要清理可清空该来源的站点数据。

---

## 卸载

**插件**页 → 找到本插件 → **卸载**，然后重启 DSH。
设置里的「背景」分区会随插件一起消失。

---

## 目录结构

```
package.json         组合包清单（dsh.bundle.patch + dsh.client）
cordis.patch.yml     注册一行插件
index.js             宿主半体（空实现，只为让 Loader 扫描到本包）
client.js            浏览器半体（全部逻辑）
locale/zh.json       中文标题与说明
locale/en.json       英文标题与说明
icon.svg             插件图标
```

无运行时依赖、无构建步骤：`client.js` 是纯 ES 模块，直接可加载。

---

## 许可证

[MIT](./LICENSE) © 2026 Nameless-Face
