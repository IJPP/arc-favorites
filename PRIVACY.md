# Privacy Policy

_Last updated: October 9, 2026_

Bow is a Chrome extension that turns your pinned tabs into "apps". This policy explains what it handles and where that data goes.

## Summary

Bow does not collect, transmit, sell or share any data. Everything it stores stays in your browser, on your device.

## What Bow handles, and why

- **Your Favorites:** the site, home page address, name and icon choice for each app you add, plus their order. Bow needs these to recreate and switch to your apps.
- **Tab information:** the address, title and pinned/asleep state of tabs, read through Chrome's `tabs` API. Bow uses this to recognise which tab belongs to which app, restore apps after you close them or restart Chrome, and show each app's state in the popup.
- **A site's declared name:** on sites you add, Bow reads the name the site declares for itself in its page metadata (for example `application-name`) to name the app. It does not read any other page content.
- **Link clicks inside your apps:** on sites you have added, Bow installs a small click handler that decides whether a link opens in the app's tab or in a normal tab. It looks only at the link's address and does not record it.
- **Diagnostic log:** a short local log of extension events (for example "restored an app") to help with troubleshooting. It never leaves your device unless you copy it from the popup yourself.

## Where data is stored

All of the above is kept in `chrome.storage` (local and session storage) inside your Chrome profile. Site icons come from Chrome's own local favicon cache.

## What Bow does not do

- It makes no network requests of its own and has no servers.
- It has no accounts, analytics, tracking, advertising or telemetry.
- It does not sell, transfer or share data with anyone, and does not use data for anything unrelated to its single purpose.

## Removing your data

Remove an app in the popup to delete its stored entry. Uninstalling Bow deletes all of its stored data; your pinned tabs remain as ordinary tabs.

## Changes and contact

Changes to this policy are published in this file in the [Bow repository](https://github.com/IJPP/bow). Questions: [open an issue](https://github.com/IJPP/bow/issues).

---

## 隐私政策（中文）

Bow 不收集、不上传、不出售、不分享任何数据，所有数据只保存在你本机的 Chrome 里。

- **Favorites 设置**：每个 App 的网站、主页地址、名称、图标选项和顺序，用来恢复和切换 App。
- **标签页信息**：通过 Chrome `tabs` API 读取标签页的地址、标题和固定/休眠状态，用来识别哪个标签属于哪个 App、在关闭或重启后恢复，并在弹窗里显示状态。
- **网站声明的名称**：只在你添加的网站上读取页面元数据里网站自己声明的名称（如 `application-name`），不读取其他页面内容。
- **App 内的链接点击**：只在你添加的网站上判断链接该在 App 标签里打开还是在普通标签里打开，只看链接地址，不做记录。
- **诊断日志**：本地的简短事件日志，只有你在弹窗里手动复制时才会离开本机。

以上数据保存在 Chrome 的 `chrome.storage` 中；网站图标来自 Chrome 本地的图标缓存。Bow 自己不发起任何网络请求，没有服务器、账号、统计、追踪或广告。卸载 Bow 即删除其全部数据，固定标签会作为普通标签保留。问题请到 [GitHub Issues](https://github.com/IJPP/bow/issues) 反馈。
