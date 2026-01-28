---
name: release
description: Release char macOS app. Bumps version, updates changelog, creates git tag, monitors CI, verifies release assets, and updates Homebrew tap. Use when releasing a new version.
---

# char Release Process

Follow these steps to ship a new macOS release for char.

## Pre-flight Checks

Before starting:
1. Verify you're on the `main` branch
2. Ensure working tree is clean (no uncommitted changes)
3. Pull latest changes: `git pull origin main`

```bash
git status
git branch --show-current
```

Ensure these prerequisites are in place:
- Developer ID Application certificate installed (Keychain Access)
- App Store Connect API key created (Key ID, Issuer ID, `.p8`)
- Sparkle private key available (from Keychain or `generate_keys`)
- Homebrew tap repo: `851-labs/homebrew-tap`

Create `.env` from `.env.example`:

```bash
DEVELOPER_ID_APPLICATION="Developer ID Application: Your Name (TEAMID)"
APP_STORE_CONNECT_KEY_ID="YOUR_KEY_ID"
APP_STORE_CONNECT_ISSUER_ID="YOUR_ISSUER_ID"
APP_STORE_CONNECT_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
SPARKLE_PRIVATE_KEY="BASE64_KEY_FROM_SPARKLE_KEYCHAIN_ITEM_WITH_PADDING"
```

appdrop automatically loads `.env` from the repo root.

## Step 1: Bump Version

Update versions in `char.xcodeproj/project.pbxproj`:

- `MARKETING_VERSION` - Bump the patch version (e.g. 1.0.9 -> 1.0.10).
- `CURRENT_PROJECT_VERSION` - Increment the integer by 1

Use the Edit tool to update both occurrences of each version field.

Commit the version bump:
```bash
git add char.xcodeproj/project.pbxproj
git commit -m "chore: bump version to X.Y.Z"
```

## Step 2: Update Changelog

Check commits since the last tag:
```bash
git log $(git describe --tags --abbrev=0)..HEAD --oneline
```

Add release notes to `CHANGELOG.md` under a new version heading. Only include meaningful changes (features, fixes, docs). Skip version-bump-only entries.

Commit the changelog:
```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for X.Y.Z"
```

## Step 3: Create and Push Tag

Create a git tag and push it to trigger the Release workflow:

```bash
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

## Step 4: Monitor CI

Watch the Release workflow:

```bash
gh run list --workflow Release --limit 1
gh run watch
```

If no run shows up yet, wait a moment and retry until it appears:

```bash
sleep 10
gh run list --workflow Release --limit 1
```

If the workflow fails, inspect logs:
```bash
gh run view --log-failed
```

## Step 5: Verify Release Assets

Confirm the release has the required assets:

```bash
gh release view vX.Y.Z --json url,assets
```

Required assets:
- `char.dmg`
- `appcast.xml`

## Step 6: Update Homebrew Tap

1. Download the DMG and compute SHA256:
   ```bash
   gh release download vX.Y.Z --pattern "*.dmg" --dir /tmp
   shasum -a 256 /tmp/char.dmg
   ```

2. Update `851-labs/homebrew-tap` repository:
   - Edit `Casks/char.rb`
   - Set `version "X.Y.Z"`
   - Set `sha256 "<computed-hash>"`

3. Commit and push the tap update

4. Validate the install:
   ```bash
   brew update
   brew upgrade --cask 851-labs/tap/char
   ```

## Troubleshooting

### Notarization Delays

Notarization can take 10-45 minutes depending on Apple queue load. appdrop prints submission IDs, and you can query them:

```bash
xcrun notarytool info <submission-id> \
  --key <AuthKey.p8> \
  --key-id <KEY_ID> \
  --issuer <ISSUER_ID> \
  --output-format json
```

Fetch the detailed log:

```bash
xcrun notarytool log <submission-id> \
  --key <AuthKey.p8> \
  --key-id <KEY_ID> \
  --issuer <ISSUER_ID>
```

For faster local iteration, you can skip notarization:

```bash
appdrop release --no-notarize
```

## Sparkle Feed

The appcast URL for automatic updates:

```
https://github.com/851-labs/char/releases/latest/download/appcast.xml
```
