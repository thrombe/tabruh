import webExt from 'web-ext';
import fs from 'fs/promises';
import path from 'path';

async function main() {
    let lastArg = process.argv[process.argv.length - 1];
    if (!lastArg || lastArg.startsWith('-')) lastArg = 'firefox';

    const IS_FF = lastArg.includes('irefox') || lastArg.includes('loorp') || lastArg.includes('zen');
    const cliOpts = {
        sourceDir: "./build",
        keepProfileChanges: true,
        devtools: true,
    };

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

    webExt.cmd.run(cliOpts, { shouldExitProgram: true });
}
main();
