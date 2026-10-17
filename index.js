/**
 * 宿主半体（Host half）。
 *
 * 背景图完全由浏览器半体（./client.js）实现：它在页面里注入一个视口级图片层，
 * 并把内置主题令牌在插件自己的样式表作用域内改写为半透明，让背景透出。
 * 这里只提供一个可加载的插件行，让 `@deepseek-ai/dsh-client-modules` 能在
 * Loader 中扫描到这个包并挂载 ./client 半体。
 */
export function apply() {}
