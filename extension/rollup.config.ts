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
import { globSync } from 'glob';
import url from 'url';

const distDir = 'build';

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const staticAssetPatterns = [
    'src/**/*.html',
    'src/**/*.json',
    'src/**/*.css',
];


/**
 * A custom Rollup plugin that finds all static assets via glob patterns
 * and adds them to Rollup's watch list.
 */
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
    // multiple entry points: background, content script, popup etc.
    input: {
        background: 'src/background.ts',
        sidebar: 'src/sidebar.ts',
        popup: 'src/popup.ts'
    },
    output: {
        dir: distDir,
        format: 'es',
        sourcemap: true,
        entryFileNames: '[name].js',
        assetFileNames: '[name].[extname]',
    },
    plugins: [
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
            preferBuiltins: false
        }),
        commonjs(),
        // json(),
        typescript({
            tsconfig: './tsconfig.json',
            sourceMap: true,
            // Optionally override some TS compiler options
            // e.g. target, module etc
        }),
        copy({
            targets: [
                { src: 'src/manifest.json', dest: distDir },
                { src: 'src/sidebar.html', dest: distDir },
                { src: 'src/popup.html', dest: distDir },
            ],
            hook: 'buildEnd',
        })
    ],
    // If your extension code uses browser APIs, you may need to externalize certain modules
    external: [],
    watch: {
        include: 'src/**'
    }
};

export default config;
