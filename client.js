/**
 * 浏览器半体（Client half）：对话平台本地背景图。
 */

window.__ModuleLoader__.load({
  id: 'dsh-plugin-chat-background',
  factory(require) {
    const React = require('react');
    const h = React.createElement;

    /** 设置页的文案命名空间。 */
    const NS = 'settings.chat-background';
    /** localStorage 键：小体积参数。 */
    const SETTINGS_KEY = 'dsh.chat-background';
    /** IndexedDB：图片库（原始字节）。 */
    const DB_NAME = 'dsh-chat-background';
    const DB_STORE = 'images';
    /* 本发行版不随包附带预置图：背景图由使用者自行选择（设置 → 背景 → 选择本地图片）。 */
    /** 超过这个体积的图片会提示（不拦，也不改画质）。 */
    const HUGE_IMAGE_BYTES = 64 * 1024 * 1024;

    /**
     * 文字底纱浓度的**遗留存档值**（0.9）。渲染上已不再使用 —— 现在由 composerOpacity 控制，
     * 这里只用于旧存档读回来时字段完整。
     * 必须声明在 DEFAULT_SETTINGS 之前 —— 它被那里的初始值直接引用，
     * 放到后面会命中 TDZ（`Cannot access before initialization`，踩过一次）。
     */
    const TEXT_FILL_ALPHA = 0.9;

    const DEFAULT_SETTINGS = {
      /** 总开关。 */
      enabled: true,
      /**
       * 壁纸亮度 0–1：滑杆往右 = 壁纸越亮、白纱越薄（alpha = VEIL_MAX_ALPHA × (1 − 本值)）。
       * 方向是刻意的：控"压暗层浓度"那版往右只会更暗，用户实测完全反直觉。
       * 只有一个整窗值 —— 唯一能"盖住壁纸又被内容盖住"的层只有 body 自己的背景。
       */
      wallpaperBrightness: 0.55,
      /**
       * 次要文字改用主色：壁纸下 --dsw-alias-label-secondary / -tertiary 这两级浅灰
       * 几乎不可见（侧栏时间、元信息、轨迹标签、消息操作图标都会糊掉）。
       * 打开时把这两级映射到主文字色；关掉则恢复主题原本的层次。
       */
      labelBoost: true,
      /** 用量浮窗总开关（收起态按钮 + 展开浮窗）。 */
      usagePanel: true,
      /** 是否隐藏输入框下方原有的统计行（避免与其重复）。 */
      usageHideBuiltin: true,
      /** 收起态按钮上写什么：总用量 / 缓存命中 / 上下文占用。 */
      usageButtonText: 'total',
      /** 允许拖动按钮并吸附到屏幕边缘。 */
      usageDrag: true,
      /** 按钮位置（视口坐标，左上角）。null = 用默认位置（对话区右侧、输入框上方）。 */
      usagePanelPos: null,
      /**
       * 磨砂强度（px）：作用在压暗层上的 `backdrop-filter: blur()`。
       * 它只糊覆盖层**背后**的壁纸，不会碰到界面文字 —— 这是"背景模糊"终于可行的原因。
       */
      frostStrength: 0,
      /**
       * 以下字段的界面已按用户要求删除，`normalize()` 一律返回这里的定稿值、不再读存档 ——
       * 否则旧配置里的值会继续生效却没法调整。字段保留只为旧存档读回来时结构完整。
       *   sidebarStronger  侧栏那层纱**连元素一起删了**，本字段已无任何作用
       *   chatFillAlpha / chatFillFrost  会话区整片底色，锁 0
       *   textFillFrost    已失效：文字底纱的磨砂改由 composerFrost 控制
       *   textFillAlpha    已失效：文字底纱的浓度改由 composerOpacity 控制
       */
      sidebarStronger: false,
      chatFillAlpha: 0,
      chatFillFrost: false,
      textFillFrost: false,
      /** 文字底纱浓度：已由 composerOpacity 接管，本字段仅存档兼容（见上）。 */
      textFillAlpha: TEXT_FILL_ALPHA,
      /**
       * 输入框（`[data-composer-card]`）的不透明度 0–1。
       */
      composerOpacity: 0.75,
      /** 输入框磨砂强度 px（同样只加在那一个元素上）。 */
      composerFrost: 12,
      /** cover = 等比缩放铺满并裁切；contain = 完整显示（等比缩放，不拉伸）。 */
      fit: 'cover',
      /** 显示区域（0–100，对应 background-position）。 */
      posX: 50,
      posY: 50,
      /** 当前使用的图片 id。 */
      activeId: null,
    };

    /** 压暗层最浓时的 alpha（即「壁纸亮度」拉到 0%）。0.9 时壁纸几乎不可见，文字最清楚。 */
    const VEIL_MAX_ALPHA = 0.9;

    const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);
    const clamp01 = (value) => clamp(value, 0, 1);
    const num = (value, fallback) => (typeof value === 'number' && isFinite(value) ? value : fallback);

    /** 合并持久化设置与默认值，并夹紧范围。 */
    function normalize(raw) {
      const input = raw && typeof raw === 'object' ? raw : {};
      // 旧存档迁移：
      //   veilOpacity（旧"压暗层浓度"，越大越暗）→ bright 是它的反方向
      //   更早的 chatOpacity / imageOpacity 也是"回到底色"的方向
      const legacyDensity =
        input.veilOpacity ?? input.chatOpacity ?? input.imageOpacity ?? null;
      const brightness =
        input.wallpaperBrightness !== undefined
          ? num(input.wallpaperBrightness, DEFAULT_SETTINGS.wallpaperBrightness)
          : legacyDensity === null
            ? DEFAULT_SETTINGS.wallpaperBrightness
            : 1 - clamp01(num(legacyDensity, 0));
      return {
        enabled: input.enabled !== false,
        wallpaperBrightness: clamp01(brightness),
        labelBoost: input.labelBoost !== false,
        usagePanel: input.usagePanel !== false,
        usageHideBuiltin: input.usageHideBuiltin !== false,
        usageButtonText:
          input.usageButtonText === 'cache' || input.usageButtonText === 'context'
            ? input.usageButtonText
            : 'total',
        usageDrag: input.usageDrag !== false,
        usagePanelPos:
          input.usagePanelPos !== null &&
          typeof input.usagePanelPos === 'object' &&
          typeof input.usagePanelPos.x === 'number' &&
          typeof input.usagePanelPos.y === 'number' &&
          isFinite(input.usagePanelPos.x) &&
          isFinite(input.usagePanelPos.y)
            ? { x: input.usagePanelPos.x, y: input.usagePanelPos.y }
            : null,
        frostStrength: clamp(num(input.frostStrength, DEFAULT_SETTINGS.frostStrength), 0, 30),
        // 下面四项的界面已按用户要求删除，因此**不再读存档**、一律取定稿默认值：
        // 否则旧配置里的值会继续生效却没法调整（比如以前开过"文字底纱也磨砂"就关不掉了）。
        // 字段保留不删，是为了旧存档读回来时结构完整。
        sidebarStronger: DEFAULT_SETTINGS.sidebarStronger,
        chatFillAlpha: DEFAULT_SETTINGS.chatFillAlpha,
        chatFillFrost: DEFAULT_SETTINGS.chatFillFrost,
        // 浓度写死 0.9（用户定稿）：不再读存档、也不给滑杆，避免旧值把它改回别的浓度
        textFillAlpha: TEXT_FILL_ALPHA,
        textFillFrost: DEFAULT_SETTINGS.textFillFrost,
        composerOpacity: clamp01(num(input.composerOpacity, DEFAULT_SETTINGS.composerOpacity)),
        composerFrost: clamp(num(input.composerFrost, DEFAULT_SETTINGS.composerFrost), 0, 30),
        fit: input.fit === 'contain' ? 'contain' : 'cover',
        posX: clamp(num(input.posX, 50), 0, 100),
        posY: clamp(num(input.posY, 50), 0, 100),
        activeId: typeof input.activeId === 'string' ? input.activeId : null,
      };
    }

    // ── 设置仓库（localStorage + 订阅）───────────────────────────────────────

    let state = (() => {
      try {
        return normalize(JSON.parse(localStorage.getItem(SETTINGS_KEY) || 'null'));
      } catch {
        return normalize(null);
      }
    })();
    const listeners = new Set();

    const store = {
      get: () => state,
      subscribe(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };

    /** 合并补丁 -> 落盘 -> 通知订阅者。 */
    function update(patch) {
      state = normalize({ ...state, ...patch });
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(state));
      } catch {
        /* 存储不可用时仅本次会话生效 */
      }
      for (const listener of Array.from(listeners)) listener();
      applyVisuals();
      return state;
    }

    // ── 图片库（IndexedDB，原始字节）─────────────────────────────────────────

    const objectUrlCache = new Map();
    const thumbCache = new Map();
    let dbPromise = null;

    function openDb() {
      if (dbPromise !== null) return dbPromise;
      dbPromise = new Promise((resolve, reject) => {
        let request;
        try {
          request = indexedDB.open(DB_NAME, 1);
        } catch (error) {
          reject(error);
          return;
        }
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DB_STORE)) {
            db.createObjectStore(DB_STORE, { keyPath: 'id' });
          }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error ?? new Error('indexedDB open failed'));
      });
      return dbPromise;
    }

    async function dbAll() {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readonly');
        const request = tx.objectStore(DB_STORE).getAll();
        request.onsuccess = () => resolve(request.result ?? []);
        request.onerror = () => reject(request.error);
      });
    }

    async function dbPut(record) {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).put(record);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    async function dbDelete(id) {
      const db = await openDb();
      return await new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, 'readwrite');
        tx.objectStore(DB_STORE).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    }

    const newId = () =>
      typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : 'img-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);

    /**
     * 把图片交给 CSS 用的 URL。
     */
    /** 为某张图建立/复用 object URL。 */
    async function ensureImageUrl(id) {
      const cached = objectUrlCache.get(id);
      if (cached !== undefined) return cached;
      const records = await dbAll();
      const record = records.find((item) => item.id === id);
      if (record === undefined) return null;
      const url = URL.createObjectURL(record.blob);
      objectUrlCache.set(id, url);
      return url;
    }

    /** 撤销某张图的 object URL（删图/切图时调用，避免内存泄漏）。 */
    function releaseImageUrl(id) {
      const url = objectUrlCache.get(id);
      if (url === undefined) return;
      URL.revokeObjectURL(url);
      objectUrlCache.delete(id);
    }

    /** 撤销全部 object URL（卸载时调用）。 */
    function releaseAllImageUrls() {
      for (const [, url] of objectUrlCache) URL.revokeObjectURL(url);
      objectUrlCache.clear();
    }

    /** 校验字节确实是可解码的图片；返回是否带 alpha 通道（决定预览底色）。 */
    async function probeImage(blob) {
      const objectUrl = URL.createObjectURL(blob);
      try {
        return await new Promise((resolve, reject) => {
          const probe = new Image();
          probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
          probe.onerror = () => reject(new Error('image decode failed'));
          probe.src = objectUrl;
        });
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    }

    /** 取 96px 缩略图 data: URL，带缓存。 */
    async function getThumbUrl(id) {
      if (thumbCache.has(id)) return thumbCache.get(id);
      const records = await dbAll();
      const record = records.find((item) => item.id === id);
      if (record === undefined) return null;
      const bitmap = await createImageBitmap(record.blob).catch(() => null);
      if (bitmap === null) return null;
      const scale = Math.min(1, 96 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close?.();
      const url = canvas.toDataURL('image/jpeg', 0.72);
      thumbCache.set(id, url);
      return url;
    }

    /** 新增一张图片（原始字节原样入库）。 */
    async function addImage(blob, name, origin) {
      const size = await probeImage(blob);
      const record = {
        id: newId(),
        name,
        origin,
        bytes: blob.size,
        width: size.width,
        height: size.height,
        addedAt: Date.now(),
        blob,
      };
      await dbPut(record);
      return record;
    }

    /** 删除一张图片，并清理缓存。 */
    async function removeImage(id) {
      await dbDelete(id);
      releaseImageUrl(id);
      thumbCache.delete(id);
    }

    /** 从任意绝对路径导入（走页面自身的 /api/file 通道，携带页面既有认证）。 */
    async function fetchPathBlob(path) {
      const url = '/api/file?path=' + encodeURIComponent(path);
      const response = await fetch(url, { credentials: 'same-origin' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const blob = await response.blob();
      if (blob.size === 0) throw new Error('empty');
      return blob;
    }

    // ── 样式：唯一的样式表，作用域限定在 body[data-dsh-bg] 内 ────────────────

    const CSS = `
:root{
  --dsh-bg-zoom:cover;
  --dsh-bg-focus:50% 50%;
  --dsh-chat-left:268px;
  /* 文字底纱：默认关闭。数值由 paintAll 内联写在 <html> 上（同元素、inline 胜出）。
     用 rgb 三元组（如 "249, 249, 249"）+ rgba() 包一道，仍是【确定值】而非 var() 链。 */
  --dsh-bg-text-rgb:249, 249, 249;
  --dsh-bg-text-alpha:0;
  --dsh-bg-text-blur:0px;
}
/* 文字底纱：**只铺在 markdown 容器的【直接子块】上，全篇恰好一层**。
   为什么用直接子代组合器（>）而不是"祖先 + 后代"再拿 :has() 去筛：
     上一版写成"祖先 + 后代"再拿 :not(:has(p, ul, ol, li…)) 去筛"最外层"，
     结果把列表整块筛掉了 —— ul/ol 里含 li，于是连列表的底一起消失（用户报"markdown 下纱都没了"）。
     用直接子代组合器限定"直接子块"是**结构本身**给的保证：每个块只被铺一次，
     既不会父子叠两层，也不会漏掉列表。不需要猜。
   三条踩坑换来的规则：
     1) 用 background-color 真正的填充，不是 box-shadow。
        早先用 inset 描边想"包住文字"，画出来的是四周的边框、中间是空的，
        而且对多行是"每行一个盒子"（行间还有缝）—— 实测就是个逐行方框。
     2) **不含 li**：列表项是逐项独立的盒子（各自 padding + 圆角），给它铺底就成了
        "一行一块、每块一个圆角"。列表的底由 ul / ol **整体一块**承担（含列表标记）。
     3) **不含 div**：markdown 里 div 常是语法高亮之类的包装，把 div 也列进来会与真正的
        文字块叠色。只列出确定的文字块元素。
     4) **不含 table**：表格被渲染器包在滚动容器里（见下方 _tableScroll 规则），
        表格自身铺底会与那层容器叠色，所以表格的底统一由容器承担。
    padding 把底向外扩一点，视觉上刚好包住文字；box-decoration-break 兜底多行盒。 */
body[data-dsh-bg-text="on"] :is([class*="_markdown"], [class*="_bubble"], [class*="_message"], [class*="_text"]) > :is(
  p,
  ul,
  ol,
  h1,
  h2,
  h3,
  h4,
  h5,
  h6,
  blockquote,
  pre
) {
  background-color: rgba(var(--dsh-bg-text-rgb), var(--dsh-bg-text-alpha));
  border-radius: 8px;
  padding: 4px 10px;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  backdrop-filter: blur(var(--dsh-bg-text-blur));
}
/* 删去"每一行自己那层更浓的纱" = 内置给行内代码画的**实色底 + 边框**。
   置为透明后行内代码就落在段底之上、颜色与段落一致；再补一条极淡描边，
   否则代码与正文混成一片、失去辨识。作用域仍限定在正文内，不影响其它面板。 */
body[data-dsh-bg-text="on"] :is([class*="_markdown"], [class*="_bubble"], [class*="_message"], [class*="_text"]) :not(pre) > code {
  background-color: transparent;
  border-color: rgba(var(--dsh-bg-text-rgb), calc(var(--dsh-bg-text-alpha) * 0.55));
}
/* 表格的底：渲染器给每个表格套了一层滚动容器（tableScroll / tableFill），
   所以表格**不在** markdown 容器的直接子层，"直接子块"规则够不到它。
   补上这两层容器（它们专属于表格），让表格也有同一层底。 */
body[data-dsh-bg-text="on"] :is([class*="_tableScroll"], [class*="_tableFill"]) {
  background-color: rgba(var(--dsh-bg-text-rgb), var(--dsh-bg-text-alpha));
  border-radius: 8px;
  padding: 4px 10px;
}
/* 表格与输入框：样式由 paintComposerAndTables() 直接内联写在元素上（确定值，便于自检断言），
   这里只留一句说明，不放规则 —— 少一层 var 间接就少一个静默失效的机会。 */
/* 隐藏内置统计行（它在 dock 里是 [data-composer-stats]，见 paintAll 的开关）。
   说明：这一行自带的两个详情弹窗会一并消失 —— 设置页那条开关的说明里已写明。 */
body[data-dsh-bg-usage="hide"] [data-composer-stats]{display:none!important}
/* ── 弹出菜单写成不透明 ──────────────────────────────────────────────────────
   菜单表面**设计上就是半透明的**（--dsw-menu-surface-fill: #f8f9fa94 ≈ 58% 不透明，
   再叠一层 backdrop-filter 做毛玻璃）。浮在实色界面上没问题，但压在壁纸上时
   内容会与背景互相干扰 —— 用户实测"加号菜单非常透明"，要求写成不透明。
   做法：在菜单根上重定义它自己那两个变量（[data-menu-material] 是菜单的稳定属性抓手，
   不受哈希类名变动影响），底色换成与浮窗同一个**不透明**实色变量 --dsh-bg-card-rgb。
   作用域限定在壁纸就绪时：停用背景后菜单恢复内置玻璃质感，插件不越界。
   注意：这段注释里**不能出现反引号**，CSS 在模板字符串里，反引号会截断它。 */
body[data-dsh-bg="ready"] [data-menu-material]{
  --dsw-menu-surface-fill:rgb(var(--dsh-bg-card-rgb, 249, 249, 249));
  --dsw-menu-backdrop-filter:none;
}
/* ── 次要文字改用主色 ────────────────────────────────────────────────────────
   主题把 --dsw-alias-label-secondary / -tertiary 声明在 **body** 上，分别是
   neutral-700 / neutral-600 的浅灰。铺上壁纸后，侧栏时间、元信息、轨迹标签、
   消息操作图标这些低对比文字几乎看不见（用户实拍反馈：深色壁纸下完全糊掉）。
   做法：只在壁纸就绪且开关打开时，把这两个令牌直接映射到主文字色
   --dsw-alias-label-primary（浅色主题近黑、深色主题近白），主题切换自动跟随。
   选择器前面加 html 提高特异性，压过主题自己的 body 规则，不依赖样式表顺序。
   刻意不用 color-mix 做比例插值：这两个令牌本身就声明在 body 上，
   在 body 上写"按比例混回自己"会成环，整条声明失效。
   注意：这段注释里不能出现反引号，CSS 在模板字符串里。 */
html body[data-dsh-bg-label="on"]{
  --dsw-alias-label-secondary:var(--dsw-alias-label-primary);
  --dsw-alias-label-tertiary:var(--dsw-alias-label-primary);
}
/* ── 用量浮窗 ────────────────────────────────────────────────────────────────
   收起态是一枚淡色小按钮（写实时总用量），展开态是一块磨砂卡片，贴着对话区右侧、
   浮在输入框上方。整体只在壁纸就绪时可见，所以停用背景后这个组件等于不存在。 */
/* 用量浮窗的包装层：**只由内联 left/top 定位**（默认位置也在 JS 里算成 left/top）。
   这里刻意不写 right/bottom —— 一旦写了，它们会和内联的 left/top 同时生效，
   元素被挤到左上角而读取的却是内联值（实测现象："一拖就瞬移到左上角"）。 */
body[data-dsh-bg="ready"] ._dsbg_usage{
  position:fixed;
  left:0;
  top:0;
  z-index:8;
  display:none;
  flex-direction:column;
  align-items:flex-end;
  gap:8px;
}
body[data-dsh-bg="ready"] ._dsbg_usage{display:flex}
._dsbg_usage_dragging{cursor:grabbing}
._dsbg_usageButton{
  box-sizing:border-box;
  max-width:100%;
  padding:3px 10px;
  border:0;
  border-radius:999px;
  cursor:pointer;
  font:inherit;
  font-size:12px;
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
  color:var(--dsw-alias-label-tertiary);
  background-color:rgba(var(--dsh-bg-text-rgb), var(--dsh-bg-text-alpha));
  opacity:.45;
  transition:opacity .12s ease;
}
/* 可拖动时给一个抓手光标，让"能拖"这件事看得出来 */
._dsbg_usageButton[data-dsh-bg-usage-drag="on"]{
  cursor:grab;
  touch-action:none;
  user-select:none;
  -webkit-user-select:none;
}
._dsbg_usageButton:hover,
._dsbg_usageButton:focus-visible,
._dsbg_usageButton[aria-expanded="true"]{opacity:1}
/* 卡片自己定位（fixed），位置由 resolveCardPlacement 算出的内联样式决定，
   所以这里不再设 right/bottom，只负责外观。 */
._dsbg_usageCard{
  box-sizing:border-box;
  min-width:220px;
  max-width:min(340px, calc(100vw - 48px));
  padding:10px 12px 12px;
  border:.5px solid var(--dsw-alias-border-l2);
  border-radius:var(--dsw-radius-lg);
  /* 浮窗**完全不透明**（用户要求）：用鼠标悬停用的主题底色实色，而不是半透明的底纱。
     收起态的小按钮仍然用底纱（那层要与背景融为一体），两者风格刻意不同。
     不透明就不需要 backdrop-filter 了，去掉以免留下无效声明。 */
  background-color:rgb(var(--dsh-bg-card-rgb, 249, 249, 249));
  box-shadow:var(--dsw-elevation-soft);
  color:var(--dsw-alias-label-secondary);
  font-size:12px;
  line-height:18px;
  z-index:9;
}
._dsbg_usageHead{
  display:flex;
  align-items:center;
  justify-content:space-between;
  gap:12px;
  margin-bottom:6px;
  color:var(--dsw-alias-label-primary);
  font-weight:600;
}
._dsbg_usageClose{
  border:0;
  padding:0 4px;
  border-radius:6px;
  cursor:pointer;
  background:0 0;
  color:var(--dsw-alias-label-tertiary);
  font:inherit;
  font-size:14px;
  line-height:1;
}
._dsbg_usageClose:hover{background:var(--dsw-alias-interactive-bg-hover)}
._dsbg_usageLine{display:flex;align-items:baseline;justify-content:space-between;gap:16px}
._dsbg_usageLabel{color:var(--dsw-alias-label-tertiary)}
._dsbg_usageValue{
  color:var(--dsw-alias-label-primary);
  font-variant-numeric:tabular-nums;
  white-space:nowrap;
}
/* 壁纸画在 body 自己的背景上（见 paintAll）：body 的背景是页面上最底层的
   东西，谁也挡不住它，且天然覆盖 frame、标题栏与列之外的一切区域。 */
/* 压暗层：固定的整窗覆盖层，alpha 由设置页滑杆控制（bg-color 直接内联写，见 paintAll）。
   z-index:-1 让它位于 body 背景之上、应用所有内容之下 —— 既盖住壁纸，又不挡任何界面。
   backdrop-filter 只会糊它**背后**的壁纸，不会碰到界面文字（这正是之前做不出模糊的原因：
   早先把图铺在列元素上，给元素加 filter 会连列内文字一起糊）。 */
._dsbg_veil{position:fixed;top:0;right:0;bottom:0;left:0;z-index:-1;pointer-events:none;background-color:transparent}
/* 侧栏再叠一层同色同 alpha 的纱 → 侧栏必定比会话区更实 */
/* 会话区那层纱（可单独调、可磨砂）。
   z-index 与实现要和"能盖住会话区内容"匹配：助手正文没有自己的背景，需要一个盖在它之上的底。
   用 z-index:1 —— 应用内容是不带 z-index 的兄弟节点，所以这一层会落在它们之上并使其变淡；
   它是 pointer-events:none 的纯像素，不会拦截任何交互。 */
._dsbg_veilChat{position:fixed;top:0;bottom:0;right:0;left:var(--dsh-chat-left, 268px);z-index:1;pointer-events:none;background-color:transparent;display:none}
/* 让内置的「大面积底色」在总开关打开时透出背景图。
   已逐条核对内置用法（全 asar 扫描）：
     · --dsw-alias-bg-base         会话列根（ConversationRoot）、窗口根 —— 需要透出
     · --dsw-specific-sidebar-fill 侧栏、Windows 标题栏 —— 需要透出
     · --dsw-alias-bg-layer-1/2/3  分段控件指示块 / **设置面板·菜单·下拉·代码查看器** / 输入框
       —— 都是浮层与控件，绝不能跟着透明，否则设置面板会被背景图穿透
     · --dsw-alias-bg-overlay      浮层底色，同样保持不透明
   因此这里只改前两个。这些令牌都只定义在 body / body[data-ds-dark-theme] 上，
   本样式表后插入所以后胜；!important 只为抵消样式注入顺序变化，作用域仍限于本插件的开关属性内。

   注意选择器要求 data-dsh-bg="ready" 而不是 "on"：
   「ready」只有在壁纸确实写到 body 上之后才会设置。否则一旦那步失败，
   底色已经透明、图却没上来，页面就变成一片空白 —— 这是最糟的失败模式。 */
body[data-dsh-bg="ready"]{
  --dsw-alias-bg-base:transparent!important;
  --dsw-specific-sidebar-fill:transparent!important;
}

/* 两个**吸顶**元素（折叠/压缩条、消息横幅）：它们的底色直接取自 bg-base，
   作用是挡住从下方滚上来的内容。全局令牌透明会让它们彻底没有底色 ——
   现象就是「整条透明、指针移上去更明显」。只给这两类还原令牌值，
   其余组件一律不动，避免又出现上一次那种整页发白。
   类名用子串匹配：DSH 的哈希前缀每次构建都会变。 */
body[data-dsh-bg="ready"] [class*="_compactionButton"],
body[data-dsh-bg="ready"] [class*="_bannerWrap"]{
  --dsw-alias-bg-base:var(--dsw-static-neutral-bluish-00);
}

/* 「继续执行目标」这类回合触发条（结构：*_root > button*_header）。
   内置样式是 background: markdown-code-block（实色）；
   而 :hover 换成 --dsw-alias-interactive-bg-hover —— 那是一层 8% 白，
   设计前提是底下有实色底，所以看起来只是"变亮一点"。
   但壁纸是照片，8% 白压上去等于没有，于是整行在悬停瞬间"透掉"。
   这里改成：底色固定保留，悬停改为同底色掺一点前景色的实色提亮。
   用 :has(> *_header) 精确定位这一族，不误伤其它 *_root。 */
body[data-dsh-bg="ready"] [class*="_root"]:has(> [class*="_header"]){
  background-color:var(--dsw-alias-markdown-code-block)!important;
}
body[data-dsh-bg="ready"] [class*="_root"]:has(> [class*="_header"]):hover{
  background-color:color-mix(in srgb, var(--dsw-alias-markdown-code-block) 92%, var(--dsw-alias-label-primary))!important;
}
body[data-dsh-bg="ready"][data-ds-dark-theme] [class*="_compactionButton"],
body[data-dsh-bg="ready"][data-ds-dark-theme] [class*="_bannerWrap"]{
  --dsw-alias-bg-base:var(--dsw-static-neutral-bluish-950);
}
/* 输入框下方的状态行（轮/步、tok/s、总 tok、缓存命中、上下文占用）：单独铺一层纱。
   为什么需要：这几粒 12px 小字原本浮在实色输入框卡片上（对比稳定），
   卡片透明后它们直接压在壁纸/白纱上，对比随壁纸明暗浮动 —— 这是我们改动造成的回归。
   做法：给每粒 pill 自己一块圆底，**复用正文底纱那套令牌与滑杆**
   （--dsh-bg-text-rgb / --dsh-bg-text-alpha），所以颜色和浓度与正文完全一致，
   调「文字底纱」时两者一起动，不会出现两套标准。
   颜色不再单独提级：有了底，三级色已经够清楚（提级会让它比正文还抢眼）。 */
body[data-dsh-bg] [data-composer-stats] [class*="_pill"]{
  background-color:rgba(var(--dsh-bg-text-rgb), var(--dsh-bg-text-alpha));
}
/* ── 设置页：结构与样式照抄内置设置分区（见 README「与内置设置页对齐」）─────────
   面板内容列已自带 padding:0 24px 24px，分区自己不再加左右 padding。 */
._dsbg_section{display:flex;flex-direction:column;gap:12px;max-width:720px;color:var(--dsw-alias-label-primary)}
._dsbg_heading{margin:0;font-size:18px;font-weight:600}
._dsbg_intro{margin:0;font-size:13px;color:var(--dsw-alias-label-tertiary)}
._dsbg_row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}
._dsbg_row:last-child{border-bottom:none}
._dsbg_rowText{min-width:0}
._dsbg_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}
._dsbg_desc{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}
/* 开关：状态只挂 aria-checked（与内置 Switch 组件一致，无平行 class） */
._dsbg_switch{box-sizing:border-box;position:relative;flex:0 0 auto;width:36px;height:20px;padding:2px;border:0;border-radius:999px;corner-shape:round;background:var(--dsw-alias-border-l3);cursor:pointer}
._dsbg_switch[aria-checked="true"]{background:var(--dsw-alias-brand-primary)}
._dsbg_switch:disabled{cursor:default;opacity:.5}
._dsbg_switch:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
._dsbg_knob{display:block;width:16px;height:16px;border-radius:50%;corner-shape:round;background:var(--dsw-alias-label-primary-foreground);transition:transform 120ms ease}
._dsbg_switch[aria-checked="false"] ._dsbg_knob{background:var(--dsw-alias-switch-thumb)}
._dsbg_switch[aria-checked="true"] ._dsbg_knob{transform:translateX(16px)}
/* 滑杆：内置设置里没有滑杆组件，这版是按开关的视觉语法自建的 */
._dsbg_sliderRow{display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:.5px solid var(--dsw-alias-border-l2)}
._dsbg_sliderRow:last-child{border-bottom:none}
._dsbg_sliderLabel{flex:none;width:132px;color:var(--dsw-alias-label-primary);font-size:13px;line-height:1.5}
._dsbg_slider{flex:1;-webkit-appearance:none;appearance:none;height:20px;background:transparent;cursor:pointer}
._dsbg_slider::-webkit-slider-runnable-track{height:4px;border-radius:999px;background:var(--dsw-alias-border-l3)}
._dsbg_slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;width:16px;height:16px;margin-top:-6px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary-foreground);box-shadow:var(--dsw-elevation-soft)}
._dsbg_slider:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:2px}
._dsbg_sliderValue{flex:none;width:52px;text-align:right;color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.5;font-variant-numeric:tabular-nums}
/* 按钮：内置 Button 规格（高 36 / radius 12 / 14px·22px / padding 0 14px） */
._dsbg_button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:4px;height:36px;padding:0 14px;border:none;border-radius:var(--dsw-radius-md);font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);background:transparent;cursor:pointer;white-space:nowrap}
._dsbg_button:disabled{cursor:not-allowed;opacity:.4}
._dsbg_button:focus-visible{outline:var(--dsw-focus-ring-width) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));outline-offset:1px}
._dsbg_button_ghost{border:.5px solid var(--dsw-alias-border-l3)}
._dsbg_button_ghost:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
._dsbg_button_primary{background:var(--dsw-alias-button-primary-fill);color:var(--dsw-alias-label-primary-foreground)}
._dsbg_button_primary:hover:not(:disabled){background:var(--dsw-alias-button-primary-hover)}
/* 单行输入：内置 SettingsValueField 规格（高 34 / radius 12 / layer-3） */
._dsbg_input{box-sizing:border-box;flex:1;min-width:120px;height:34px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l4);border-radius:var(--dsw-radius-md);background:var(--dsw-alias-bg-layer-3);font:inherit;font-size:13px;line-height:1.5;color:var(--dsw-alias-label-primary)}
._dsbg_input:focus-visible{outline:none;border-color:var(--dsw-alias-state-business-primary)}
._dsbg_buttonRow{display:flex;flex-wrap:wrap;align-items:center;gap:8px;padding:12px 0}
/* 预览：与缩略图卡同样的描边与圆角。
   高度不依赖 aspect-ratio：用 padding-bottom 撑比例，避免任何布局上下文里塌陷或被压成两行。 */
._dsbg_preview{position:relative;width:100%;height:0;padding-bottom:56.25%;min-height:180px;border-radius:var(--dsw-radius-xl);overflow:hidden;border:.5px solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-bg-layer-2);cursor:crosshair;flex:none}
._dsbg_previewImage{position:absolute;top:0;right:0;bottom:0;left:0;background-repeat:no-repeat;background-size:var(--dsh-bg-zoom);background-position:var(--dsh-bg-focus)}
._dsbg_previewHint{position:absolute;left:0;right:0;bottom:0;padding:6px 10px;font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-primary-foreground);background:var(--dsw-alias-bg-mask-3)}
._dsbg_previewEmpty{position:absolute;top:0;right:0;bottom:0;left:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
/* 图库卡片：对齐 plugin-manager 的 cardHead/cardIcon 与 models 的 rowCard */
._dsbg_grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:8px}
._dsbg_card{box-sizing:border-box;display:flex;align-items:center;gap:12px;min-width:0;padding:10px 12px;border:.5px solid var(--dsw-alias-settings-card-stroke);border-radius:var(--dsw-radius-lg);background:var(--dsw-alias-settings-card-fill);cursor:pointer;text-align:left;font:inherit}
._dsbg_card:hover{background:var(--dsw-alias-interactive-bg-hover)}
._dsbg_card[data-active="true"]{border-color:var(--dsw-alias-brand-primary)}
._dsbg_cardThumb{flex:none;width:48px;height:48px;border:.5px solid var(--dsw-alias-border-l3);border-radius:var(--dsw-radius-md);overflow:hidden;background:var(--dsw-alias-bg-layer-2)}
._dsbg_cardThumb > img{width:100%;height:100%;object-fit:cover;display:block}
._dsbg_cardMain{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
._dsbg_cardTitle{color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
._dsbg_cardDesc{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px}
._dsbg_cardDelete{flex:none;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;font-size:16px;line-height:1}
._dsbg_cardDelete:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
._dsbg_empty{margin:0;color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:20px}
._dsbg_note{margin:0;font-size:12px;line-height:18px}
._dsbg_status{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;font-size:12px;line-height:18px}
._dsbg_statusKey{color:var(--dsw-alias-label-tertiary);white-space:nowrap}
._dsbg_statusValue{color:var(--dsw-alias-label-secondary);word-break:break-all}
._dsbg_statusBad{color:var(--dsw-alias-state-error-primary)}
._dsbg_footerAction{display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:var(--dsw-radius-sm);border:none;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer;padding:0}
._dsbg_footerAction:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
._dsbg_footerAction_on{color:var(--dsw-alias-brand-primary)}
`;

    /**
     * 创建（惰性）或返回本插件的样式表。
     * 先按标记复用已有节点，避免模块被重复加载（HMR）时堆叠出多张表。
     */
    function ensureStyleTag() {
      const existing = document.querySelectorAll('style[data-dsh-bg-css]');
      if (existing.length > 0) {
        for (let index = 1; index < existing.length; index += 1) existing[index].remove();
        return existing[0];
      }
      const tag = document.createElement('style');
      tag.setAttribute('data-dsh-bg-css', '@local/dsh-chat-background');
      document.head.appendChild(tag);
      return tag;
    }

    // ── 视口级图层与探测 ─────────────────────────────────────────────────────

    /** 惰性创建造型图层（纯像素，无交互内容）。 */
    function ensureLayers() {
      const make = (className, key) => {
        let node = document.querySelector('.' + className);
        if (node === null) {
          node = document.createElement('div');
          node.className = className;
          node.setAttribute('data-dsh-bg-layer', key);
          node.setAttribute('aria-hidden', 'true');
          document.body.appendChild(node);
        }
        return node;
      };
      make('_dsbg_veil', 'veil');
      make('_dsbg_veilChat', 'veil-chat');
    }

    /** 被本插件内联清掉背景的元素 -> 它们原来的内联背景值（停用/卸载时还原）。 */
    const clearedBackgrounds = new Map();

    /** 被本插件改过样式的输入框 -> 它原来的内联令牌与 backdrop 值（还原用）。 */
    const clearedComposer = new Map();

    /**
     * 真正的「列」容器。
     */
    /**
     * 按类名后缀找元素。DSH 的 CSS 模块哈希前缀每次构建都会变
     * （0.2.0-rc.2 是 BynINW_，0.2.1-rc.3 是 mP3x-q_），写死整串类名一旦对不上，
     * 就会静默退回几何兜底，进而算错浮窗位置、把错误的元素清成透明。
     * 这里用「属性子串 + 类名以 _后缀 结尾」双重判断，跨版本稳定。
     */
    function byClassSuffix(suffix) {
      try {
        const tail = new RegExp('_' + suffix + '$');
        const list = document.querySelectorAll('[class*="_' + suffix + '"]');
        for (let i = 0; i < list.length; i += 1) {
          const node = list[i];
          if (!(node instanceof HTMLElement)) continue;
          const names = node.classList;
          for (let k = 0; k < names.length; k += 1) {
            if (tail.test(names[k])) return node;
          }
        }
      } catch {
        /* 选择器异常时退回几何兜底 */
      }
      return null;
    }

    function resolveColumns() {
      const columns = {
        sidebar: byClassSuffix('sidebarCol'),
        chat: byClassSuffix('centerCol'),
      };
      let via = 'class';
      if (columns.sidebar === null || columns.chat === null) {
        via = 'geometry';
        const host = document.getElementById('root') ?? document.body;
        const rects = Array.from(host.querySelectorAll('div'))
          .map((node) => ({ node, rect: node.getBoundingClientRect() }))
          .filter((item) => item.rect.height > 0.6 * window.innerHeight && item.rect.width >= 150);
        const narrower = (best, item) => {
          if (best === null) return item;
          if (item.rect.left < best.rect.left - 1) return item;
          if (Math.abs(item.rect.left - best.rect.left) <= 1 && item.rect.width < best.rect.width - 1) return item;
          return best;
        };
        const sidebar = rects.reduce(narrower, null);
        if (sidebar !== null) {
          const right = rects.filter((item) => item !== sidebar && item.rect.left >= sidebar.rect.right - 2).reduce(narrower, null);
          columns.sidebar = columns.sidebar ?? sidebar.node;
          columns.chat = columns.chat ?? (right === null ? null : right.node);
        }
      }
      return { columns, via };
    }


    /** 还原本插件内联改过的列背景。 */
    function restoreColumnBackgrounds() {
      for (const [, saved] of clearedBackgrounds) {
        saved.node.style.backgroundColor = saved.prior;
        saved.node.style.backgroundImage = saved.priorImage;
        saved.node.style.backgroundSize = saved.priorSize;
        saved.node.style.backgroundPosition = saved.priorPosition;
        saved.node.style.backgroundAttachment = saved.priorAttachment;
        if (saved.priorBorderRight !== undefined) saved.node.style.borderRight = saved.priorBorderRight;
        if (saved.priorBorderLeft !== undefined) saved.node.style.borderLeft = saved.priorBorderLeft;
        saved.node.removeAttribute('data-dsh-bg-column');
      }
      clearedBackgrounds.clear();
    }

    /** 还原被本插件改过样式的输入框（令牌 + 磨砂），并释放记录。 */
    function restoreComposer() {
      for (const [, saved] of clearedComposer) {
        if (saved.token === '') saved.node.style.removeProperty('--dsw-specific-input-major');
        else saved.node.style.setProperty('--dsw-specific-input-major', saved.token);
        // 赋值前统一成字符串：读不到的原值可能是 undefined，直接写回会变成 "undefined"
        saved.node.style.backdropFilter = typeof saved.backdrop === 'string' ? saved.backdrop : '';
        saved.node.style.webkitBackdropFilter = typeof saved.webkitBackdrop === 'string' ? saved.webkitBackdrop : '';
      }
      clearedComposer.clear();
    }

    // ── 用量浮窗的数据层（纯函数，便于自检）─────────────────────────────────
    //
    // 数据来源只能是 conversation.composer.dock 座位注入的 useProjection：
    //   sessionStats   -> { turns, steps, llmMs, toolMs, ttftMs, ttftSteps, decodeMs, decodeTokens }
    //   tokenUsage     -> { uncachedInputTokens, cacheReadTokens, cacheWriteTokens, outputTokens }
    //   contextPressure-> 上下文占用（内置那个百分比环用的同一个投影）
    // 这三个键**不在** ctx.sessions 的公开服务里（faceOf 只认 inbox/modelSelection/plan/goal/
    // permissions/userQuestions），所以只能靠座位注入拿 —— 这也是这个功能必须做成
    // 槽位组件、而不能做成纯样式的原因。
    //
    // 下面两个算法**照抄内置 StatsPills**，不自己发明口径，保证数字与原面板永远一致。

    /** 计费输入 = 未缓存输入 + 缓存读取 + 缓存写入（三个互斥桶）。 */
    function billedInputTokens(usage) {
      if (usage === null || usage === undefined) return 0;
      const num = (value) => (typeof value === 'number' && isFinite(value) ? value : 0);
      return num(usage.uncachedInputTokens) + num(usage.cacheReadTokens) + num(usage.cacheWriteTokens);
    }

    /** 总用量 = 计费输入 + 输出。 */
    function totalTokens(usage) {
      if (usage === null || usage === undefined) return 0;
      const output = typeof usage.outputTokens === 'number' && isFinite(usage.outputTokens) ? usage.outputTokens : 0;
      return billedInputTokens(usage) + output;
    }

    /** 缓存命中率（整数百分比）；分母为 0 或缺失时返回 null，绝不返回 NaN。 */
    function cacheHitPercent(usage) {
      if (usage === null || usage === undefined) return null;
      const denominator = billedInputTokens(usage);
      if (denominator <= 0) return null;
      const read = typeof usage.cacheReadTokens === 'number' ? usage.cacheReadTokens : 0;
      return Math.min(100, Math.round((read / denominator) * 100));
    }

    /** 紧凑 token 数：365M / 12.3K / 987。 */
    function formatTokens(value) {
      if (typeof value !== 'number' || !isFinite(value) || value <= 0) return '0';
      if (value >= 1e6) return Math.round(value / 1e6) + 'M';
      if (value >= 1e3) return Math.round(value / 1e3) + 'K';
      return String(Math.round(value));
    }

    /** 输出速度：>=10 取整，否则保留一位小数；无解码时长时返回 null。 */
    function tokensPerSecond(stats) {
      if (stats === null || stats === undefined) return null;
      const ms = typeof stats.decodeMs === 'number' && isFinite(stats.decodeMs) ? stats.decodeMs : 0;
      const tokens = typeof stats.decodeTokens === 'number' && isFinite(stats.decodeTokens) ? stats.decodeTokens : 0;
      if (ms <= 0 || tokens <= 0) return null;
      const tps = tokens / (ms / 1e3);
      return tps >= 10 ? String(Math.round(tps)) : String(Math.round(tps * 10) / 10);
    }

    /**
     * 上下文占用百分比 —— **照抄内置 `contextOccupancy()` 的算法**。
     */
    function contextOccupancy(pressure) {
      if (pressure === null || pressure === undefined || typeof pressure !== 'object') return null;
      const usedTokens = pressure.projectedTokens ?? pressure.pressureTokens;
      if (typeof usedTokens !== 'number' || !isFinite(usedTokens)) return null;
      if (typeof pressure.contextWindow !== 'number' || !isFinite(pressure.contextWindow) || pressure.contextWindow <= 0) {
        return null;
      }
      return {
        percent: Math.min(100, Math.round((usedTokens / pressure.contextWindow) * 100)),
        usedTokens,
        contextWindow: pressure.contextWindow,
      };
    }

    /** 把投影值整理成一组"取不到就是 null"的展示项，缺值一律回落 null（界面显示 —）。 */
    function buildUsageView(projections) {
      const stats = projections.sessionStats ?? null;
      const usage = projections.tokenUsage ?? null;
      const context = contextOccupancy(projections.contextPressure);
      const total = totalTokens(usage);
      const hasUsage = usage !== null && total > 0;
      const num = (value) => (typeof value === 'number' && isFinite(value) ? value : null);
      return {
        hasUsage,
        total,
        totalText: hasUsage ? formatTokens(total) + ' tok' : null,
        turns: stats === null ? null : num(stats.turns),
        steps: stats === null ? null : num(stats.steps),
        speed: tokensPerSecond(stats),
        cacheHit: cacheHitPercent(usage),
        contextPercent: context === null ? null : context.percent,
        contextUsed: context === null ? null : context.usedTokens,
        contextWindow: context === null ? null : context.contextWindow,
        llmMs: stats === null ? null : num(stats.llmMs),
        toolMs: stats === null ? null : num(stats.toolMs),
      };
    }

    /** 毫秒 → 紧凑时长（与内置的显示口径一致：不足一分钟给秒，否则给 m分s秒）。 */
    function formatDuration(ms) {
      if (typeof ms !== 'number' || !isFinite(ms) || ms <= 0) return null;
      const seconds = ms / 1e3;
      if (seconds < 60) return (Math.round(seconds * 10) / 10) + 's';
      const whole = Math.round(seconds);
      return Math.floor(whole / 60) + 'm' + (whole % 60) + 's';
    }

    // ── 用量浮窗的拖动几何（全是纯函数，便于自检穷举）─────────────────────────
    //
    // 拖动这段没有浏览器我无法亲测手感，所以把**判定逻辑**全部抽成纯函数：
    // 输入指针位移与视口尺寸，输出"算不算点击 / 最终落在哪 / 卡片往哪个方向展开"。
    // 组件只负责把事件里的数字喂进来、把结果画出去。

    /** 超过这个位移就算拖动，不再算点击。 */
    const DRAG_THRESHOLD_PX = 4;
    /** 松手时距边缘在这个范围内就吸附过去。
     *
     * 从 24px 放宽到 80px（用户要求"吸附范围更大"）：不必精确拖到边上，
     * 离边缘还有一段距离松手也会归位 —— 靠边停放的常见手感。
     */
    const SNAP_THRESHOLD_PX = 80;
    /** 吸附后与边缘保留的间距。 */
    const SNAP_MARGIN_PX = 8;

    /** 一次指针交互是否算"点击"：位移不超过阈值才算。 */
    function isDragClick(maxDistance) {
      const distance = typeof maxDistance === 'number' && isFinite(maxDistance) ? maxDistance : 0;
      return distance <= DRAG_THRESHOLD_PX;
    }

    /**
     * 松手后的落点：先把按钮夹在视口内（留 8px，避免拖出屏幕找不回来），
     * 再对每条边单独判断吸附 —— 距边缘 ≤24px 吸到边，否则保持原位。
     * 左右吸 X、上下吸 Y，所以拖到角落可以同时吸两边。
     */
    function resolveDropPosition(pos, size, viewport, snap, topMin) {
      const shouldSnap = snap !== false;
      const width = size !== null && typeof size.width === 'number' ? size.width : 0;
      const height = size !== null && typeof size.height === 'number' ? size.height : 0;
      const vw = viewport !== null && typeof viewport.width === 'number' ? viewport.width : 0;
      const vh = viewport !== null && typeof viewport.height === 'number' ? viewport.height : 0;
      // 上界：默认 8px，但调用方会传"窗框底边"。窗口标题栏是系统拖动区
      // （-webkit-app-region: drag），元素落在那儿点不着也拖不动（拖动会变成拖窗口）。
      // 用户实测：按钮停在 sit=…,8 上，症状正是"根本没法拖，一拖就拖动窗口"。
      const minTop =
        typeof topMin === 'number' && isFinite(topMin) && topMin > SNAP_MARGIN_PX ? Math.round(topMin) : SNAP_MARGIN_PX;
      const clamp = (value, min, max) => (max < min ? min : Math.max(min, Math.min(max, value)));
      const finite = (value) => (typeof value === 'number' && isFinite(value) ? value : 0);
      // 1) 先夹进可见区（上界用 minTop）
      let x = clamp(Math.round(finite(pos.x)), SNAP_MARGIN_PX, Math.max(SNAP_MARGIN_PX, vw - width - SNAP_MARGIN_PX));
      let y = clamp(Math.round(finite(pos.y)), minTop, Math.max(minTop, vh - height - SNAP_MARGIN_PX));
      // 2) 再逐边判断吸附（用夹取后的位置，否则会吸出一个出屏的结果）
      if (shouldSnap) {
        if (x <= SNAP_THRESHOLD_PX) x = SNAP_MARGIN_PX;
        else if (vw - (x + width) <= SNAP_THRESHOLD_PX) x = Math.max(SNAP_MARGIN_PX, vw - width - SNAP_MARGIN_PX);
        // 上边吸附同样要避开标题栏：吸到"上边"= 吸到 minTop，而不是 8
        if (y <= minTop + SNAP_THRESHOLD_PX) y = minTop;
        else if (vh - (y + height) <= SNAP_THRESHOLD_PX) y = Math.max(minTop, vh - height - SNAP_MARGIN_PX);
      }
      return { x, y };
    }

    /**
     * 按钮允许到达的最高位置（避开窗口标题栏）。
     * 标题栏那条拖动区是 布局 frame 类的 ::before **伪元素**，量元素几何拿不到它 ——
     * 早先 querySelector 找窗框、找不到就回落 8px，等于没修（用户实测按钮停在 y=8）。
     * 现在读 --dsh-windows-titlebar-height，读不到用本常量兜底。
     */
    const TITLEBAR_MIN_TOP = 48;
    function frameTopInset() {
      try {
        const probe = window.getComputedStyle(document.documentElement);
        const raw = String(probe.getPropertyValue('--dsh-windows-titlebar-height') || '').trim();
        const parsed = parseFloat(raw);
        // 只接受"看起来像标题栏高度"的值，其余一律用常量兜底
        if (isFinite(parsed) && parsed > 0 && parsed < 120) return Math.round(parsed) + SNAP_MARGIN_PX;
      } catch {
        /* 用常量兜底 */
      }
      return TITLEBAR_MIN_TOP;
    }

    /**
     * 展开方向：卡片从按钮原位长出来，而不是固定贴在右下角。
     *   右半屏 → 卡片向左上（右下角对齐按钮右上角）
     *   左半屏 → 卡片向右上（左下角对齐按钮左上角）
     *   贴顶时改为向下（否则卡片会顶出屏幕）
     * 返回的是卡片的定位方式与坐标，组件直接照抄成 inline 样式。
     */
    function resolveCardPlacement(buttonRect, viewport) {
      const right = buttonRect.x + buttonRect.width / 2 > viewport.width / 2;
      const below = buttonRect.y < viewport.height * 0.35;
      const style = { position: 'fixed' };
      if (right) style.right = Math.max(SNAP_MARGIN_PX, Math.round(viewport.width - (buttonRect.x + buttonRect.width))) + 'px';
      else style.left = Math.max(SNAP_MARGIN_PX, Math.round(buttonRect.x)) + 'px';
      if (below) style.top = Math.round(buttonRect.y + buttonRect.height + 8) + 'px';
      else style.bottom = Math.max(SNAP_MARGIN_PX, Math.round(viewport.height - buttonRect.y) + 8) + 'px';
      return { alignRight: right, below, style };
    }

    /**
     * 段底用的颜色：内置"行内代码底色"令牌的实色。
     */
    function textFillRgb() {
      const parse = (color) => {
        const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/.exec(String(color).trim());
        if (match === null) return null;
        return [Math.round(Number(match[1])), Math.round(Number(match[2])), Math.round(Number(match[3]))];
      };
      try {
        const probe = window.getComputedStyle(document.documentElement);
        const fromToken = parse(probe.getPropertyValue('--dsw-alias-markdown-inline-code'));
        if (fromToken !== null) return fromToken;
      } catch {
        /* 落到主题底色 */
      }
      return themeRgb();
    }

    /** 段底颜色的 rgb 分量。 */
    function textFillRgbTriple() {
      const rgb = textFillRgb();
      return rgb[0] + ', ' + rgb[1] + ', ' + rgb[2];
    }

    /**
     * 浮窗用的**不透明**底色。
     */
    function cardFillRgbTriple() {
      const rgb = themeRgb();
      return rgb[0] + ', ' + rgb[1] + ', ' + rgb[2];
    }

    /**
     * 压暗层的颜色：从真实渲染结果里采样，而不是猜主题。
     * 坑：早先读 --dsw-alias-bg-layer-* 令牌，那些只定义在 body 上、常读回空串，
     * 于是落到兜底的深色 [21,21,23] → 浅色主题也铺深色纱（用户报"左拉变暗"）。
     * **刻意不缓存**：曾缓存过一次，首次绘制早于主题属性就位，之后整场都错。
     */
    function themeRgb() {
      const parse = (color) => {
        const text = String(color).trim();
        const match = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?/.exec(text);
        if (match === null) return null;
        const alpha = match[4] === undefined ? 1 : Number(match[4]);
        if (alpha < 0.6) return null;
        return [Math.round(Number(match[1])), Math.round(Number(match[2])), Math.round(Number(match[3]))];
      };
      let rgb = null;
      try {
        // 从 <html> 开始往上找（**跳过 body**）：body 自己的背景常被本插件改成透明，
        // 读它只会读到我们刚写进去的东西，得不到主题底色。
        let node = document.documentElement;
        let depth = 0;
        while (node !== null && node !== undefined && depth < 8) {
          const candidate = parse(window.getComputedStyle(node).backgroundColor);
          if (candidate !== null) {
            rgb = candidate;
            break;
          }
          node = node.parentElement ?? null;
          depth += 1;
        }
        if (rgb === null) {
          // 全都很透明：按主题属性给一个明确值
          rgb = document.body.hasAttribute('data-ds-dark-theme') ? [21, 21, 23] : [249, 249, 249];
        }
      } catch {
        rgb = [249, 249, 249];
      }
      return rgb;
    }

    /** 压暗层的 rgb 分量（形如 "249, 249, 249"）。 */
    function veilRgb() {
      const rgb = themeRgb();
      return rgb[0] + ', ' + rgb[1] + ', ' + rgb[2];
    }

    /**
     * 打上列标记，并把会话区左边界写进 CSS 变量（会话区那层纱靠它定位）。
     */
    function detectRegions() {
      const { columns } = resolveColumns();
      if (columns.sidebar !== null) columns.sidebar.setAttribute('data-dsh-bg-sidebar', '');
      if (columns.chat !== null) columns.chat.setAttribute('data-dsh-bg-chat', '');
      const chatRect = columns.chat === null ? null : columns.chat.getBoundingClientRect();
      if (chatRect !== null) {
        document.documentElement.style.setProperty('--dsh-chat-left', Math.round(chatRect.left) + 'px');
      }
    }

    /**
     * 立即重画全部视觉：body 壁纸 + 两个列的压暗层，并决定就绪闸门。
     */
    function paintAll() {
      const settings = state;
      const bodyNode = typeof document.body === 'object' && document.body !== null ? document.body : null;

      // 1) body 壁纸（整窗覆盖）
      if (bodyNode !== null) {
        if (!clearedBackgrounds.has(bodyNode)) {
          clearedBackgrounds.set(bodyNode, {
            node: bodyNode,
            prior: bodyNode.style.backgroundColor,
            priorImage: bodyNode.style.backgroundImage,
            priorSize: bodyNode.style.backgroundSize,
            priorPosition: bodyNode.style.backgroundPosition,
            priorAttachment: bodyNode.style.backgroundAttachment,
          });
        }
        if (settings.enabled && currentImageUrl !== null) {
          // 壁纸只占 body 的**单层**背景 —— 这一条已被实测证明有效（用户看得见壁纸）。
          // 压暗层不再挤进这个属性：早先写成 `url(...), linear-gradient(...)` 两层，
          // 结果整条声明在真实页面里失效（压暗层完全不可见），而单层一直正常。
          bodyNode.style.backgroundImage = `url("${currentImageUrl}")`;
          bodyNode.style.backgroundSize = 'cover';
          bodyNode.style.backgroundPosition = settings.posX + '% ' + settings.posY + '%';
          bodyNode.style.backgroundAttachment = 'fixed';
          bodyNode.style.backgroundRepeat = 'no-repeat';
          bodyNode.style.backgroundColor = 'transparent';
        } else {
          bodyNode.style.backgroundImage = '';
          bodyNode.style.backgroundColor = clearedBackgrounds.get(bodyNode).prior;
        }
      }

      const painted = bodyNode !== null && bodyNode.style.backgroundImage.indexOf('url') !== -1;
      diagnostics.columnsPainted = painted;
      diagnostics.columnError =
        settings.enabled && currentImageUrl !== null && !painted ? 'body:style-rejected' : null;

      // 2) 压暗层（+可选磨砂）：两个独立的固定覆盖层，不参与 body 的 background-image。
      //    整窗一层 + 侧栏再叠一层，所以侧栏必定比会话区更"实"（同一颜色叠两次，alpha 更高）。
      //
      //    方向：滑杆是「壁纸亮度」—— 越往右壁纸越亮、纱越薄。
      //    旧版滑杆控的是「压暗层浓度」，方向相反，用户拉到底只会更暗，已按直觉翻正。
      const veilNode = document.querySelector('._dsbg_veil');
      const chatVeilNode = document.querySelector('._dsbg_veilChat');
      if (veilNode !== null && chatVeilNode !== null) {
        if (settings.enabled && currentImageUrl !== null) {
          const brightness = clamp(settings.wallpaperBrightness, 0, 1);
          const alpha = Math.round(VEIL_MAX_ALPHA * (1 - brightness) * 100) / 100;
          const color = `rgba(${veilRgb()}, ${alpha})`;
          const blur = clamp(settings.frostStrength, 0, 30);
          const backdrop = blur > 0 ? `blur(${Math.round(blur)}px)` : 'none';

          veilNode.style.backgroundColor = color;
          // 磨砂：backdrop-filter 只糊这层背后的壁纸，界面文字不受影响
          veilNode.style.backdropFilter = backdrop;
          veilNode.style.webkitBackdropFilter = backdrop;
          veilNode.style.display = 'block';

          // 会话区那层（chatFillAlpha 已锁为 0，平时不显示）
          const chatAlpha = Math.round(clamp(settings.chatFillAlpha, 0, 1) * 100) / 100;
          if (chatAlpha > 0) {
            chatVeilNode.style.backgroundColor = `rgba(${veilRgb()}, ${chatAlpha})`;
            const chatBackdrop = settings.chatFillFrost && blur > 0 ? `blur(${Math.round(blur)}px)` : 'none';
            chatVeilNode.style.backdropFilter = chatBackdrop;
            chatVeilNode.style.webkitBackdropFilter = chatBackdrop;
            chatVeilNode.style.display = 'block';
            diagnostics.chatFillLive = `rgba(${veilRgb()}, ${chatAlpha}) frost=${chatBackdrop}`;
          } else {
            chatVeilNode.style.display = 'none';
            diagnostics.chatFillLive = 'off';
          }
          diagnostics.veilLive = 'global=' + color + ' backdrop=' + backdrop;
        } else {
          veilNode.style.backgroundColor = 'transparent';
          veilNode.style.backdropFilter = 'none';
          veilNode.style.webkitBackdropFilter = 'none';
          veilNode.style.display = 'none';
          chatVeilNode.style.display = 'none';
        }
      }

      // 3) 输入框（[data-composer-card]）：透明 + 磨砂。
      //    关键是**只在这一个元素上**覆盖 --dsw-specific-input-major ——
      //    它还有 10 处别的使用者（设置里的卡片、图片预览、账号提示…），
      //    全局透明化会把它们一起弄透明（就是"设置面板被穿透"那类事故）。
      const composerNode = document.querySelector('[data-composer-card]');
      if (composerNode !== null) {
        if (!clearedComposer.has(composerNode)) {
          clearedComposer.set(composerNode, {
            node: composerNode,
            token: composerNode.style.getPropertyValue('--dsw-specific-input-major'),
            backdrop: composerNode.style.backdropFilter,
            webkitBackdrop: composerNode.style.webkitBackdropFilter,
          });
        }
        const alpha = Math.round(clamp(settings.composerOpacity, 0, 1) * 100) / 100;
        if (settings.enabled && currentImageUrl !== null && alpha > 0) {
          const solid = `rgba(${veilRgb()}, ${alpha})`;
          // 在该元素上重定义令牌 → 卡片自身、以及卡片内所有用该令牌的东西一起变半透明
          composerNode.style.setProperty('--dsw-specific-input-major', solid);
          const frost = clamp(settings.composerFrost, 0, 30);
          const backdrop = frost > 0 ? `blur(${Math.round(frost)}px)` : 'none';
          composerNode.style.backdropFilter = backdrop;
          composerNode.style.webkitBackdropFilter = backdrop;
          diagnostics.composerLive = 'token=' + solid + ' backdrop=' + backdrop;
        } else {
          const prior = clearedComposer.get(composerNode);
          if (prior.token === '') composerNode.style.removeProperty('--dsw-specific-input-major');
          else composerNode.style.setProperty('--dsw-specific-input-major', prior.token);
          composerNode.style.backdropFilter = typeof prior.backdrop === 'string' ? prior.backdrop : '';
          composerNode.style.webkitBackdropFilter = typeof prior.webkitBackdrop === 'string' ? prior.webkitBackdrop : '';
          diagnostics.composerLive = 'off';
        }
      } else {
        diagnostics.composerLive = 'missing';
      }

      // 4) 用量浮窗的两件事：是否隐藏内置统计行、按钮的贴边位置。
      //    按钮位置按对话区右边界算，这样它贴在**内容区**右侧而不是窗口右侧。
      //    「隐藏内置行」以「浮窗确实开着」为前提 —— 否则关掉浮窗又留着隐藏，
      //    就会两边都没有（既没浮窗也没原状态行）。
      if (bodyNode !== null) {
        const replacesBuiltin = settings.enabled && settings.usagePanel && settings.usageHideBuiltin;
        if (replacesBuiltin) bodyNode.setAttribute('data-dsh-bg-usage', 'hide');
        else bodyNode.removeAttribute('data-dsh-bg-usage');
      }
      {
        const chatRect = (() => {
          const node = resolveColumns().columns.chat;
          if (node === null || node === undefined) return null;
          try {
            return node.getBoundingClientRect();
          } catch {
            return null;
          }
        })();
        const root = document.documentElement.style;
        // 26px 让按钮离内容区右边缘留一点呼吸；视口太窄时退到 16px，避免贴出屏幕
        const right = chatRect === null ? null : Math.max(16, Math.round(window.innerWidth - chatRect.right) + 26);
        root.setProperty('--dsh-usage-right', (right === null ? 26 : right) + 'px');
        // 按钮底边到视口底部的距离：留出输入框卡片的高度，所以按钮浮在它上方
        root.setProperty('--dsh-usage-bottom', '132px');
        diagnostics.usageLive =
          'panel=' + (settings.usagePanel ? 'on' : 'off') +
          ' hideBuiltin=' + (settings.usageHideBuiltin ? 'on' : 'off') +
          ' right=' + (right === null ? 'fallback' : right + 'px');
      }

      // 2) 两个列只需"变透明"：壁纸与压暗层都在 body 上，列透明后自然透上来。
      //    列自己不再铺任何图层 —— 元素背景画在自己子元素之下，铺了也会被自己的内容盖住。
      const { columns, via } = resolveColumns();
      diagnostics.columnMatch = via;
      diagnostics.sidebarFound = columns.sidebar !== null && columns.sidebar !== undefined;
      diagnostics.chatFound = columns.chat !== null && columns.chat !== undefined;
      for (const key of ['sidebar', 'chat']) {
        const node = columns[key];
        if (node === null || node === undefined) continue;
        if (!clearedBackgrounds.has(node)) {
          clearedBackgrounds.set(node, {
            node,
            prior: node.style.backgroundColor,
            priorImage: node.style.backgroundImage,
            priorSize: node.style.backgroundSize,
            priorPosition: node.style.backgroundPosition,
            priorAttachment: node.style.backgroundAttachment,
            priorBorderRight: node.style.borderRight,
            priorBorderLeft: node.style.borderLeft,
          });
        }
        if (settings.enabled && currentImageUrl !== null) {
          node.style.backgroundColor = 'transparent';
          node.style.backgroundImage = 'none';
          // 内置给侧栏列画了 0.5px 分隔线：壁纸统一时它就是唯一可见的"接缝"，去掉
          node.style.borderRight = 'none';
          node.style.borderLeft = 'none';
          node.setAttribute('data-dsh-bg-column', key);
        } else {
          node.removeAttribute('data-dsh-bg-column');
        }
      }
      diagnostics.columnsCleared =
        diagnostics.sidebarFound &&
        diagnostics.chatFound &&
        columns.sidebar.getAttribute('data-dsh-bg-column') === 'sidebar' &&
        columns.chat.getAttribute('data-dsh-bg-column') === 'chat';

      // 3) 就绪闸门：只有壁纸确实写上去了，才放开底色令牌
      if (bodyNode !== null) {
        if (settings.enabled && currentImageUrl !== null) {
          bodyNode.setAttribute('data-dsh-bg', painted ? 'ready' : 'pending');
          // 次要文字改用主色：壁纸真的画上去了才开，否则白白改掉主题层次
          if (painted && settings.labelBoost) bodyNode.setAttribute('data-dsh-bg-label', 'on');
          else bodyNode.removeAttribute('data-dsh-bg-label');
        } else {
          bodyNode.removeAttribute('data-dsh-bg');
          bodyNode.removeAttribute('data-dsh-bg-label');
        }
      }
      refreshStyleChecks();

      // 4) 几何仍交给探测定时器（列的位置只在布局变化时才会变）
      scheduleDetect(false);
    }

    let detectTimer = null;
    let detectTries = 0;
    function scheduleDetect(retry) {
      if (detectTimer !== null) window.clearTimeout(detectTimer);
      if (retry === true) detectTries = 8;
      detectTimer = window.setTimeout(() => {
        detectTimer = null;
        detectRegions();
        // 应用外壳可能比插件晚挂载；前几秒内多试几次，超出后交给 resize 事件。
        if (detectTries > 0 && document.querySelector('[data-dsh-bg-sidebar]') === null) {
          detectTries -= 1;
          scheduleDetect(false);
        }
      }, 150);
    }

    // ── 视觉应用 ─────────────────────────────────────────────────────────────

    let lastImageId = Symbol('none');
    let currentImageUrl = null;

    /**
     * 设置一变就立刻重画（同步、无防抖）。
     * 拖动滑杆时每一帧都会走到这里，所以视觉必须在这里就位 —— 不能只交给探测定时器。
     */
    function applyVisuals() {
      const settings = state;
      // 预览卡要与真实壁纸用同一套缩放/取景，所以这两个变量写在根上
      const css = document.documentElement.style;
      css.setProperty('--dsh-bg-zoom', settings.fit === 'contain' ? 'contain' : 'cover');
      css.setProperty('--dsh-bg-focus', settings.posX + '% ' + settings.posY + '%');
      // 文字底纱：同元素上写内联，inline 胜出样式表里的默认值。
      // **改由输入框那两个滑杆控制**（用户要求）：
      //   浓度 ← composerOpacity（输入框不透明度）
      //   磨砂 ← composerFrost（输入框磨砂）
      // 这样两个控件同时管"输入框"和"文字底纱"，少两行设置、也不必再对齐两组值。
      const textAlpha = Math.round(clamp(settings.composerOpacity, 0, 1) * 100) / 100;
      css.setProperty('--dsh-bg-text-rgb', textFillRgbTriple());
      // 浮窗用**不透明**底色：取悬停用的主题底色实色（浅色主题是近白、深色主题是深灰）。
      // 刻意与底纱分开成另一个变量 —— 收起态按钮要继续用半透明的底纱。
      css.setProperty('--dsh-bg-card-rgb', cardFillRgbTriple());
      css.setProperty('--dsh-bg-text-alpha', String(textAlpha));
      css.setProperty('--dsh-bg-text-blur', Math.round(clamp(settings.composerFrost, 0, 30)) + 'px');
      if (typeof document.body === 'object' && document.body !== null) {
        if (settings.enabled && currentImageUrl !== null && textAlpha > 0) {
          document.body.setAttribute('data-dsh-bg-text', 'on');
        } else {
          document.body.removeAttribute('data-dsh-bg-text');
        }
      }
      // 底纱的浓度与磨砂都来自输入框那两个滑杆，所以诊断也照它们报
      diagnostics.textFillLive = 'alpha=' + textAlpha + (settings.composerFrost > 0 ? ' frost=on' : ' frost=off');
      // 壁纸 + 两列压暗层 + 就绪闸门，一次性同步画完
      paintAll();
      // 外壳可能刚挂载或换了布局，几何交给探测定时器兜底
      scheduleDetect(true);
    }

    
    /** 载入当前图片并刷新视觉；找不到图片时自动关闭总开关。 */
    async function syncActiveImage() {
      const id = state.activeId;
      if (id === null) {
        currentImageUrl = null;
        lastImageId = null;
        applyVisuals();
        return;
      }
      if (lastImageId === id && currentImageUrl !== null) return;
      let url = null;
      try {
        // object URL：短引用、无长度上限、不重编码，图片字节保持原始
        url = await ensureImageUrl(id);
        diagnostics.activeError = null;
      } catch (error) {
        url = null;
        diagnostics.activeError = String(error?.message ?? error);
      }
      if (url === null) {
        // 图片被删除或数据库不可用：不要留下一个「开着却没图」的状态。
        if (state.activeId === id) update({ activeId: null, enabled: false });
        return;
      }
      currentImageUrl = url;
      lastImageId = id;
      applyVisuals();
    }

    /**
     * 运行状态记录。设置页把它显示出来，这样「没显示图片」时不必开控制台猜：
     * 每一项都能指出是哪一环没走通。
     */
    const diagnostics = {
      activeError: null,
      /** 当前图片 data URL 的字符数（浏览器对超长背景图会整条拒绝）。 */
      imageUrlLength: 0,
      /** 样式表是否真的生效（读一个只有本插件才会写的变量）。 */
      stylesheetLive: false,
      /** 底色令牌是否真的被放开（只在 data-dsh-bg="ready" 时才该为真）。 */
      tokensNeutralised: false,
      /** 列容器是靠类名找到的，还是退回几何启发式。 */
      columnMatch: null,
      /** 是否找到了侧栏列 / 会话列（upgrade 改名时会变成 false）。 */
      sidebarFound: false,
      chatFound: false,
      /** 两个列容器是否都已打上标记。 */
      columnsCleared: false,
      /** 两个列容器的内联背景里是否真的带上了图片 url()。 */
      columnsPainted: false,
      /** 压暗层实际写进去的颜色值（能直接看出滑杆有没有生效）。 */
      veilLive: '',
      /** 会话区那层纱的实况。 */
      chatFillLive: '',
      /** 文字底纱的实况。 */
      textFillLive: '',
      /** 输入框（透明+磨砂）的实况。 */
      composerLive: '',
      /** 用量浮窗的实况：开关、贴边、以及**上一次拖动的实测数字**（诊断拖动问题用）。 */
      usageLive: '',
      usageDragLive: '',
      /**
       * 这里**刻意不放**"被隐藏的内置元素数"。
       */
      /** 清列背景时遇到的异常（元素不可写等）。 */
      columnError: null,
      /**
       * 本插件自身抛出的异常（最近若干条）。
       */
      pluginErrors: [],
    };

    /** 记一条本插件的异常（带时间与出错位置），最多保留 10 条。 */
    function recordPluginError(kind, error) {
      try {
        const where = String((error && error.stack) || '').split('\n').slice(0, 3).join(' ⏎ ');
        const entry = new Date().toISOString().slice(11, 19) + ' [' + kind + '] ' +
          String(error && error.message ? error.message : error) + ' @ ' + where;
        diagnostics.pluginErrors.push(entry);
        if (diagnostics.pluginErrors.length > 10) diagnostics.pluginErrors.shift();
      } catch {
        /* 记录本身失败就算了 */
      }
    }

    /**
     * 出错位置是否**确实**属于本插件。
     */
    function isPluginError(error) {
      try {
        const stack = String((error && error.stack) || '');
        if (stack === '') return false;
        const mine =
          stack.indexOf('dsh-chat-background') !== -1 || stack.indexOf('@local/dsh-chat-background') !== -1;
        if (!mine) return false;
        // 应用内置插件脚本一律不算（它们的路径也含 client.js，正是上一版误判的来源）
        if (stack.indexOf('dsh-app://') !== -1 && stack.indexOf('@local/') === -1) return false;
        return true;
      } catch {
        return false;
      }
    }

    /** 读回真实计算值，确认每一步确实落地了（而不是只写进了 DOM 属性）。 */
    function refreshStyleChecks() {
      try {
        const rootStyle = window.getComputedStyle(document.documentElement);
        // 判据用 --dsh-bg-zoom：它由 applyVisuals 每次都写，且只可能来自本插件的样式表
        diagnostics.stylesheetLive = String(rootStyle.getPropertyValue('--dsh-bg-zoom')).trim() !== '';
        const bodyStyle = window.getComputedStyle(document.body);
        const base = String(bodyStyle.getPropertyValue('--dsw-alias-bg-base')).trim();
        // 只有 data-dsh-bg="ready" 时令牌才该是透明的；pending 表示闸门在拦（画图未成功）
        const armed = document.body.getAttribute('data-dsh-bg') === 'ready';
        diagnostics.tokensNeutralised = armed && (base === 'transparent' || base === 'rgba(0, 0, 0, 0)');
        diagnostics.imageUrlLength = currentImageUrl === null ? 0 : currentImageUrl.length;
      } catch {
        diagnostics.stylesheetLive = false;
        diagnostics.tokensNeutralised = false;
      }
    }

    // ── 开关的自愈逻辑 ───────────────────────────────────────────────────────

    /** 图库变化后通知设置页重新拉取列表（也用于开关自愈后刷新）。 */
    const libraryListeners = new Set();
    function bumpLibrary() {
      for (const listener of Array.from(libraryListeners)) listener();
    }

    /**
     * 打开总开关。
     */
    async function enableBackground() {
      if (state.activeId === null || currentImageUrl === null) {
        let records = [];
        try {
          records = await dbAll();
        } catch (error) {
          diagnostics.activeError = String(error?.message ?? error);
          records = [];
        }
        if (records.length === 0) {
          diagnostics.activeError = '图库为空：请先选择一张本地图片';
          return false;
        }
        const chosen = records.slice().sort((a, b) => b.addedAt - a.addedAt)[0];
        update({ activeId: chosen.id, enabled: true });
        await syncActiveImage();
        bumpLibrary();
        return true;
      }
      update({ enabled: true });
      await syncActiveImage();
      return true;
    }

    /** 侧栏快捷开关：开着就关；关着就走 enableBackground（含自愈）。 */
    function toggleBackground() {
      if (state.enabled) {
        update({ enabled: false });
        return;
      }
      void enableBackground();
    }

    // ── React 绑定 ───────────────────────────────────────────────────────────

    function useSettings() {
      return React.useSyncExternalStore(store.subscribe, store.get, store.get);
    }

    /**
     * 每个已挂载组件实例的**跨渲染**小状态（记账对象 + DOM 引用）。
     */
    const usageInstances = new WeakMap();
    function usageInstance(key) {
      const stableKey = key !== null && typeof key === 'object' ? key : {};
      if (!usageInstances.has(stableKey)) {
        usageInstances.set(stableKey, {
          gesture: {
            startX: 0,
            startY: 0,
            originX: 0,
            originY: 0,
            maxDistance: 0,
            active: false,
            pos: null,
            suppressClick: false,
            width: 0,
            height: 0,
            grabX: 0,
            grabY: 0,
          },
          root: { current: null },
          button: { current: null },
          /**
           * 拖动中的位置：**渲染与落点共用这一个来源**。
           */
          dragPos: null,
        });
      }
      return usageInstances.get(stableKey);
    }

    /**
     * 被本插件隐藏的内置统计元素 → 它们原来的内联 display（停用/卸载时逐字还原）。
     */
    const hiddenSiblings = new Map();
    function restoreHiddenSiblings() {
      for (const [node, prior] of hiddenSiblings) {
        if (node !== null && node !== undefined && node.style !== undefined) {
          node.style.display = typeof prior === 'string' ? prior : '';
        }
      }
      hiddenSiblings.clear();
    }

    /** 高度超过这个值的兄弟元素视为"界面区块"，一律不隐藏（宁可漏隐藏也不误伤）。 */
    /** 往上最多扫几层祖先。 */
    const HIDE_MAX_DEPTH = 3;
    /** 允许清单的高度上限：统计药丸 / 占用环都在这个量级。 */
    const HIDE_ALLOW_MAX_HEIGHT_PX = 48;

    /**
     * 找出应隐藏的内置统计元素：从 `root` 往上逐层看兄弟。
     * 必须往上扫多层（槽位外包着 SlotOutlet，占用环在再上一层）；
     * 也**不能"隐藏到东西就停"** —— 药丸在第一层、占用环在第二层，提前收手会漏（自检抓到过）。
     */
    function findBuiltinStatsToHide(root, maxDepth) {
      const depthLimit = typeof maxDepth === 'number' && maxDepth > 0 ? maxDepth : HIDE_MAX_DEPTH;
      const targets = [];
      if (root === null || root === undefined) return targets;
      let node = root;
      for (let depth = 0; depth < depthLimit; depth += 1) {
        const parent = node.parentElement;
        if (parent === null || parent === undefined) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) continue;
          if (isHideableStatNode(sibling)) targets.push(sibling);
        }
        node = parent;
      }
      return targets;
    }

    /**
     * 单个元素是否属于"可以隐藏的内置统计"——**允许清单**判据。
     */
    function isHideableStatNode(node) {
      if (node === null || node === undefined || node.style === undefined) return false;
      try {
        const className = String(node.className ?? '');
        // 编辑区 / 卡片 / 通知 / 滚动容器一律放过
        if (/(_input|_editor|_card|_notice|_scroll|_composer)/.test(className)) return false;
        if (typeof node.hasAttribute === 'function') {
          if (node.hasAttribute('contenteditable')) return false;
          if (node.hasAttribute('data-composer-card')) return false;
        }
        // 内含可编辑区或对话框卡片的一律放过
        if (typeof node.querySelector === 'function') {
          if (node.querySelector('textarea, [contenteditable="true"], [data-composer-card]') !== null) return false;
        }
        // 必须能量到尺寸，且必须是矮条（药丸 / 占用环都是这个量级）。
        // 量不到尺寸（height 为 0）时判为"不动它" —— 对话框容器正是这种情况。
        if (typeof node.getBoundingClientRect !== 'function') return false;
        const rect = node.getBoundingClientRect();
        if (!(rect.height > 0) || rect.height > HIDE_ALLOW_MAX_HEIGHT_PX) return false;
        return true;
      } catch {
        return false; // 任何异常都不隐藏
      }
    }

    /**
     * 用量浮窗：收起态是一枚淡色小按钮（写实时总用量），点开是一块磨砂卡片。
     */
    function UsagePanel(props) {
      const settings = useSettings();
      // 翻译座位：优先用插槽传进来的 t；没有就退回本地字典（dock 座位不保证注入 t）
      const t = typeof props?.t === 'function' ? props.t : (key) => ZH[key] ?? key;
      const useProjection = props !== null && typeof props.useProjection === 'function' ? props.useProjection : null;
      const canState = typeof React.useState === 'function';
      const canEffect = typeof React.useEffect === 'function';
      // hook 必须无条件按同一顺序调用：先算好两个"永远会调用"的 hook，再谈条件
      const read = (key) => {
        if (useProjection === null) return null;
        try {
          const value = useProjection(key);
          return value === undefined ? null : value;
        } catch {
          return null;
        }
      };
      const projections = {
        sessionStats: read('sessionStats'),
        tokenUsage: read('tokenUsage'),
        contextPressure: read('contextPressure'),
      };
      const view = buildUsageView(projections);
      const state = canState ? React.useState(false) : [false, () => {}];
      const open = state[0];
      const setOpen = state[1];
      // 每个挂载实例的跨渲染状态：DOM 引用与拖动记账都在里面
      // （不能在这里新建 { current: null } —— 每次渲染都会换新对象，引用的节点会丢）
      const instance = usageInstance(props);
      const rootRef = instance.root;
      const buttonRef = instance.button;
      const gesture = instance.gesture;
      // 拖动位置：唯一来源在 instance.dragPos（可变），state 只用来触发重渲染
      const dragTickState = canState ? React.useState(0) : [0, () => {}];
      const bumpDrag = dragTickState[1];
      const setDragPos = (value) => {
        instance.dragPos = value;
        bumpDrag((tick) => tick + 1);
      };
      const dragPos = instance.dragPos;

      /** 视口尺寸；拿不到时给一个保守值，绝不让几何计算拿到 undefined。 */
      const viewport = () => ({
        width: typeof window.innerWidth === 'number' ? window.innerWidth : 1280,        height: typeof window.innerHeight === 'number' ? window.innerHeight : 720,
      });

      /**
       * 按钮的像素尺寸。
       */
      const measureButton = () => {
        const node = buttonRef.current;
        if (node === null || node === undefined || typeof node.getBoundingClientRect !== 'function') return null;
        const size = node.getBoundingClientRect();
        const width = Math.round(size.width);
        const height = Math.round(size.height);
        if (!(width > 0) || !(height > 0)) return null;
        return { width, height };
      };

      /** 按钮当前矩形：拖动中优先用 state 里的位置，否则用持久化位置或默认位置。 */
      const buttonRect = () => {
        const size = measureButton();
        // 首帧量不到尺寸（元素还没挂载）时用**估计值**，而不是 0：
        // 用 0 会把默认位置算到窗口右边缘之外，把按钮送到标题栏上 ——
        // 用户实测的后果是"根本没法拖，一拖就拖动窗口"。
        // 估计值只影响第一帧的默认坐标；挂载后 measureButton() 立刻给出真值，
        // 由于两次都用同一个停靠距离，位置不会跳动。
        const estimated = size === null;
        const width = estimated ? 56 : size.width;
        const height = estimated ? 22 : size.height;
        const vp = viewport();
        // 拖动中的位置用 state（dragPos）；静止时用存档位置；都没有则算默认位置。
        // **全程只用 left/top**：默认位置也在这里换算成 left/top 绝对坐标。
        // 混用 right/bottom 会让"内联 left/top"和"样式表 right/bottom"同时生效，
        // 元素被挤到左上角、而读回来的却是内联值 —— 实测就是"一拖就瞬移到左上角"。
        //
        // 另外：存档值若落在标题栏带内，说明它是早先几个 bug 写坏的坐标
        // （用户实测被存成 `y=8`），此时**直接改用默认位置**而不是把它夹到标题栏下沿 ——
        // 夹取只能让按钮"勉强可用"，而它的原意本来就不该在那一带。
        const savedPos = settings.usagePanelPos;
        const savedLooksBroken =
          savedPos !== null &&
          savedPos !== undefined &&
          (savedPos.y <= TITLEBAR_MIN_TOP || savedPos.y > vp.height || savedPos.x > vp.width);
        const pos = dragPos ?? (savedLooksBroken ? null : savedPos);
        if (pos === null || pos === undefined) {
          // 默认位置：贴对话区内容区右侧、输入框上方，距离由 paintAll 写进 CSS 变量。
          // 整体兜底，取不到就用保守值，绝不让几何计算拿到 NaN。
          let rightPx = 26;
          let bottomPx = 132;
          try {
            const computed = window.getComputedStyle(document.documentElement);
            const right = parseFloat(computed.getPropertyValue('--dsh-usage-right'));
            const bottom = parseFloat(computed.getPropertyValue('--dsh-usage-bottom'));
            if (isFinite(right)) rightPx = right;
            if (isFinite(bottom)) bottomPx = bottom;
          } catch {
            /* 用默认值 */
          }
          return { x: vp.width - rightPx - width, y: vp.height - bottomPx - height, width, height, defaulted: true };
        }
        // 存档位置在渲染时也**必须夹取**（snap=false：只夹不吸）。
        // 少了这一步，一个越界的存档坐标会让按钮直接渲染到屏幕外 ——
        // 用户实测：按钮停在窗口标题栏上，"根本没法拖，一拖就拖动窗口"。
        // （那次越界坐标是拖动旧 bug 以"宽度=0"算出来的，并被存了下来。）
        // 窗口尺寸变化同样会造出越界坐标，所以这里不能只在拖动时夹。
        const safe = resolveDropPosition(pos, { width, height }, vp, false, frameTopInset());
        return { x: safe.x, y: safe.y, width, height, defaulted: false };
      };

      // 点浮窗外部 / Esc 收起（pointerdown 捕获阶段，与内置弹层同一套路）
      if (canEffect) {
        React.useEffect(() => {
          if (!open) return undefined;
          const onPointerDown = (event) => {
            const root = rootRef.current;
            if (root !== null && root !== undefined && event.target instanceof Node && root.contains(event.target)) return;
            setOpen(false);
          };
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false);
          };
          document.addEventListener('pointerdown', onPointerDown, true);
          document.addEventListener('keydown', onKeyDown);
          return () => {
            document.removeEventListener('pointerdown', onPointerDown, true);
            document.removeEventListener('keydown', onKeyDown);
          };
        }, [open]);
      }

      // 隐藏内置统计（统计药丸 + 上下文占用环），做法见 findBuiltinStatsToHide。
      // 约束：记下原 display 以便逐字还原；与「隐藏内置状态行」开关联动。
      if (canEffect) {
        React.useEffect(() => {
          if (!settings.enabled || !settings.usagePanel || !settings.usageHideBuiltin) {
            restoreHiddenSiblings();
            return undefined;
          }
          const root = rootRef.current;
          if (root === null || root === undefined) return undefined;
          for (const child of findBuiltinStatsToHide(root, HIDE_MAX_DEPTH)) {
            if (!hiddenSiblings.has(child)) hiddenSiblings.set(child, child.style.display);
            child.style.display = 'none';
          }
          return undefined;
        });
      }

      if (!settings.enabled || !settings.usagePanel) return null;

      const line = (label, value) =>
        h(
          'div',
          { className: '_dsbg_usageLine', key: label },
          h('span', { className: '_dsbg_usageLabel' }, label),
          h('span', { className: '_dsbg_usageValue' }, value),
        );
      const or = (value, suffix) => (value === null || value === undefined ? '—' : String(value) + (suffix ?? ''));
      // 收起态按钮的文案：按设置选一项，缺值一律显示 —（绝不留空白按钮）。
      // 按钮上**不带单位**（用户要的：把 "tok" 隐掉），单位只出现在展开后的行里。
      const buttonText = (() => {
        if (settings.usageButtonText === 'cache') return view.cacheHit === null ? '—' : view.cacheHit + '%';
        if (settings.usageButtonText === 'context') return view.contextPercent === null ? '—' : view.contextPercent + '%';
        return view.hasUsage ? formatTokens(view.total) : '—';
      })();

      const rect = buttonRect();
      const placement = resolveCardPlacement(rect, viewport());
      // 把"按钮实际被放到了哪"也写进诊断。
      // **必须整体覆盖，不能追加** —— 这行在每次渲染都会执行，早先写成"非空就接在后面"，
      // 于是每渲染一次就再拼一段，拖动记录永远不消失（用户实测：状态里那条越来越长）。
      // 诊断要的是"最后一次的事实"，历史没有价值。
      diagnostics.usageDragLive =
        'sit=' + rect.x + ',' + rect.y +
        ' wh=' + rect.width + 'x' + rect.height +
        (rect.defaulted ? ' default' : ' saved') +
        ' topMin=' + frameTopInset();
      // 包装层**永远**带上确定的 left/top：静止时用存档/默认坐标，拖动时用拖动坐标。
      // 这样"看到的位置"和"rect 读到的位置"必然一致 ——
      // 之前静止时不给内联坐标，靠样式表的 right/bottom，于是与 rect 的说法不一致，
      // 拖动就从错误起点开始（用户实测：一拖就瞬移到左上角）。
      const wrapStyle = { position: 'fixed', left: rect.x + 'px', top: rect.y + 'px' };

      const onPointerDown = (event) => {
        if (event.button !== undefined && event.button !== 0) return;
        if (!settings.usageDrag) return;
        gesture.startX = event.clientX;
        gesture.startY = event.clientY;
        gesture.originX = rect.x;
        gesture.originY = rect.y;
        gesture.maxDistance = 0;
        gesture.active = true;
        gesture.pos = null;
        gesture.suppressClick = false;
        // 抓取偏移：指针落在按钮内部的哪个位置。配合绝对定位使用
        // （按钮位置 = 指针位置 − 抓取偏移），与帧率、重渲染次数都无关。
        gesture.grabX = event.clientX - rect.x;
        gesture.grabY = event.clientY - rect.y;
        // 尺寸在按下时测一次并记住：整个拖动过程尺寸不变，
        // 而落点计算需要它（读不到就退化成 0×0 的点，吸附全算错）
        gesture.width = rect.width;
        gesture.height = rect.height;
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          /* 不支持指针捕获也不影响拖动（只是离开元素后不再收事件） */
        }
      };
      const onPointerMove = (event) => {
        if (!gesture.active) return;
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        gesture.maxDistance = Math.max(gesture.maxDistance, Math.sqrt(dx * dx + dy * dy));
        if (isDragClick(gesture.maxDistance)) return; // 位移还在阈值内：先不当拖动，避免抖动
        // **绝对定位**，不用累加：按住时记下"指针在按钮内部的位置"（抓取偏移），
        // 之后每次都令 按钮位置 = 指针位置 − 抓取偏移。这样与帧率、重渲染次数无关，
        // 指针在哪按钮就在哪 —— 不会漂，也不会因为丢一帧而累加出错误位移。
        const next = { x: event.clientX - gesture.grabX, y: event.clientY - gesture.grabY };
        gesture.pos = next;
        // 写进 state 触发重渲染 —— 拖动中要能看见它跟着走
        setDragPos(next);
      };
      const onPointerUp = (event) => {
        if (!gesture.active) return;
        gesture.active = false;
        try {
          event.currentTarget.releasePointerCapture(event.pointerId);
        } catch {
          /* 同上 */
        }
        // 落点用**渲染态里的位置**（dragPos），而不是 gesture.pos：
        // gesture 是跨渲染实例对象，但"最后一次位置"以 state 为准才与画面上看到的一致
        // （实测 gesture.pos 会落后一帧，落点因此偏出一个按钮的尺寸）。
        const current = dragPos ?? gesture.pos;
        // 位移在阈值内 = 点击：不落位、不改位置，交给 onClick 展开
        if (isDragClick(gesture.maxDistance) || current === null) {
          gesture.pos = null;
          setDragPos(null);
          return;
        }
        // 拖过阈值：这一下不该顺带展开浮窗。
        // 用显式标志而不是读 gesture.active —— 后者在这里已经置回 false，
        // 之前的写法等于没拦，于是"拖完就展开"（用户报的现象之一）。
        gesture.suppressClick = true;
        // 尺寸用按下时记下的；只有那次也没测到（0）才回头再测一次
        const measured = gesture.width > 0 && gesture.height > 0 ? null : measureButton();
        const size =
          measured !== null
            ? measured
            : gesture.width > 0 && gesture.height > 0
              ? { width: gesture.width, height: gesture.height }
              : { width: rect.width, height: rect.height };
        // 把这次拖动的事实写进诊断（设置页「运行状态」能直接看到，不需要开控制台）。
        // 拖动"不跟手/落点偏"这类问题只能靠实测数字定位，猜没有用。
        diagnostics.usageDragLive =
          'down=' + gesture.originX + ',' + gesture.originY +
          ' size=' + size.width + 'x' + size.height +
          ' moved=' + Math.round(gesture.maxDistance) +
          ' last=' + (current === null ? 'null' : current.x + ',' + current.y);
        const dropped = resolveDropPosition(
          current,
          { width: Math.round(size.width), height: Math.round(size.height) },
          viewport(),
          true,
          frameTopInset(),
        );
        gesture.pos = null;
        setDragPos(null);
        update({ usagePanelPos: dropped });
      };

      return h(
        'div',
        {
          className: '_dsbg_usage' + (gesture.active ? ' _dsbg_usage_dragging' : ''),
          style: wrapStyle,
          ref: (node) => {
            rootRef.current = node;
          },
        },
        open
          ? h(
              'div',
              {
                className: '_dsbg_usageCard',
                style: placement.style,
                role: 'dialog',
                'aria-label': t('usageTitle'),
              },
              h(
                'div',
                { className: '_dsbg_usageHead' },
                h('span', null, t('usageTitle')),
                h(
                  'button',
                  {
                    type: 'button',
                    className: '_dsbg_usageClose',
                    'aria-label': t('usageCollapse'),
                    onClick: () => setOpen(false),
                  },
                  '×',
                ),
              ),
              line(t('usageTotal'), view.totalText ?? '—'),
              line(t('usageCounts'), or(view.turns) + ' / ' + or(view.steps)),
              line(t('usageSpeed'), view.speed === null ? '—' : view.speed + ' tok/s'),
              line(t('usageCache'), view.cacheHit === null ? '—' : view.cacheHit + '%'),
              // 上下文占用：百分比 + 实际用量/窗口（只有百分比时也给得出）
              line(
                t('usageContext'),
                view.contextPercent === null
                  ? '—'
                  : view.contextUsed === null || view.contextWindow === null
                    ? view.contextPercent + '%'
                    : view.contextPercent + '% · ' + formatTokens(view.contextUsed) + '/' + formatTokens(view.contextWindow),
              ),
              line(
                t('usageTimes'),
                (formatDuration(view.llmMs) ?? '—') + ' / ' + (formatDuration(view.toolMs) ?? '—'),
              ),
            )
          : null,
        h(
          'button',
          {
            type: 'button',
            className: '_dsbg_usageButton',
            'data-dsh-bg-usage': 'collapsed',
            'data-dsh-bg-usage-drag': settings.usageDrag ? 'on' : 'off',
            'aria-expanded': open ? 'true' : 'false',
            'aria-label': t('usageTitle'),
            ref: (node) => {
              buttonRef.current = node;
            },
            onPointerDown,
            onPointerMove,
            onPointerUp,
            onPointerCancel: onPointerUp,
            onClick: () => {
              // 刚拖完的那一下 click 不该展开浮窗；消费一次后立刻清掉标志，
              // 否则下一次真正的点击也会被吃掉
              if (gesture.suppressClick) {
                gesture.suppressClick = false;
                return;
              }
              setOpen(!open);
            },
          },
          buttonText,
        ),
      );
    }

    function useImageLibrary(refreshToken, onLibraryChanged) {
      const [items, setItems] = React.useState([]);
      const [error, setError] = React.useState(null);
      React.useEffect(() => {
        let alive = true;
        dbAll()
          .then((records) => {
            if (!alive) return;
            setItems(records.slice().sort((a, b) => b.addedAt - a.addedAt));
            setError(null);
          })
          .catch((cause) => {
            if (alive) setError(String(cause?.message ?? cause));
          });
        return () => {
          alive = false;
        };
      }, [refreshToken]);
      // 开关自愈（自动选图）后要让列表跟着刷新
      React.useEffect(() => {
        libraryListeners.add(onLibraryChanged);
        return () => libraryListeners.delete(onLibraryChanged);
      }, [onLibraryChanged]);
      return [items, error];
    }

    function useThumbs(items) {
      const [map, setMap] = React.useState({});
      React.useEffect(() => {
        let alive = true;
        Promise.all(
          items.map(async (item) => {
            try {
              return [item.id, await getThumbUrl(item.id)];
            } catch {
              return [item.id, null];
            }
          }),
        ).then((pairs) => {
          if (!alive) return;
          const next = {};
          for (const [id, url] of pairs) next[id] = url;
          setMap(next);
        });
        return () => {
          alive = false;
        };
      }, [items]);
      return map;
    }

    // ── 通用控件 ─────────────────────────────────────────────────────────────

    /** 与内置 Switch 组件同构：状态只写在 aria-checked 上。 */
    function Switch(props) {
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': props.checked ? 'true' : 'false',
          'aria-label': props.label,
          title: props.label,
          disabled: props.disabled === true,
          className: '_dsbg_switch',
          onClick: () => props.onChange(!props.checked),
        },
        h('span', { className: '_dsbg_knob' }),
      );
    }

    function SliderRow(props) {
      const value = typeof props.value === 'number' ? props.value : props.fallback;
      const commit = (raw) => {
        const parsed = Number(raw);
        if (!isFinite(parsed)) return;
        props.onChange(clamp(parsed, props.min, props.max));
      };
      return h(
        'div',
        { className: '_dsbg_sliderRow' },
        h('div', { className: '_dsbg_sliderLabel' }, props.label),
        h('input', {
          className: '_dsbg_slider',
          type: 'range',
          min: props.min,
          max: props.max,
          step: props.step ?? 1,
          value,
          'aria-label': props.label,
          onChange: (event) => commit(event.target.value),
        }),
        h('div', { className: '_dsbg_sliderValue' }, props.format ? props.format(value) : String(value)),
      );
    }

    function ToggleRow(props) {
      return h(
        'div',
        { className: '_dsbg_row' },
        h(
          'div',
          { className: '_dsbg_rowText' },
          h('div', { className: '_dsbg_title' }, props.title),
          props.description ? h('div', { className: '_dsbg_desc' }, props.description) : null,
        ),
        h(Switch, { checked: props.checked, onChange: props.onChange, label: props.title }),
      );
    }

    /** 状态表的一行：左侧名称、右侧值（异常时标红）。 */

    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !isFinite(bytes)) return '—';
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    // ── 设置页 ───────────────────────────────────────────────────────────────

    function BackgroundSection(props) {
      const fallback = (key) => ZH[key] ?? key;
      const t = typeof props.t === 'function' ? props.t : fallback;
      const settings = useSettings();
      const [refreshToken, setRefreshToken] = React.useState(0);
      const [busy, setBusy] = React.useState(false);
      const [note, setNote] = React.useState(null);
      const [pathDraft, setPathDraft] = React.useState('');
      const [items, libraryError] = useImageLibrary(refreshToken, () => setRefreshToken((value) => value + 1));
      const thumbs = useThumbs(items);
      const activeItem = items.find((item) => item.id === settings.activeId) ?? null;
      const fileRef = React.useRef(null);
      const previewRef = React.useRef(null);
      const [preview, setPreview] = React.useState(null);

      const bump = () => setRefreshToken((value) => value + 1);

      // 预览用的原图（跟随当前选中的图片）。
      React.useEffect(() => {
        let alive = true;
        if (settings.activeId === null) {
          setPreview(null);
          return () => {
            alive = false;
          };
        }
        ensureImageUrl(settings.activeId)
          .then((url) => {
            if (alive) setPreview(url);
          })
          .catch(() => {
            if (alive) setPreview(null);
          });
        return () => {
          alive = false;
        };
      }, [settings.activeId, refreshToken]);

      const choose = async (list) => {
        const files = Array.from(list ?? []).filter((file) => file.type.startsWith('image/'));
        if (files.length === 0) {
          setNote({ kind: 'error', text: t('noteNotImage') });
          return;
        }
        setBusy(true);
        setNote(null);
        let lastId = null;
        let huge = false;
        try {
          for (const file of files) {
            if (file.size > HUGE_IMAGE_BYTES) huge = true;
            const record = await addImage(file.slice(0, file.size, file.type), file.name, 'file');
            lastId = record.id;
          }
          bump();
          update(lastId === null ? {} : { activeId: lastId, enabled: true });
          await syncActiveImage();
          setNote({ kind: 'ok', text: t('noteAdded') });
          if (huge) setNote({ kind: 'ok', text: t('noteHuge') });
        } catch (error) {
          setNote({ kind: 'error', text: t('noteFailed') + ' ' + String(error?.message ?? error) });
        } finally {
          setBusy(false);
        }
      };

      const importPath = async () => {
        const path = pathDraft.trim();
        if (path === '') return;
        setBusy(true);
        setNote(null);
        try {
          const blob = await fetchPathBlob(path);
          const name = path.split(/[\\/]/).pop() || 'image';
          const record = await addImage(blob, name, 'path');
          bump();
          update({ activeId: record.id, enabled: true });
          await syncActiveImage();
          setPathDraft('');
          setNote({ kind: 'ok', text: t('noteAdded') });
        } catch (error) {
          setNote({ kind: 'error', text: t('notePathFailed') });
        } finally {
          setBusy(false);
        }
      };

      const useImage = async (id) => {
        update({ activeId: id, enabled: true });
        await syncActiveImage();
      };

      const dropImage = async (id) => {
        try {
          await removeImage(id);
        } catch {
          /* 忽略：下面照样刷新列表 */
        }
        const rest = items.filter((item) => item.id !== id);
        if (settings.activeId === id) {
          const next = rest.length > 0 ? rest[0].id : null;
          update({ activeId: next, enabled: next !== null });
          lastImageId = null;
        }
        bump();
      };

      /** 在预览里拖动 = 选择显示区域（background-position）。 */
      const dragPreview = (event) => {
        const box = previewRef.current?.getBoundingClientRect();
        if (!box || box.width === 0) return;
        const move = (clientX, clientY) => {
          const x = clamp(((clientX - box.left) / box.width) * 100, 0, 100);
          const y = clamp(((clientY - box.top) / box.height) * 100, 0, 100);
          update({ posX: Math.round(x), posY: Math.round(y) });
        };
        move(event.clientX, event.clientY);
        const onMove = (moved) => move(moved.clientX, moved.clientY);
        const onUp = () => {
          window.removeEventListener('pointermove', onMove);
          window.removeEventListener('pointerup', onUp);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
      };

      const percent = (value) => Math.round(value * 100) + '%';
      // 注：早先这里每次渲染都调一次 probePaint() 把实况显示在设置页里；
      // 状态展示已改为"下载日志"（见 buildDiagnosticsLog），所以这里不再需要。

      return h(
        'div',
        { className: '_dsbg_section' },
        // 页标题（分区自己画，与内置设置分区一致）
        h('h2', { className: '_dsbg_heading' }, t('nav')),
        h('p', { className: '_dsbg_intro' }, t('intro')),

        // 总开关
        h(ToggleRow, {
          title: t('enable'),
          description: t('enableDesc'),
          checked: settings.enabled,
          onChange: (next) => {
            // 打开时走自愈路径（没选图就自动选一张），关闭时直接落盘
            if (next) void enableBackground();
            else update({ enabled: false });
          },
        }),

        // 预览 + 显示区域
        h(
          'div',
          { className: '_dsbg_row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
          h(
            'div',
            {
              className: '_dsbg_preview',
              ref: previewRef,
              onPointerDown: dragPreview,
              role: 'presentation',
            },
            preview === null
              ? h('div', { className: '_dsbg_previewEmpty' }, t('previewEmpty'))
              : h('div', { className: '_dsbg_previewImage', style: { backgroundImage: `url("${preview}")` } }),
            h('div', { className: '_dsbg_previewHint' }, t('previewHint')),
          ),
          // 缩放方式：两个状态，用开关行表达（内置设置里没有滑杆组件，此前用单步滑杆是别扭的）
          h(ToggleRow, {
            title: t('fitContain'),
            description: t('fitDesc'),
            checked: settings.fit === 'contain',
            onChange: (next) => update({ fit: next ? 'contain' : 'cover' }),
          }),
          h(SliderRow, {
            label: t('posX'),
            value: settings.posX,
            min: 0,
            max: 100,
            onChange: (value) => update({ posX: value }),
            format: (value) => Math.round(value) + '%',
          }),
          h(SliderRow, {
            label: t('posY'),
            value: settings.posY,
            min: 0,
            max: 100,
            onChange: (value) => update({ posY: value }),
            format: (value) => Math.round(value) + '%',
          }),
        ),

        // 壁纸亮度：往右 = 壁纸越亮、白纱越薄（方向符合直觉，见 DEFAULT_SETTINGS 注释）
        h(SliderRow, {
          label: t('wallpaperBrightness'),
          value: settings.wallpaperBrightness * 100,
          min: 0,
          max: 100,
          onChange: (value) => update({ wallpaperBrightness: value / 100 }),
          format: (value) => Math.round(value) + '%',
        }),
        // 次要文字改用主色：壁纸下二级/三级文字几乎看不见，一键提到主文字色
        h(ToggleRow, {
          title: t('labelBoost'),
          description: t('labelBoostDesc'),
          checked: settings.labelBoost,
          onChange: (next) => update({ labelBoost: next }),
        }),
        h(
          'div',
          { className: '_dsbg_buttonRow' },
          h(
            'button',
            {
              type: 'button',
              className: '_dsbg_button _dsbg_button_ghost',
              onClick: () => update({ wallpaperBrightness: 0.55 }),
            },
            t('presetBalanced'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: '_dsbg_button _dsbg_button_ghost',
              onClick: () => update({ wallpaperBrightness: 0.25 }),
            },
            t('presetReadable'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: '_dsbg_button _dsbg_button_ghost',
              onClick: () => update({ wallpaperBrightness: 0.9 }),
            },
            t('presetVivid'),
          ),
        ),
        // 磨砂玻璃：作用在压暗层上的 backdrop-filter，只糊背后的壁纸
        h(SliderRow, {
          label: t('frost'),
          value: settings.frostStrength,
          min: 0,
          max: 30,
          onChange: (value) => update({ frostStrength: value }),
          format: (value) => (value === 0 ? t('frostOff') : Math.round(value) + 'px'),
        }),
        // 输入框：透明 + 磨砂。
        // 下面这两个滑杆**同时控制输入框和文字底纱**（用户要求"文字底的纱、磨砂改为被对话框的
        // 滑杆控制"）：不透明度 → 两者的浓度；磨砂 → 两者的 backdrop-filter。
        h(SliderRow, {
          label: t('composerOpacity'),
          value: settings.composerOpacity * 100,
          min: 0,
          max: 100,
          onChange: (value) => update({ composerOpacity: value / 100 }),
          format: (value) => (value === 0 ? t('frostOff') : Math.round(value) + '%'),
        }),
        h(SliderRow, {
          label: t('composerFrost'),
          value: settings.composerFrost,
          min: 0,
          max: 30,
          onChange: (value) => update({ composerFrost: value }),
          format: (value) => (value === 0 ? t('frostOff') : Math.round(value) + 'px'),
        }),
        // 注：原本这里还有「会话区整片底色」「整片底色也磨砂」「侧栏更实」三行，
        // 按用户要求删掉了（用不上）。对应的设置字段与默认值保留，
        // 以免旧配置读回时丢字段（`normalize()` 仍会把它们补成默认值）。
        // 用量浮窗：把输入框下方那条统计改成右侧小按钮 + 浮窗
        h(ToggleRow, {
          title: t('usagePanel'),
          description: t('usagePanelDesc'),
          checked: settings.usagePanel,
          onChange: (next) => update({ usagePanel: next }),
        }),
        h(ToggleRow, {
          title: t('usageHideBuiltin'),
          description: t('usageHideBuiltinDesc'),
          checked: settings.usageHideBuiltin,
          onChange: (next) => update({ usageHideBuiltin: next }),
        }),
        h(ToggleRow, {
          title: t('usageDrag'),
          description: t('usageDragDesc'),
          checked: settings.usageDrag,
          onChange: (next) => update({ usageDrag: next }),
        }),
        // 复位按钮位置（拖到角落里找不回来时的退路）
        h(
          'div',
          { className: '_dsbg_buttonRow' },
          h(
            'button',
            {
              type: 'button',
              className: '_dsbg_button _dsbg_button_ghost',
              onClick: () => update({ usagePanelPos: null }),
            },
            t('usageResetPos'),
          ),
        ),
        // 收起态按钮显示什么（三种，都在浮窗里有完整数值）
        h(
          'div',
          { className: '_dsbg_buttonRow' },
          h(
            'button',
            {
              type: 'button',
              className:
                '_dsbg_button ' +
                (settings.usageButtonText === 'total' ? '_dsbg_button_primary' : '_dsbg_button_ghost'),
              onClick: () => update({ usageButtonText: 'total' }),
            },
            t('usageShowTotal'),
          ),
          h(
            'button',
            {
              type: 'button',
              className:
                '_dsbg_button ' +
                (settings.usageButtonText === 'cache' ? '_dsbg_button_primary' : '_dsbg_button_ghost'),
              onClick: () => update({ usageButtonText: 'cache' }),
            },
            t('usageShowCache'),
          ),
          h(
            'button',
            {
              type: 'button',
              className:
                '_dsbg_button ' +
                (settings.usageButtonText === 'context' ? '_dsbg_button_primary' : '_dsbg_button_ghost'),
              onClick: () => update({ usageButtonText: 'context' }),
            },
            t('usageShowContext'),
          ),
        ),
        h('p', { className: '_dsbg_note', style: { color: 'var(--dsw-alias-label-tertiary)' } }, t('tuneHint')),

        // 图片库
        h(
          'div',
          { className: '_dsbg_row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
          h('div', { className: '_dsbg_title' }, t('libraryTitle')),
          items.length === 0
            ? h('p', { className: '_dsbg_empty' }, libraryError === null ? t('libraryEmpty') : t('libraryError') + ' ' + libraryError)
            : h(
                'div',
                { className: '_dsbg_grid' },
                items.map((item) =>
                  h(
                    'div',
                    {
                      key: item.id,
                      className: '_dsbg_card',
                      'data-active': item.id === settings.activeId ? 'true' : 'false',
                      onClick: () => useImage(item.id),
                      role: 'presentation',
                      title: item.name,
                    },
                    h(
                      'span',
                      { className: '_dsbg_cardThumb' },
                      thumbs[item.id] ? h('img', { src: thumbs[item.id], alt: item.name }) : null,
                    ),
                    h(
                      'span',
                      { className: '_dsbg_cardMain' },
                      h('span', { className: '_dsbg_cardTitle' }, item.name),
                      h(
                        'span',
                        { className: '_dsbg_cardDesc' },
                        item.width + '×' + item.height + ' · ' + formatBytes(item.bytes),
                      ),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: '_dsbg_cardDelete',
                        title: t('remove'),
                        'aria-label': t('remove'),
                        onClick: (event) => {
                          event.stopPropagation();
                          dropImage(item.id);
                        },
                      },
                      '×',
                    ),
                  ),
                ),
              ),
          h(
            'div',
            { className: '_dsbg_buttonRow' },
            h(
              'button',
              {
                type: 'button',
                className: '_dsbg_button _dsbg_button_primary',
                disabled: busy,
                onClick: () => fileRef.current?.click(),
              },
              t('choose'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: '_dsbg_button _dsbg_button_ghost',
                disabled: busy,
                onClick: () => update({ ...DEFAULT_SETTINGS, activeId: settings.activeId }),
              },
              t('reset'),
            ),
            h('input', {
              ref: fileRef,
              type: 'file',
              accept: 'image/*',
              multiple: true,
              style: { display: 'none' },
              onChange: (event) => {
                choose(event.target.files);
                event.target.value = '';
              },
            }),
          ),
          h(
            'div',
            { className: '_dsbg_buttonRow' },
            h('input', {
              className: '_dsbg_input',
              value: pathDraft,
              spellCheck: false,
              placeholder: t('pathPlaceholder'),
              'aria-label': t('pathImport'),
              onChange: (event) => setPathDraft(event.target.value),
              onKeyDown: (event) => {
                if (event.key === 'Enter') importPath();
              },
            }),
            h(
              'button',
              { type: 'button', className: '_dsbg_button _dsbg_button_ghost', disabled: busy, onClick: importPath },
              t('pathImport'),
            ),
          ),
          h(
            'p',
            {
              className: '_dsbg_note',
              style: {
                color:
                  note?.kind === 'error'
                    ? 'var(--dsw-alias-state-error-primary)'
                    : 'var(--dsw-alias-label-tertiary)',
              },
            },
            note?.text ?? t('pathHint'),
          ),
        ),

        // 运行状态：把「为什么没显示」直接摊开，不必开控制台
        h(
          'div',
          { className: '_dsbg_row', style: { flexDirection: 'column', alignItems: 'stretch', gap: '8px' } },
          h('div', { className: '_dsbg_title' }, t('statusTitle')),
          // 运行状态按用户要求**不再在设置页里摊开**（那串拖动记录既占地方、又会自我累加）。
          // 改成"需要时下载成日志文件"：平时设置页清爽，出问题时一次导出就有完整证据。
          h(
            'div',
            { className: '_dsbg_buttonRow' },
            h(
              'button',
              {
                type: 'button',
                className: '_dsbg_button _dsbg_button_ghost',
                onClick: () => downloadLog(),
              },
              t('statusDownload'),
            ),
          ),
          h(
            'p',
            { className: '_dsbg_note', style: { color: 'var(--dsw-alias-label-tertiary)' } },
            t('statusDownloadHint'),
          ),
        ),
      );
    }

    /**
     * 生成运行诊断日志（纯文本）。
     */
    function buildDiagnosticsLog() {
      const lines = [];
      const now = new Date();
      const pad = (value) => (value < 10 ? '0' + value : String(value));
      lines.push('# DSH 本地对话背景插件 · 运行诊断');
      lines.push(
        '导出时间: ' + now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()) +
          ' ' + pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds()),
      );
      lines.push('');
      lines.push('## 运行状态');
      for (const key of Object.keys(diagnostics)) {
        // 异常数组逐条展开，不然挤成一行没法看
        if (Array.isArray(diagnostics[key])) {
          lines.push('  ' + key + ' = (' + diagnostics[key].length + ' 条)');
          for (const item of diagnostics[key]) lines.push('    · ' + String(item));
          continue;
        }
        lines.push('  ' + key + ' = ' + String(diagnostics[key]));
      }
      lines.push('');
      lines.push('## 当前设置');
      try {
        lines.push(
          JSON.stringify(state, null, 2)
            .split('\n')
            .map((row) => '  ' + row)
            .join('\n'),
        );
      } catch {
        lines.push('  (序列化失败)');
      }
      lines.push('');
      lines.push('## 页面事实');
      const fact = (label, value) => lines.push('  ' + label + ' = ' + String(value));
      try {
        fact('视口', window.innerWidth + ' x ' + window.innerHeight);
        fact('body[data-dsh-bg]', document.body.getAttribute('data-dsh-bg'));
        fact('body[data-dsh-bg-text]', document.body.getAttribute('data-dsh-bg-text'));
        fact('body[data-dsh-bg-usage]', document.body.getAttribute('data-dsh-bg-usage'));
        fact('深色主题属性', document.body.hasAttribute('data-ds-dark-theme'));
        const rootStyle = window.getComputedStyle(document.documentElement);
        const bodyStyle = window.getComputedStyle(document.body);
        for (const name of [
          '--dsh-bg-zoom',
          '--dsh-bg-focus',
          '--dsh-chat-left',
          '--dsh-usage-right',
          '--dsh-usage-bottom',
          '--dsh-bg-text-rgb',
          '--dsh-bg-text-alpha',
          '--dsh-bg-card-rgb',
          '--dsh-windows-titlebar-height',
        ]) {
          fact(name, String(rootStyle.getPropertyValue(name)).trim());
        }
        fact('--dsw-alias-bg-base（body）', String(bodyStyle.getPropertyValue('--dsw-alias-bg-base')).trim());
        fact('--dsw-specific-sidebar-fill（body）', String(bodyStyle.getPropertyValue('--dsw-specific-sidebar-fill')).trim());
        fact('--dsw-specific-input-major（body）', String(bodyStyle.getPropertyValue('--dsw-specific-input-major')).trim());
        fact('body.background-image 长度', String(document.body.style.backgroundImage).length);
        fact('body.background-image 前缀', String(document.body.style.backgroundImage).slice(0, 120));
        // 元素探测：这是"找不找得到、落没落在屏幕外"这类问题的直接答案
        const probe = (label, selector) => {
          const node = document.querySelector(selector);
          if (node === null) {
            fact(label, '(未找到)');
            return;
          }
          let rect = null;
          try {
            rect = node.getBoundingClientRect();
          } catch {
            rect = null;
          }
          fact(
            label,
            rect === null
              ? '(找到，但取不到几何)'
              : 'x=' + Math.round(rect.left) + ' y=' + Math.round(rect.top) +
                ' w=' + Math.round(rect.width) + ' h=' + Math.round(rect.height),
          );
        };
        probe('侧栏列 [hash]_sidebarCol', '[class*="_sidebarCol"]');
        probe('会话列 [hash]_centerCol', '[class*="_centerCol"]');
        probe('输入框 [data-composer-card]', '[data-composer-card]');
        probe('用量按钮', '._dsbg_usageButton');
        probe('压暗层', '._dsbg_veil');
        probe('内置统计行 [data-composer-stats]', '[data-composer-stats]');
        // ── 设置面板自身的事实 ──
        // 用户长期反馈"关闭背景后设置页会炸"，但日志里 pluginErrors 为 0 ——
        // 说明不是本插件抛错，我也不该继续凭截图猜。把面板的真实计算样式与几何写进日志。
        // 重要：**导出时设置页必须开着** —— 上一轮两份日志都是"未打开"，等于白加。
        // 面板类名是哈希的，所以按几何特征宽松地找：视口内、面积够大、position 为 fixed/absolute。
        const collectBigLayers = () => {
          const found = [];
          for (const node of Array.from(document.querySelectorAll('div'))) {
            try {
              const styleOf = window.getComputedStyle(node);
              if (styleOf.display === 'none' || styleOf.visibility === 'hidden') continue;
              if (styleOf.position !== 'fixed' && styleOf.position !== 'absolute') continue;
              const box = node.getBoundingClientRect();
              if (box.width * box.height < 400 * 280) continue;
              found.push({ node, box, styleOf, area: box.width * box.height });
            } catch {
              /* 跳过取不到样式的节点 */
            }
          }
          // `_panel` 优先：面积最大的是 overlayLayer 遮罩层而非面板本身 ——
          // 实测挑错了节点，于是"设置面板"那段报的是遮罩层，
          // elementFromPoint 也跟着说"有东西压在上面"（假警报）。
          found.sort((a, b) => {
            const aPanel = /_panel/.test(String(a.node.className ?? '')) ? 1 : 0;
            const bPanel = /_panel/.test(String(b.node.className ?? '')) ? 1 : 0;
            if (aPanel !== bPanel) return bPanel - aPanel;
            return b.area - a.area;
          });
          return found;
        };
        const bigLayers = collectBigLayers();
        fact('大浮层数（宽>=400 高>=280）', bigLayers.length);
        for (const item of bigLayers.slice(0, 6)) {
          fact(
            '  浮层',
            String(item.node.className ?? item.node.tagName).slice(0, 70) +
              ' @' + Math.round(item.box.left) + ',' + Math.round(item.box.top) +
              ' ' + Math.round(item.box.width) + 'x' + Math.round(item.box.height) +
              ' bg=' + item.styleOf.backgroundColor,
          );
        }
        const panel = bigLayers.length === 0 ? null : bigLayers[0].node;
        if (panel === null) {
          fact('设置面板', '(当前未打开)');
        } else {
          const s = window.getComputedStyle(panel);
          const r = panel.getBoundingClientRect();
          fact('设置面板 class', String(panel.className).slice(0, 120));
          fact('设置面板 几何', 'x=' + Math.round(r.left) + ' y=' + Math.round(r.top) +
            ' w=' + Math.round(r.width) + ' h=' + Math.round(r.height));
          fact('设置面板 background-color', s.backgroundColor);
          fact('设置面板 background-image', String(s.backgroundImage).slice(0, 80));
          fact('设置面板 opacity / z-index / isolation', s.opacity + ' / ' + s.zIndex + ' / ' + s.isolation);
          fact('设置面板 transform / filter / backdrop-filter',
            s.transform + ' / ' + s.filter + ' / ' + s.backdropFilter);
          fact('设置面板 子元素数', panel.children.length);
          // 命中测试：面板中心点最上层是谁？如果最上层不是面板或其子元素，
          // 说明有东西压在面板上 —— "看着炸了"很可能就是这个。
          let topmost = '(取不到)';
          try {
            const hit = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + 24));
            topmost = hit === null ? '(null)' : String(hit.className ?? hit.tagName).slice(0, 100) +
              (panel.contains(hit) ? ' [属于面板]' : ' [不属于面板 ← 有东西压在面板上]');
          } catch (cause) {
            topmost = '(出错) ' + String(cause && cause.message ? cause.message : cause);
          }
          fact('面板顶部中心点的最上层元素', topmost);
          // 本插件写在面板上的东西（停用时应当为空）
          fact('面板上的 _dsbg_ 类元素数', panel.querySelectorAll('[class*="_dsbg_"]').length);
          const section = panel.querySelector('[class*="_dsbg_section"]');
          if (section !== null) {
            const ss = window.getComputedStyle(section);
            const sr = section.getBoundingClientRect();
            fact('  本插件分区 几何', 'x=' + Math.round(sr.left) + ' y=' + Math.round(sr.top) +
              ' w=' + Math.round(sr.width) + ' h=' + Math.round(sr.height));
            fact('  本插件分区 font-size / line-height / gap', ss.fontSize + ' / ' + ss.lineHeight + ' / ' + ss.gap);
            fact('  本插件分区 color / background', ss.color + ' / ' + ss.backgroundColor);
          } else {
            fact('  本插件分区', '(不在面板里)');
          }
        }
        // 被隐藏的内置元素：直接看出"隐藏"动了几个、动了谁
        fact('被隐藏的内置元素数', hiddenSiblings.size);
        let index = 0;
        for (const [node] of hiddenSiblings) {
          index += 1;
          fact('  隐藏[' + index + ']', String(node.className ?? '(无类名)'));
        }
      } catch (cause) {
        lines.push('  (收集页面事实时出错: ' + String(cause && cause.message ? cause.message : cause) + ')');
      }
      return lines.join('\n');
    }

    /** 把诊断日志交给浏览器下载（object URL 优先，退回 data URL，都失败则记进诊断）。 */
    function downloadLog() {
      const text = buildDiagnosticsLog();
      try {
        let href = null;
        let temporary = false;
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function' && typeof Blob === 'function') {
          href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
          temporary = true;
        } else {
          href = 'data:text/plain;charset=utf-8;base64,' + btoa(unescape(encodeURIComponent(text)));
        }
        const link = document.createElement('a');
        link.href = href;
        link.download = 'dsh-chat-background-log.txt';
        document.body.appendChild(link);
        link.click();
        link.remove();
        if (temporary) setTimeout(() => URL.revokeObjectURL(href), 4000);
        diagnostics.logDownloaded = 'ok';
      } catch (cause) {
        diagnostics.logDownloaded = 'failed: ' + String(cause && cause.message ? cause.message : cause);
      }
    }

    // ── 侧栏快捷开关 ─────────────────────────────────────────────────────────

    function SidebarToggle(props) {
      const fallback = (key) => ZH[key] ?? key;
      const t = typeof props.t === 'function' ? props.t : fallback;
      const settings = useSettings();
      const label = t('nav');
      return h(
        'button',
        {
          type: 'button',
          className: '_dsbg_footerAction' + (settings.enabled ? ' _dsbg_footerAction_on' : ''),
          title: (settings.enabled ? t('disable') : t('enable')) + ' · ' + label,
          'aria-label': label,
          'aria-pressed': settings.enabled ? 'true' : 'false',
          onClick: () => toggleBackground(),
        },
        h(
          'svg',
          { width: 18, height: 18, viewBox: '0 0 18 18', 'aria-hidden': 'true' },
          h('rect', {
            x: 1.75,
            y: 2.75,
            width: 14.5,
            height: 12.5,
            rx: 2.5,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
          }),
          h('circle', { cx: 5.6, cy: 6.6, r: 1.35, fill: 'currentColor' }),
          h('path', {
            d: 'M2.6 13.4 6.9 9.1l2.8 2.8 2.2-2.2 3.4 3.4',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.4,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          }),
        ),
      );
    }

    // ── 文案 ─────────────────────────────────────────────────────────────────

    const ZH = {
      nav: '背景',
      intro: '把本地图片铺成整个对话窗口的背景：可开关、可切换，侧栏与会话区的不透明度各自独立。',
      enable: '启用背景图片',
      enableDesc: '关闭后立即恢复内置外观；所有设置都会保留。',
      disable: '停用背景图片',
      previewEmpty: '尚未选择图片。从下面的图库选择、或点「选择本地图片…」。',
      previewHint: '在预览图上按住拖动，即可选择显示区域（等比缩放，不拉伸）',
      fitContain: '完整显示整张图',
      fitDesc: '打开 = 不裁切（按比例缩小到完整可见）；关闭 = 铺满裁切（默认）。',
      posX: '水平位置',
      posY: '垂直位置',
      wallpaperBrightness: '壁纸亮度',
      labelBoost: '次要文字改用主色',
      labelBoostDesc: '壁纸下，侧栏时间、元信息、轨迹标签、消息操作图标这些浅灰文字几乎看不见。打开后把它们提到主文字色（浅色主题近黑、深色主题近白），关掉则恢复主题原本的层次。',
      usagePanel: '用量浮窗',
      usagePanelDesc: '把输入框下方那条统计做成右侧一枚小按钮（写实时总用量），点击展开为浮窗显示轮次、步骤、速度、缓存与上下文；点浮窗外部或按 Esc 收起。数据走内置投影，随会话实时更新。',
      usageHideBuiltin: '隐藏内置状态行',
      usageHideBuiltinDesc: '隐藏输入框下方原有的统计行，避免与用量浮窗重复显示。注意：原统计行自带的两个详情弹窗也会一并隐藏。',
      usageTitle: '会话用量',
      usageDrag: '可拖动并吸附',
      usageDragDesc: '按住小按钮可拖动；松手时距屏幕边缘 24px 以内就吸附到那条边，否则留在原地。位移 4px 以内仍算点击（不会误开浮窗）。',
      usageResetPos: '复位按钮位置',
      usageShowTotal: '按钮显示总用量',
      usageShowCache: '按钮显示缓存命中',
      usageShowContext: '按钮显示上下文',
      usageTotal: '总用量',
      usageCounts: '轮次 / 步骤',
      usageSpeed: '输出速度',
      usageCache: '缓存命中',
      usageContext: '上下文占用',
      usageTimes: '模型 / 工具用时',
      usageCollapse: '收起',
      frost: '磨砂玻璃',
      frostOff: '关闭',
      textFillAlpha: '文字底纱',
      composerOpacity: '输入框不透明度（同时控制文字底纱浓度）',
      composerFrost: '输入框磨砂（同时控制文字底纱磨砂）',
      presetBalanced: '均衡',
      presetReadable: '偏清晰',
      presetVivid: '偏醒目',
      tuneHint:
        '往右 = 壁纸更亮、白纱更薄；往左 = 白纱更厚、文字更清楚。整窗一层，不会在两列之间产生接缝。文字看着吃力就往左拉，三个预设可以直接点。',
      libraryTitle: '图片库（原始字节保存，不压缩、不重编码）',
      libraryEmpty: '图库为空。',
      libraryError: '读取图库失败：',
      choose: '选择本地图片…',
      reset: '恢复默认',
      remove: '删除这张图片',
      pathImport: '从绝对路径导入',
      pathPlaceholder: '例如 D:\\pictures\\sky.jpg',
      pathHint: '同一路径只会导入一次（按需读取，不复制原文件）。',
      noteAdded: '已加入图库。',
      noteHuge: '图片体积较大，已按原始字节保存；如遇卡顿可改用较小的图片。',
      noteNotImage: '请选择图片文件（png / jpg / webp / gif / avif）。',
      noteFailed: '导入失败：',
      notePathFailed: '按路径导入失败：该通道需要页面自身认证，可能被拒绝。请改用「选择本地图片…」。',
      statusTitle: '运行状态',
      statusDownload: '下载诊断日志',
      statusDownloadHint: '运行状态不再在这里摊开，需要排查时点上面的按钮导出为文本文件（含运行状态、当前设置与关键页面事实）。',
      statusStylesheet: '样式表',
      statusTokens: '底色透出',
      statusColumns: '列上已画图',
      statusPaint: '压暗层实况',
      statusUsage: '用量浮窗',
      statusUsageDrag: '上次拖动',
      statusUsageHidden: '已隐藏内置统计',
      statusDragNone: '还没拖过',
      statusColumnMatch: '已画上（{via}）',
      statusColumnWhy: '未生效（侧栏{sidebar}/会话{chat}，{via}）',
      statusImage: '当前图片',
      statusLibrary: '图库',
      statusOk: '已生效',
      statusBad: '未生效',
      statusGated: '待列上画图成功后才放开',
      statusNoImage: '未选择',
      statusCount: '共 {count} 张',
      statusActiveError: '当前图片载入失败：',
    };

    const EN = {
      nav: 'Background',
      intro:
        'Turn a local image into the background of the whole window: toggle it, switch images, and tune the sidebar and conversation opacity independently.',
      enable: 'Enable background image',
      enableDesc: 'Turning this off restores the built-in look; every setting is kept.',
      disable: 'Disable background image',
      previewEmpty: 'No image selected yet. Pick one from the library below, or use “Choose local image…”.',
      previewHint: 'Drag inside the preview to choose the visible area (scaled proportionally, never stretched)',
      fitContain: 'Fit the whole image',
      fitDesc: 'On = no cropping (scale down until fully visible); off = fill and crop (default).',
      posX: 'Horizontal position',
      posY: 'Vertical position',
      wallpaperBrightness: 'Wallpaper brightness',
      labelBoost: 'Promote secondary text to primary',
      labelBoostDesc: 'On a wallpaper, the pale grey text - sidebar timestamps, metadata, the trajectory tab, message action icons - is nearly invisible. This raises those two levels to the primary label colour (near black in the light theme, near white in the dark one). Switch it off to restore the original hierarchy.',
      usagePanel: 'Usage popover',
      usagePanelDesc: 'Turns the statistics line under the composer into a small button on the right (showing live total usage); clicking expands a popover with turns, steps, speed, cache and context. Clicking outside or pressing Esc collapses it. Figures come from built-in projections and update live.',
      usageHideBuiltin: 'Hide the built-in stats line',
      usageHideBuiltinDesc: 'Hides the original statistics line under the composer so it does not duplicate the popover. Note: the two detail dialogs that line owned are hidden with it.',
      usageTitle: 'Session usage',
      usageDrag: 'Draggable with edge snapping',
      usageDragDesc: 'Hold the small button to drag it; on release it snaps to an edge when within 24px, otherwise it stays where you left it. Movement under 4px still counts as a click (so it will not open the popover by accident).',
      usageResetPos: 'Reset button position',
      usageShowTotal: 'Show total on the button',
      usageShowCache: 'Show cache hit on the button',
      usageShowContext: 'Show context on the button',
      usageTotal: 'Total',
      usageCounts: 'Turns / steps',
      usageSpeed: 'Output speed',
      usageCache: 'Cache hit',
      usageContext: 'Context',
      usageTimes: 'LLM / tool time',
      usageCollapse: 'Collapse',
      frost: 'Frosted glass',
      frostOff: 'off',
      textFillAlpha: 'Text backdrop',
      composerOpacity: 'Composer opacity (also sets the text backdrop depth)',
      composerFrost: 'Composer frost (also frosts the text backdrop)',
      presetBalanced: 'Balanced',
      presetReadable: 'Readable',
      presetVivid: 'Vivid',
      tuneHint:
        'Right = brighter wallpaper and a thinner veil; left = thicker veil and clearer text. It is a single window-wide layer, so the two columns cannot show a seam. Pull left when text feels hard to read, or use one of the three presets.',
      libraryTitle: 'Library (original bytes, no compression or re-encoding)',
      libraryEmpty: 'The library is empty.',
      libraryError: 'Could not read the library: ',
      choose: 'Choose local image…',
      reset: 'Reset to defaults',
      remove: 'Remove this image',
      pathImport: 'Import from absolute path',
      pathPlaceholder: 'e.g. D:\\pictures\\sky.jpg',
      pathHint: 'The same path is imported once (read on demand, the original file is not copied).',
      noteAdded: 'Added to the library.',
      noteHuge: 'This image is large and was stored as-is; use a smaller one if you notice lag.',
      noteNotImage: 'Please choose image files (png / jpg / webp / gif / avif).',
      noteFailed: 'Import failed: ',
      notePathFailed:
        'Import by path failed: that channel requires the page’s own authentication and may refuse. Please use “Choose local image…” instead.',
      statusTitle: 'Runtime status',
      statusDownload: 'Download diagnostics log',
      statusDownloadHint: 'Runtime status is no longer shown here. When troubleshooting, use the button above to export a text file with the runtime status, current settings and key page facts.',
      statusStylesheet: 'Stylesheet',
      statusTokens: 'Surfaces cleared',
      statusColumns: 'Image on columns',
      statusPaint: 'Veil live values',
      statusUsage: 'Usage popover',
      statusUsageDrag: 'Last drag',
      statusUsageHidden: 'Built-in stats hidden',
      statusDragNone: 'not dragged yet',
      statusColumnMatch: 'painted ({via})',
      statusColumnWhy: 'NOT painted (sidebar {sidebar} / chat {chat}, {via})',
      statusImage: 'Active image',
      statusLibrary: 'Library',
      statusOk: 'active',
      statusBad: 'INACTIVE',
      statusGated: 'waiting for the image to reach the columns',
      statusNoImage: 'none selected',
      statusCount: '{count} image(s)',
      statusActiveError: 'Active image failed to load: ',
    };

    /**
     * 摘掉本插件写进 :root 的所有自定义属性。
     */
    const OWNED_VARIABLE_PREFIXES = ['--dsh-bg-', '--dsh-chat-', '--dsh-usage-'];
    function clearRootVariables() {
      const css = document.documentElement.style;
      const doomed = [];
      for (let index = 0; index < css.length; index += 1) {
        const name = css.item(index);
        if (OWNED_VARIABLE_PREFIXES.some((prefix) => name.startsWith(prefix))) doomed.push(name);
      }
      for (const name of doomed) css.removeProperty(name);
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        // 1) 样式表 + 视口级图层：注册时建立，卸载时完整移除。
        ctx.effect(() => {
          const tag = ensureStyleTag();
          tag.textContent = CSS;
          ensureLayers();
          applyVisuals();
          return () => {
            if (detectTimer !== null) window.clearTimeout(detectTimer);
            tag?.remove();
            for (const node of Array.from(document.querySelectorAll('[data-dsh-bg-layer]'))) node.remove();
            for (const node of Array.from(document.querySelectorAll('[data-dsh-bg-sidebar],[data-dsh-bg-chat]'))) {
              node.removeAttribute('data-dsh-bg-sidebar');
              node.removeAttribute('data-dsh-bg-chat');
            }
            // 还原本插件内联改过的列背景
            restoreColumnBackgrounds();
            restoreComposer();
            restoreHiddenSiblings();
            document.body.removeAttribute('data-dsh-bg');
            document.body.removeAttribute('data-dsh-bg-text');
            clearRootVariables();
          };
        }, 'chat-background: stylesheet and viewport layers');

        // 2) 视口变化时重新探测侧栏/会话列。
        ctx.effect(() => {
          const onResize = () => scheduleDetect();
          window.addEventListener('resize', onResize);
          return () => window.removeEventListener('resize', onResize);
        }, 'chat-background: region detection on resize');

        // 3) 载入当前图片 + 首次导入随包图片。
        ctx.effect(() => {
          void syncActiveImage();
          return () => {
            releaseAllImageUrls();
            thumbCache.clear();
          };
        }, 'chat-background: active image');

        // 4) 文案字典。
        ctx.effect(() => ctx.locale.register(NS, { zh: ZH, en: EN }), 'chat-background: dictionaries');

        // 4.5) 崩溃捕获：把"属于本插件的异常"记进诊断，随日志一起导出。
        //      用户长期反馈"关闭背景后设置页会炸"，而这条路径在自检里复现不出来
        //      （替身比真实 DOM 宽松）。看不到页面就让页面自己把错误原文记下来。
        //      只收栈里指回本插件的错误，不揽应用自身的报错。
        ctx.effect(() => {
          const onError = (event) => {
            const error = event && (event.error || event.message);
            if (isPluginError(event && event.error ? event.error : new Error(String(error)))) {
              recordPluginError('onerror', event.error ?? new Error(String(event.message)));
            }
          };
          const onRejection = (event) => {
            const reason = event && event.reason;
            if (isPluginError(reason)) recordPluginError('unhandledrejection', reason);
          };
          window.addEventListener('error', onError);
          window.addEventListener('unhandledrejection', onRejection);
          return () => {
            window.removeEventListener('error', onError);
            window.removeEventListener('unhandledrejection', onRejection);
          };
        }, 'chat-background: error capture');

        // 5) 设置页。
        ctx.slots.inject('settings.section', () =>
          ctx.slots.register(
            {
              name: 'settings.section',
              id: 'chat-background',
              order: 24,
              label: () => ctx.locale.bind(NS)('nav'),
              locale: NS,
            },
            BackgroundSection,
          ),
        );

        // 6) 侧栏快捷开关。
        ctx.slots.inject('sidebar.footer.action', () =>
          ctx.slots.register(
            {
              name: 'sidebar.footer.action',
              id: 'chat-background-toggle',
              order: 5,
              label: () => ctx.locale.bind(NS)('nav'),
              locale: NS,
            },
            SidebarToggle,
          ),
        );

        // 7) 用量浮窗。
        //    必须坐在 conversation.composer.dock 这个座位里 —— 它的 standardProps 会注入
        //    useProjection，而 sessionStats / tokenUsage / contextPressure 这三个投影键
        //    在 ctx.sessions 的公开服务里读不到（faceOf 只认 inbox/modelSelection/plan/goal/
        //    permissions/userQuestions）。用**自己的 id** 注册，所以内置那条 stats 仍在，
        //    只是被设置开关用 CSS 隐藏 —— 随时可以放它回来。
        ctx.slots.inject('conversation.composer.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.composer.dock',
              id: 'chat-background-usage',
              order: 10,
              label: () => ctx.locale.bind(NS)('usageTitle'),
              locale: NS,
            },
            UsagePanel,
          ),
        );
      },
    };
  },
});
