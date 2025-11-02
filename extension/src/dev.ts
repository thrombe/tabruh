import webExt from 'web-ext';
import fs from 'fs/promises';
import path from 'path';
import stripJsonComments from 'strip-json-comments';
import { exec } from 'child_process';
import { promisify } from 'util';

async function get_manifest() {
    const manifestPath = path.resolve("./src/manifest.jsonc");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const cleaned = stripJsonComments(raw, { trailingCommas: true });
    const manifest = JSON.parse(cleaned);
    return manifest;
}

async function main() {
    const args = process.argv.slice(2);
    const command = args.includes('build') ? 'build' : 'run';

    // Use last argument for browser binary/profile detection unless it's "build"
    // So if "build" is last arg, fallback to "firefox"
    let lastArg = args.length > 0 && args[args.length - 1]! !== 'build' ? args[args.length - 1]! : 'firefox';

    const IS_FF = lastArg.includes('irefox') || lastArg.includes('loorp') || lastArg.includes('zen');
    const cliOpts: Record<string, any> = {
        sourceDir: "./build",
    };

    if (command === 'run') {
        cliOpts.keepProfileChanges = true;
        cliOpts.devtools = true;

        if (IS_FF) {
            cliOpts.firefox = lastArg;
            cliOpts.firefoxProfile = './tmp/profile-' + path.basename(lastArg).split(".")[0];
            await fs.mkdir(cliOpts.firefoxProfile, { recursive: true });
        } else {
            cliOpts.target = "chromium";
            cliOpts.chromiumBinary = lastArg;
            cliOpts.args = ["--disable-features=WaylandFractionalScaleV1"];
            cliOpts.chromiumProfile = './tmp/profile-' + path.basename(lastArg).split(".")[0];
            await fs.mkdir(cliOpts.chromiumProfile, { recursive: true });
        }

        await webExt.cmd.run(cliOpts, { shouldExitProgram: true });
    } else if (command === 'build') {
        cliOpts.artifactsDir = './build_artifacts';

        await fs.rm(cliOpts.artifactsDir, { recursive: true, force: true });

        const manifest = await get_manifest();
        const name = manifest["name"];
        const version = manifest["version"];

        cliOpts.filename = `${name}-v${version}.zip`;
        await webExt.cmd.build(cliOpts, { shouldExitProgram: true });
        await promisify(exec)(`git -C "$(git rev-parse --show-toplevel)" archive --format=zip -o ./extension/build_artifacts/${name}-src-v${version}.zip HEAD`);
    }
}

main().catch(console.error);
