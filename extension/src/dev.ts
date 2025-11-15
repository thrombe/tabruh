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

    const cliOpts: Record<string, any> = {
        sourceDir: "./build",
    };

    if (command === 'run') {
        let lastArg = args.length > 0 && args[args.length - 1]! !== 'run' ? args[args.length - 1]! : 'firefox';

        const is_ff = lastArg.includes('irefox') || lastArg.includes('loorp') || lastArg.includes('zen');

        cliOpts.keepProfileChanges = true;
        cliOpts.devtools = true;

        if (is_ff) {
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
    } else if (command === "sign" || command === "publish") {
        const manifest = await get_manifest();
        const name = manifest["name"];
        const version = manifest["version"];

        const src_zip = `./build_artifacts/${name}-src-v${version}.zip`;
        await promisify(exec)(`git -C "$(git rev-parse --show-toplevel)" archive --format=zip -o ./extension/${src_zip} HEAD`);

        // - [web-ext command reference | Firefox Extension Workshop](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign)
        await webExt.cmd.sign({
            artifactsDir: './build_artifacts',
            amoBaseUrl: 'https://addons.mozilla.org/api/v5/',
            apiKey: env["FF_API_USER"],
            apiSecret: env["FF_API_KEY"],
            amoMetadata: './amo-meta.json',
            sourceDir: './build',
            uploadSourceCode: src_zip,
            channel: command === "publish" ? "listed" : "unlisted",
            approvalCheckTimeout: command === "publish" ? 0 : undefined,
        });
    }
}

main().catch(console.error);
