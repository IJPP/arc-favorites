# Privacy practices tab

Text to paste into the Chrome Web Store Developer Dashboard, **Privacy** tab.

## Single purpose

> Bow turns the user's pinned tabs into persistent "apps": it remembers which pinned tabs are apps, keeps exactly one tab per app, restores them after they are closed or Chrome restarts, lets the user switch to them from a toolbar popup, and decides whether links clicked inside an app open in that tab or in a normal tab.

## Permission justifications

**tabs**
> Bow reads the URL, title, pinned, discarded and audible state of tabs to recognise which tab belongs to which app, to switch to, pin, discard (sleep) and restore app tabs, and to show each app's state in the popup.

**storage**
> Stores the user's list of apps (site, home page, name, order) and a short local diagnostic log in chrome.storage on the device. Session storage tracks which tab currently belongs to each app.

**contextMenus**
> Adds one item, "Add to Favorites (pin tab)", to the page's right-click menu so the user can add the current site as an app.

**scripting**
> On sites the user has added as apps only, Bow injects a small script that (1) reads the name the site declares in its page metadata (application-name / apple-mobile-web-app-title / og:site_name) to name the app, (2) handles link clicks so links to other sites open in a normal tab instead of replacing the app, and (3) shows a brief "switched to your existing app" hint. It does not read or transmit other page content.

**favicon**
> Shows each app's icon in the popup from Chrome's local favicon cache, without any network request.

**Host permissions (http://\*/\*, https://\*/\*)**
> Users can add any website as an app, so Bow cannot know the sites in advance. Host access is needed to inject the link-handling and app-name script described above into the sites the user has added. Bow does not run on sites the user has not added, makes no network requests, and the user can restrict site access in Chrome at any time (the popup then explains that link rules are off and offers to re-enable them).

## Remote code

> No, I am not using remote code. All JavaScript is included in the package.

## Data usage

Leave **every** data type unchecked. Bow does not collect or transmit user data: everything it reads stays on the device in chrome.storage, and it makes no network requests.

Tick all three certifications:

- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

## Privacy policy URL

https://github.com/IJPP/bow/blob/main/PRIVACY.md
