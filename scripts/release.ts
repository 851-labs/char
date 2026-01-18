import { access, constants, mkdir, readdir, rm, stat, writeFile, cp } from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const requiredEnvNote = `Required env vars:
- DEV_ID_APPLICATION: Codesigns the app bundle and DMG.
- AC_API_KEY_ID / AC_API_KEY: App Store Connect API key for notarization.
- AC_API_ISSUER_ID (optional): Needed for Team API keys.
- SPARKLE_PRIVATE_KEY: Base64 key from Sparkle keychain item (no quotes).`;

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const projectName = "char";
const scheme = "char";
const configuration = "Release";
const buildDir = path.join(rootDir, "build");
const derivedData = path.join(buildDir, "DerivedData");
const appPath = path.join(buildDir, `${projectName}.app`);
const dmgPath = path.join(buildDir, `${projectName}.dmg`);
const dmgName = `${projectName}.dmg`;
const appZipPath = path.join(buildDir, `${projectName}.zip`);
const releaseDir = path.join(buildDir, "release");

const requiredEnv = [
  "DEV_ID_APPLICATION",
  "AC_API_KEY_ID",
  "AC_API_KEY",
  "SPARKLE_PRIVATE_KEY",
];

const env: Record<string, string> = {};
for (const name of requiredEnv) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${requiredEnvNote}\nMissing ${name}`);
  }
  env[name] = value;
}

const devIdApplication = env.DEV_ID_APPLICATION;
const apiKeyId = env.AC_API_KEY_ID;
const apiIssuerId = process.env.AC_API_ISSUER_ID;
const apiKey = env.AC_API_KEY;
const sparklePrivateKey = env.SPARKLE_PRIVATE_KEY;

const run = (command: string, args: string[], options?: { cwd?: string; quiet?: boolean }) => {
  const result = Bun.spawnSync({
    cmd: [command, ...args],
    cwd: options?.cwd,
    env: { ...process.env },
  });
  if (!options?.quiet) {
    if (result.stdout) {
      process.stdout.write(result.stdout);
    }
    if (result.stderr) {
      process.stderr.write(result.stderr);
    }
  }
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}`);
  }
  return result;
};

const ensureExecutable = async (filePath: string) => {
  await access(filePath, constants.X_OK);
};

const findSparkleBin = async () => {
  const candidates: string[] = [];
  const envBin = process.env.SPARKLE_BIN;
  if (envBin) {
    candidates.push(envBin);
  }
  candidates.push(path.join(os.homedir(), ".local/bin"));

  const caskRoots = ["/opt/homebrew/Caskroom/sparkle", "/usr/local/Caskroom/sparkle"];
  for (const root of caskRoots) {
    try {
      const versions = await readdir(root);
      const fullPaths = versions.map((version) => path.join(root, version, "bin"));
      fullPaths.sort().reverse();
      candidates.push(...fullPaths);
    } catch {
      // ignore missing cask roots
    }
  }

  for (const candidate of candidates) {
    const signUpdate = path.join(candidate, "sign_update");
    const generateAppcast = path.join(candidate, "generate_appcast");
    try {
      await ensureExecutable(signUpdate);
      await ensureExecutable(generateAppcast);
      return { signUpdate, generateAppcast };
    } catch {
      // continue searching
    }
  }

  throw new Error("Missing Sparkle tools. Install with: brew install sparkle");
};

