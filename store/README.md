# Chrome Web Store 上架材料

这个目录是发布到 Chrome 应用商店要用的全部材料。

| 文件 | 用途 |
| --- | --- |
| `listing-en.txt` | 英文商品描述（Description），直接粘贴 |
| `listing-zh-CN.txt` | 中文商品描述，在 Store listing 里切到“中文（简体）”后粘贴 |
| `privacy-practices.md` | Privacy 标签页：单一用途、每个权限的理由、数据使用勾选项 |
| `../PRIVACY.md` | 隐私政策，链接填 `https://github.com/IJPP/bow/blob/main/PRIVACY.md` |
| `images/` | 图标、截图、宣传图 |
| `compose.html` + `render.mjs` | 生成上面这些图的源文件 |

## 图片

| 位置 | 文件 | 尺寸 |
| --- | --- | --- |
| Store icon | `store-icon-128.png` | 128×128（96 图形 + 16 透明边） |
| Screenshots（英文） | `screenshot-en-1…4.png` | 1280×800 |
| Screenshots（中文） | `screenshot-zh-1…4.png` | 1280×800 |
| Small promo tile | `promo-small-en.png` / `-zh` | 440×280 |
| Marquee promo tile | `promo-marquee-en.png` / `-zh` | 1400×560（可选） |

重新生成：先 `npm run dev -- --port 5191`，再 `npm run store:images`。

## 上架步骤

1. **注册开发者账号**：https://chrome.google.com/webstore/devconsole ，一次性 5 美元注册费，账号需开启两步验证。
2. **上传包**：点 “New item”，上传本目录里的 `bow-v版本号.zip`（`npm run package` 生成，manifest 在根目录，已去掉 source map；zip 不进 git，只在本地）。
3. **Store listing**
   - Description：粘贴 `listing-en.txt`；再加中文（简体）语言，粘贴 `listing-zh-CN.txt`。名称和简介会自动读取 `_locales`。
   - Category：Productivity → Tools。Language：English（并添加 Chinese (Simplified)）。
   - 上传图标、截图（按 1→4 顺序）、Small promo tile，可选 Marquee。
   - Homepage URL：`https://github.com/IJPP/bow`；Support URL：`https://github.com/IJPP/bow/issues`。
4. **Privacy**：照 `privacy-practices.md` 填写。
5. **Distribution**：Public，所有地区，免费。
6. 提交审核。因为申请了所有 http/https 网站的访问权限，会走“深度审核”，通常要几天到一两周。

## 注意

- **扩展 ID 会变**：商店会分配新的 ID，和你本地以“加载已解压的扩展程序”装的 GitHub 版不同，两边的数据不互通。迁移方法：先移除 GitHub 版（固定标签会留下），再装商店版，它会自动把现有固定标签认成 App；自定义的名称和主页需要重新设置。
- **商店文案里不要提 Arc**，避免商标和“关键词堆砌”问题；README 里的说明不受影响。
- 以后发版：改 `package.json` 和 `public/manifest.json` 的版本号 → `npm run package` → 在后台 Package 标签上传本目录里新的 `bow-v版本号.zip`。GitHub Release 只放同一个 zip，不再打 CRX。
