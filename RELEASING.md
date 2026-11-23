# Releasing a new version

Publishing a version = pushing a **tag**. GitHub Actions does the rest, and every installed copy of
MediaFlow Studio offers the update on its next launch.

## The 3 commands

Run them in the project folder, with your changes already committed:

```powershell
npm version patch          # 1.0.0 → 1.0.1   (use minor for 1.1.0, major for 2.0.0)
git push                   # sends the commit npm just made
git push --tags            # sends the tag vX.Y.Z → starts the release build
```

`npm version` updates `package.json`, commits it, and creates the matching tag in one step.

## What happens next (≈ 10 minutes)

1. **GitHub Actions** ([`.github/workflows/release.yml`](.github/workflows/release.yml)) runs on Windows: install → tests → build.
2. It publishes a **GitHub Release** named *MediaFlow Studio X.Y.Z* with:

   | File | Used by |
   | :-- | :-- |
   | `MediaFlow-Studio-Setup.exe` | new users (README download button) **and** the auto-updater |
   | `MediaFlow-Studio-Setup.exe.blockmap` | the auto-updater (downloads only what changed) |
   | `latest.yml` | the auto-updater (version + checksum it compares against) |
   | `MediaFlow-Studio-Portable.exe` | portable users |

   The text comes from [`.github/RELEASE_TEMPLATE.md`](.github/RELEASE_TEMPLATE.md) plus the list of commits since the last release.
3. **Installed apps** check GitHub a few seconds after launch (or via *Check for updates* in the sidebar), show the
   *Update available* banner, download in the background, then *Restart & Install*.
   The portable version shows the banner with a *Download* button instead (it can't replace itself).

Follow the build in the **Actions** tab of the repository. Edit the release text afterwards on GitHub if you want.

## Rules the updater relies on

- **The version must go up.** Installed apps only update to a higher version than their own.
- **Don't rename the release files** — `latest.yml` points to `MediaFlow-Studio-Setup.exe`.
- **Publish, don't draft.** The updater ignores draft and pre-release releases.
- **The repository must stay public** (or the app can't read its releases).

## If something goes wrong

- **Build failed** → open the failed run in the *Actions* tab, fix, commit, then move the tag to the new commit:
  ```powershell
  git tag -d v1.0.1; git push origin :refs/tags/v1.0.1
  git tag v1.0.1; git push --tags
  ```
- **A bad version went out** → publish a new, higher version with the fix (e.g. 1.0.2). Users update on next launch.
- **Test a build without publishing** → *Actions* tab → *Release* → *Run workflow*: the installers are attached to the run as artifacts.

## Build locally (optional)

```powershell
npm run dist      # dist/MediaFlow-Studio-Setup.exe, dist/MediaFlow-Studio-Portable.exe, dist/latest.yml
```