const main = async () => {
  await mkdir(buildDir, { recursive: true });
  await mkdir(releaseDir, { recursive: true });

  const notaryDir = await makeTempDir("notary");
  const notaryKeyPath = path.join(notaryDir, "AuthKey.p8");
  await writeFile(notaryKeyPath, apiKey);

  try {
    run(
      "xcodebuild",
      [
        "-project",
        `${projectName}.xcodeproj`,
        "-scheme",
        scheme,
        "-configuration",
        configuration,
        "-derivedDataPath",
        derivedData,
        "-destination",
        "platform=macOS,arch=arm64",
        `CODE_SIGN_IDENTITY=${devIdApplication}`,
        "CODE_SIGN_STYLE=Manual",
        "build",
      ],
      { cwd: rootDir }
    );

    const builtApp = path.join(derivedData, "Build/Products", configuration, `${projectName}.app`);
    await ensureExists(builtApp);

    await rm(appPath, { recursive: true, force: true });
    await rm(dmgPath, { force: true });
    await rm(appZipPath, { force: true });
    await cp(builtApp, appPath, { recursive: true });

    const entitlementsPath = path.join(buildDir, "release-entitlements.plist");
    await writeFile(
      entitlementsPath,
      `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <true/>
  <key>com.apple.security.files.user-selected.read-only</key>
  <true/>
</dict>
</plist>
`
    );

    await signSparkle(appPath, devIdApplication);
    await signApp(appPath, devIdApplication, entitlementsPath);

    run("/usr/bin/ditto", ["-c", "-k", "--keepParent", appPath, appZipPath]);

    const appNotary = run(
      "xcrun",
      [
        "notarytool",
        "submit",
        appZipPath,
        "--key",
        notaryKeyPath,
        "--key-id",
        apiKeyId,
        ...(apiIssuerId ? ["--issuer", apiIssuerId] : []),
        "--wait",
        "--output-format",
        "json",
      ],
      { quiet: true }
    );

    const appNotaryJson = appNotary.stdout ? new TextDecoder().decode(appNotary.stdout).trim() : "";
    if (appNotaryJson) {
      console.log(appNotaryJson);
    }

    const appNotaryData = appNotaryJson ? JSON.parse(appNotaryJson) : null;
    const appNotaryStatus = appNotaryData?.status;
    if (appNotaryStatus && appNotaryStatus !== "Accepted") {
      if (appNotaryData?.id) {
        console.log(`Notarization failed for app zip. Submission id: ${appNotaryData.id}`);
        printNotaryLogHint(appNotaryData.id);
      }
      process.exit(1);
    }

    run("xcrun", ["stapler", "staple", appPath]);

    await rm(appZipPath, { force: true });

    const tmpDmgDir = path.join(buildDir, "dmg");
    await rm(tmpDmgDir, { recursive: true, force: true });
    await mkdir(tmpDmgDir, { recursive: true });
    await cp(appPath, path.join(tmpDmgDir, `${projectName}.app`), { recursive: true });

    run("hdiutil", [
      "create",
      "-volname",
      projectName,
      "-srcfolder",
      tmpDmgDir,
      "-ov",
      "-format",
      "UDZO",
      dmgPath,
    ]);

    run("codesign", ["--force", "--timestamp", "--sign", devIdApplication, dmgPath]);

    const dmgNotary = run(
      "xcrun",
      [
        "notarytool",
        "submit",
        dmgPath,
        "--key",
        notaryKeyPath,
        "--key-id",
        apiKeyId,
        ...(apiIssuerId ? ["--issuer", apiIssuerId] : []),
        "--wait",
        "--output-format",
        "json",
      ],
      { quiet: true }
    );

    const dmgNotaryJson = dmgNotary.stdout ? new TextDecoder().decode(dmgNotary.stdout).trim() : "";
    if (dmgNotaryJson) {
      console.log(dmgNotaryJson);
    }

    const dmgNotaryData = dmgNotaryJson ? JSON.parse(dmgNotaryJson) : null;
    const dmgNotaryStatus = dmgNotaryData?.status;
    if (dmgNotaryStatus && dmgNotaryStatus !== "Accepted") {
      if (dmgNotaryData?.id) {
        console.log(`Notarization failed for DMG. Submission id: ${dmgNotaryData.id}`);
        printNotaryLogHint(dmgNotaryData.id);
      }
      process.exit(1);
    }

    run("xcrun", ["stapler", "staple", dmgPath]);

    const { signUpdate, generateAppcast } = await findSparkleBin();
    const sparkleKeyPath = path.join(buildDir, "sparkle_private_key");
    await writeFile(sparkleKeyPath, sparklePrivateKey.trim());

    try {
      const signResult = run(signUpdate, ["-f", sparkleKeyPath, dmgPath]);
      await cp(dmgPath, path.join(releaseDir, dmgName));
      run(generateAppcast, ["--ed-key-file", sparkleKeyPath, "-o", path.join(releaseDir, "appcast.xml"), releaseDir]);
      const signature = signResult.stdout ? new TextDecoder().decode(signResult.stdout).trim() : "";
      if (signature) {
        console.log(`Signature: ${signature}`);
      }
    } finally {
      await rm(sparkleKeyPath, { force: true });
    }

    await rm(entitlementsPath, { force: true });

    console.log(`Release artifacts ready in ${releaseDir}`);
    console.log(`- ${dmgName}`);
    console.log("- appcast.xml");
  } finally {
    await rm(notaryDir, { recursive: true, force: true });
  }

};

