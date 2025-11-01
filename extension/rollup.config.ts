import path from 'path';
import { type RollupOptions, type Plugin } from 'rollup';
import typescript from '@rollup/plugin-typescript';
// import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';
import postcss from 'rollup-plugin-postcss';
import tailwindcss from '@tailwindcss/postcss';
import autoprefixer from 'autoprefixer';
import stripJsonComments from 'strip-json-comments';
import { globSync } from 'glob';
import url from 'url';
import fs from 'fs/promises';
// @ts-ignore
import webExt from 'web-ext';
import replace from '@rollup/plugin-replace';

const distDir = 'build';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const staticAssetPatterns = [
    'src/**/*.html',
    'src/**/*.json',
    'src/**/*.css',
];

function watchStaticAssets(): Plugin {
    return {
        name: 'watch-static-assets',
        buildStart() {
            // Use globSync to find all files that match the patterns.
            const files = globSync(staticAssetPatterns);

            // Add each found file to Rollup's watch list.
            for (const file of files) {
                this.addWatchFile(path.resolve(__dirname, file));
            }
        }
    };
}

const config: RollupOptions = {
    input: {
        background: 'src/background.ts',
        sidebar: 'src/sidebar.tsx',
        overview: 'src/overview.tsx',
        settings: 'src/settings.tsx',
        new: 'src/new.ts',
    },
    output: {
        dir: distDir,
        format: 'es',
        sourcemap: true,
        entryFileNames: '[name].js',
        assetFileNames: '[name].[extname]',
    },
    watch: {
        include: 'src/**',
        chokidar: {
            // - [rollup.watch stops watching after first change. · Issue #1666 · rollup/rollup](https://github.com/rollup/rollup/issues/1666)
            usePolling: true,
        },
    },
    plugins: [
        replace({
            preventAssignment: true,
            'process.env.NODE_ENV': JSON.stringify('production'),
        }),
        watchStaticAssets(),
        postcss(
            {
                plugins: [
                    tailwindcss(),
                    autoprefixer(),
                ],
                extract: false,
            }
        ),
        resolve({
            browser: true,
            preferBuiltins: false,
            extensions: ['.js', '.jsx', '.ts', '.tsx'],
        }),
        commonjs(),
        typescript({
            tsconfig: './tsconfig.json',
            sourceMap: true,
        }),
        copy({
            targets: [
                { src: 'src/sidebar.html', dest: distDir },
                { src: 'src/overview.html', dest: distDir },
                { src: 'src/settings.html', dest: distDir },
                { src: 'src/new.html', dest: distDir },
            ],
            hook: 'buildEnd',
        }),
        {
            name: "clean-manifest-jsonc",
            buildStart() {
                // Make sure manifest.jsonc is watched so changes trigger rebuilds
                this.addWatchFile(path.resolve("./src/manifest.jsonc"));
            },
            resolveId(importee, importer) {
                // if someone does `import ... from "manifest.jsonc"` (relative or absolute),
                // resolve it to our resolvedId
                const sourcePath = "src/manifest.jsonc";
                const resolvedId = path.resolve(sourcePath);
                if (importee === sourcePath || importee.endsWith("/" + sourcePath)) {
                    return resolvedId;
                }
                return null;
            },
            async load(id) {
                const sourcePath = "src/manifest.jsonc";
                const resolvedId = path.resolve(sourcePath);
                // if this id matches our manifest.jsonc file
                if (id === resolvedId) {
                    const raw = await fs.readFile(resolvedId, "utf-8");
                    const cleaned = stripJsonComments(raw, { trailingCommas: true });
                    let manifestObj;
                    try {
                        manifestObj = JSON.parse(cleaned);
                    } catch (err) {
                        this.error(`Failed to parse manifest.jsonc: ${err}`);
                    }
                    // Return a JS module source exporting the object
                    const code = `export default ${JSON.stringify(manifestObj)};`;
                    return {
                        code,
                        map: { mappings: "" }
                    };
                }
                return null;
            },
            async generateBundle(_options, bundle) {
                const manifestPath = path.resolve("./src/manifest.jsonc");
                let raw: string;
                try {
                    raw = await fs.readFile(manifestPath, "utf-8");
                } catch (err) {
                    this.error(`Could not read manifest.jsonc: ${err}`);
                    return;
                }

                // Strip comments + trailing commas
                const cleaned = stripJsonComments(raw, { trailingCommas: true });

                let manifestObj: any;
                try {
                    manifestObj = JSON.parse(cleaned);
                } catch (err) {
                    this.error(`Error parsing manifest.jsonc after stripping: ${err}`);
                    return;
                }

                // Emit as clean JSON
                const manifestJson = JSON.stringify(manifestObj, null, 2);
                this.emitFile({
                    type: "asset",
                    fileName: "manifest.json",
                    source: manifestJson,
                });
            }
        },
        {
            name: "lint-manifest",
            async writeBundle() {
                await webExt.cmd.lint({ sourceDir: "./build" }, { shouldExitProgram: false });
            },
        },
    ],
    // If your extension code uses browser APIs, you may need to externalize certain modules
    external: [],
};

export default config;
