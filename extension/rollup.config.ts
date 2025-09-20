import path from 'path';
import { type RollupOptions } from 'rollup';
import typescript from '@rollup/plugin-typescript';
// import json from '@rollup/plugin-json';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import copy from 'rollup-plugin-copy';

const distDir = 'build';

const config: RollupOptions = {
    // multiple entry points: background, content script, popup etc.
    input: {
        background: 'src/background.ts',
        popup: 'src/popup.ts'
    },
    output: {
        dir: distDir,
        format: 'es',
        sourcemap: true,
        // for content scripts etc, might want individual files
        entryFileNames: '[name].js'
    },
    plugins: [
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
        // Copy static files like manifest.json, icons, popup HTML
        copy({
            targets: [
                { src: 'src/manifest.json', dest: distDir },
                { src: 'src/popup.html', dest: distDir }
            ],
            // flatten or preserve structure options
            // copy once at start
            hook: 'buildStart'
        })
    ],
    // If your extension code uses browser APIs, you may need to externalize certain modules
    external: [],
    watch: {
        include: 'src/**'
    }
};

export default config;
