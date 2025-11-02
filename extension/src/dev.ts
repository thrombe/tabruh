import webExt from 'web-ext';
import fs from 'fs/promises';
import path from 'path';
import stripJsonComments from 'strip-json-comments';
import { exec } from 'child_process';
import { promisify } from 'util';
import { config } from 'dotenv';

async function get_manifest() {
    const manifestPath = path.resolve("./src/manifest.jsonc");
    const raw = await fs.readFile(manifestPath, "utf-8");
    const cleaned = stripJsonComments(raw, { trailingCommas: true });
    const manifest = JSON.parse(cleaned);
    return manifest;
}

async function main() {
    const { parsed: _env } = config({ quiet: true });
    const env = _env as any;

    const args = process.argv.slice(2);
    const command = args[0]!;

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

        const manifest = await get_manifest();
        const name = manifest["name"];
        const version = manifest["version"];

        const src_zip = `./build_artifacts/${name}-src-v${version}.zip`;
        await promisify(exec)(`git -C "$(git rev-parse --show-toplevel)" archive --format=zip -o ./extension/${src_zip} HEAD`);

        cliOpts.filename = `${name}-v${version}.zip`;
        await webExt.cmd.build(cliOpts, { shouldExitProgram: true });
    } else if (command === "sign") {
        const manifest = await get_manifest();
        const name = manifest["name"];
        const version = manifest["version"];

        const src_zip = `./build_artifacts/${name}-src-v${version}.zip`;
        await promisify(exec)(`git -C "$(git rev-parse --show-toplevel)" archive --format=zip -o ./extension/${src_zip} HEAD`);

        const api_key = env["FF_API_USER"];
        const api_secret = env["FF_API_KEY"];
        const artifacts_dir = './build_artifacts';
        const amo_meta = './amo-meta.json';
        const source_dir = './build';
        await promisify(exec)(`bun x web-ext sign --api-key="${api_key}" --api-secret="${api_secret}" --channel=unlisted --amo-metadata="${amo_meta}" --source-dir="${source_dir}" --artifacts-dir="${artifacts_dir}" --upload-source-code="${src_zip}"`);

        // TODO: throws error
        // await webExt.cmd.sign({
        //     artifactsDir: './build_artifacts',
        //     amoBaseUrl: 'https://addons.mozilla.org',
        //     apiKey: env["FF_API_USER"],
        //     apiSecret: env["FF_API_KEY"],
        //     amoMetadata: './amo-meta.json',
        //     sourceDir: './build',
        //     uploadSourceCode: src_zip,
        //     channel: "unlisted",
        // });
    }
}

main().catch(console.error);
