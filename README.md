# Hub

A personal dashboard that opens your work and school apps and websites, and draws how they connect. Runs on Windows and Mac, and updates itself from GitHub.

## What's new in 1.1

- **Areas.** Make a node for *Work*, another for *School*, and connect the apps and sites that belong to each. An area opens nothing; it is just the hub the others hang off. Each area has its own color, and everything in it shares that color.
- **Focus.** The dropdown next to the search box narrows the list and zooms the map to one area (for example, only School).
- **Automatic updates** from GitHub releases.
- Fixed: items without notes showed the word "null" in the side panel.

## Run it while developing

1. Install [Node.js](https://nodejs.org) (LTS).
2. In this folder: `npm install`, then `npm start`.

`npm start` runs without the update feature (it only works in the installed app).

---

## Set up updates (one time, about 10 minutes)

Updates work like this: you push a new version to GitHub, GitHub builds the Windows and Mac installers for you, and every installed copy of Hub notices the new release and updates itself.

1. **Create a GitHub repository** called `hub` (or any name). Make it **public**. A private repository would require every computer to carry an access token, and nothing in this project is secret: your personal data is stored on your computer, never in the repository.
2. **Tell Hub where it lives.** In `package.json`, replace `YOUR-GITHUB-USERNAME` (it appears twice: in `repository` and in `build > publish`) and, if you named the repository something else, change `repo` too. Also set `author`.
3. **Push the code** (from this folder):

   ```
   git init
   git add .
   git commit -m "Hub 1.1.0"
   git branch -M main
   git remote add origin https://github.com/YOUR-GITHUB-USERNAME/hub.git
   git push -u origin main
   ```
4. **Publish the first version.** The version in `package.json` is `1.1.0`, so tag it:

   ```
   git tag v1.1.0
   git push origin v1.1.0
   ```

   Open the **Actions** tab on GitHub and watch the *Release* job. After a few minutes the **Releases** page has the installers: a `.exe` for Windows, and `.dmg` files for Mac (pick *arm64* for M1/M2/M3/M4 Macs, *x64* for Intel).
5. **Install it** on each computer from that page. This is the last manual install: from now on the app updates itself.

### Shipping an update

Make your changes, commit them, then run one command:

```
npm run release
```

That raises the version by 0.0.1 (for example 1.1.0 to 1.1.1), makes a commit and a tag, and pushes both. GitHub builds and publishes the release. Use `npm run release:minor` for a bigger step (1.1.1 to 1.2.0). Your working folder must be committed first, or `npm version` will refuse.

### What users see

Hub checks shortly after it starts and every four hours.

- **Windows:** the update downloads in the background. The footer shows "Version X is ready" with a **Restart to update** button. If you ignore it, it installs the next time you close Hub.
- **Mac:** the footer shows "Version X is available" with a **Download** button that opens the release page. You drag the new app into Applications. This is a limit of Apple, not of Hub: a Mac app can only replace itself if it is signed with a paid Apple Developer ID certificate. If you ever get one, sign the build and set `"macAutoInstall": true` under `"hub"` in `package.json`, and Macs will update themselves like Windows does.
- **Data > Check for updates** checks on demand, and the **Data** window shows the installed version.

### First launch warnings

The installers are not code-signed (that costs money), so each computer warns once:

- **Windows:** "Windows protected your PC": choose **More info**, then **Run anyway**. Updates after that install quietly.
- **Mac:** right-click the app and choose **Open**. If macOS says the app is "damaged", run `xattr -cr /Applications/Hub.app` in Terminal once.

---

## Using Hub

### Areas: work, school, and anything else

1. **Add item**, choose type **Area**, name it (*Work*, *School*), and pick a color.
2. Add websites and apps. In **Group**, type the area's name. The item is connected to the area automatically, and you can also draw connections by hand with **Connect to...**.
3. Items can connect to several things at once. A calendar that you use for both work and school can be connected to both areas.

Details worth knowing:

- Double-clicking an area, or pressing Enter in search, never opens anything. Search skips areas.
- Renaming an area renames the group of everything in it, so colors and focus keep working.
- Connections you remove by hand stay removed; Hub only auto-connects when an item is new or you change its group.
- Deleting an area keeps its items; they get an automatic color instead.

### Everything else

- **Add item**: a website (an address) or a desktop app (a path). For apps, fill in the Windows path, the Mac path, or both. Hub opens the one for the computer it is running on.
- **Open**: the Open button in the list or side panel, a double-click on a node, or type in the search box (Ctrl or Cmd + K) and press Enter to open the top match.
- **Logos**: found automatically (a website's own icon, or an app's icon), or choose any image. Logos are stored in the data file, so they sync too.
- **Connect**: select an item, choose **Connect to...**, then click the other item. Type a label in the side panel to say how they relate. Arrows show direction between ordinary items; links to an area have no arrow.
- **Map**: drag nodes, scroll to zoom, drag the background to pan. Hexagons are areas, circles are websites, rounded squares are apps. **Tidy layout** groups each area with its items. **Fit to view** recenters.

## Use it on several computers

Open **Data**, choose **Change data file location**, and put the file in a folder your cloud storage syncs (OneDrive, Dropbox, iCloud Drive). On the other computer choose the same file with **Use an existing file**. Edits made on one computer appear on the other after the sync finishes. If both are edited at once the last save wins, so keep one open at a time.

**Keep every computer on the same version.** Data files from 1.1 contain areas, and an older copy of Hub does not know what an area is. Let every computer update before you rely on the shared file. Older data files open fine in 1.1; nothing needs converting.

By default the data lives in your user profile (`hub-data.json`). **Export a backup** saves a copy you can import later. The update process never touches this file.

## Notes

- Website logos are looked up online with only the site's address (Google's icon service first, then DuckDuckGo's). Pick your own image if you would rather not.
- Websites with no `https://` get it added. Custom links such as `slack://open` work. `file:` and `javascript:` links are blocked.
- The app is sandboxed: the screen can only ask the main process to open an item, read and write the data file, and check for updates.
- Electron gets security fixes often. Now and then run `npm install -D electron@latest` and ship a release.
- Files: `main.js` (windows, storage, launching, updates), `preload.js` (the bridge), `src/graph.js` (the map and layout), `src/app.js` (everything else), `.github/workflows/release.yml` (builds releases).

## If something goes wrong

- **"Updates are not set up yet"**: the GitHub username in `package.json` is still the placeholder. Fix it, then publish a new release; installed copies need a version built with the right address.
- **"No published release was found yet"**: the Release job on GitHub has not finished or failed. Check the Actions tab.
- **Mac says there is an update but nothing installs by itself**: expected, see "What users see".