const ensureExists = async (targetPath: string) => {
  try {
    const info = await stat(targetPath);
    if (!info.isDirectory()) {
      throw new Error(`${targetPath} is not a directory`);
    }
  } catch {
    throw new Error(`Built app not found at ${targetPath}`);
  }
};

const printNotaryLogHint = (submissionId: string) => {
  const base = "xcrun notarytool log";
  const keyArgs = apiIssuerId
    ? `--key \"/path/to/AuthKey.p8\" --key-id ${apiKeyId} --issuer ${apiIssuerId}`
    : `--key \"/path/to/AuthKey.p8\" --key-id ${apiKeyId}`;
  console.log(`Fetch log: ${base} ${submissionId} ${keyArgs}`);
};

const signSparkle = async (appBundlePath: string, identity: string) => {
  const sparkleFramework = path.join(appBundlePath, "Contents/Frameworks/Sparkle.framework");
  const sparkleVersion = path.join(sparkleFramework, "Versions/B");
  const updaterApp = path.join(sparkleVersion, "Updater.app");
  const autoupdate = path.join(sparkleVersion, "Autoupdate");
  const downloaderXpc = path.join(sparkleVersion, "XPCServices/Downloader.xpc");
  const installerXpc = path.join(sparkleVersion, "XPCServices/Installer.xpc");

  const signIfExists = async (target: string, args: string[]) => {
    try {
      await access(target);
      run("/usr/bin/codesign", ["--force", "--options", "runtime", "--timestamp", "--sign", identity, ...args, target]);
    } catch {
      // ignore missing Sparkle components
    }
  };

  await signIfExists(path.join(updaterApp, "Contents/MacOS/Updater"), []);
  await signIfExists(autoupdate, []);
  await signIfExists(path.join(downloaderXpc, "Contents/MacOS/Downloader"), []);
  await signIfExists(path.join(installerXpc, "Contents/MacOS/Installer"), []);
  await signIfExists(updaterApp, []);
  await signIfExists(downloaderXpc, []);
  await signIfExists(installerXpc, []);

  await signIfExists(sparkleFramework, []);
};

const signApp = async (appBundlePath: string, identity: string, entitlementsPath: string) => {
  run("/usr/bin/codesign", [
    "--force",
    "--options",
    "runtime",
    "--timestamp",
    "--entitlements",
    entitlementsPath,
    "--sign",
    identity,
    appBundlePath,
  ]);
};

const makeTempDir = async (prefix: string) => {
  const base = path.join(os.tmpdir(), `${prefix}-`);
  const temp = Bun.spawnSync({ cmd: ["/usr/bin/mktemp", "-d", `${base}XXXXXX`] });
  if (temp.exitCode !== 0 || !temp.stdout) {
    throw new Error("Failed to create temporary directory");
  }
  return new TextDecoder().decode(temp.stdout).trim();
};

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
