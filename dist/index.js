import path from "node:path";
import fsp from "node:fs/promises";
const OUT_DIR = ".deno-deploy";
export default function denoAdapter() {
    return {
        name: "@deno/svelte-adapter",
        async adapt(builder) {
            builder.rimraf(OUT_DIR);
            const dirs = {
                static: `${OUT_DIR}/static${builder.config.kit.paths.base}`,
                server: `${OUT_DIR}/server`,
            };
            try {
                await fsp.mkdir(dirs.server, { recursive: true });
            }
            catch {
                // ignore
            }
            builder.log.minor("Copying assets...");
            builder.writeClient(dirs.static);
            builder.writePrerendered(dirs.static);
            builder.log.minor("Building server entry...");
            builder.writeServer(dirs.server);
            if (builder.hasServerInstrumentationFile()) {
                builder.log.minor("Instrumenting server...");
                builder.instrument({
                    entrypoint: `${dirs.server}/index.js`,
                    instrumentation: `${dirs.server}/instrumentation.server.js`,
                    module: {
                        exports: ["Server"],
                    },
                });
            }
            const staticFiles = [];
            const redirects = [];
            const rewrites = [];
            for (const [pathname, data] of builder.prerendered.pages.entries()) {
                staticFiles.push({
                    source: pathname,
                    destination: path.join(dirs.static, data.file),
                });
                // Add redirect
                if (pathname !== "/") {
                    const trailing = pathname.endsWith("/");
                    redirects.push({
                        source: trailing ? pathname.slice(0, -1) : pathname + "/",
                        destination: pathname,
                        permanent: true,
                    });
                }
            }
            const svelteData = {
                isr: [],
            };
            // ISR
            for (const page of builder.routes) {
                // ISR cannot be use with prerendering together
                if (page.prerender)
                    continue;
                const isr = page.config.isr;
                if (isr !== undefined) {
                    svelteData.isr.push({
                        pattern: {
                            source: page.pattern.source,
                            flags: page.pattern.flags,
                        },
                        expiration: isr.expiration ?? 604800,
                        bypassToken: isr.bypassToken ?? null,
                        allowQuery: isr.allowQuery ?? [],
                    });
                }
            }
            const svelteMetaPath = path.join(OUT_DIR, "svelte.json");
            await fsp.writeFile(svelteMetaPath, JSON.stringify(svelteData, null, 2), "utf-8");
            staticFiles.push({
                source: "/_app/immutable/:file*",
                destination: ".deno-deploy/static/_app/immutable/:file*",
            });
            // Collect all remaining asset files
            const assetDir = builder.config.kit.files.assets;
            // TODO: What about generated assets
            const assets = [];
            await walk(assetDir, assets);
            for (const asset of assets) {
                const rel = path.relative(assetDir, asset);
                staticFiles.push({
                    source: `/${rel.replace(/\\+/, "/")}`,
                    destination: path.join(dirs.static, rel),
                });
            }
            const deploy = {
                headers: [{
                        source: "/_app/immutable/:file*",
                        headers: [
                            {
                                key: "Cache-Control",
                                value: "public, immutable, max-age=31536000",
                            },
                        ],
                    }],
                redirects,
                rewrites,
                staticFiles,
            };
            const out = path.join(OUT_DIR, "deploy.json");
            await fsp.writeFile(out, JSON.stringify(deploy, null, 2), "utf-8");
            const fileDir = path.join(import.meta.dirname, "files");
            builder.copy(path.join(fileDir, "handler.ts"), path.join(OUT_DIR, "handler.ts"));
            builder.copy(path.join(fileDir, "server.ts"), path.join(OUT_DIR, "server.ts"));
        },
        supports: {
            read() {
                // Deno Deploy V2 always supports reading from the file system
                return true;
            },
            instrumentation() {
                // Does it support SvelteKit's built-in observability features
                return true;
            },
        },
    };
}
async function walk(dir, result) {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            await walk(path.join(dir, entry.name), result);
        }
        else if (entry.isFile()) {
            result.push(path.join(dir, entry.name));
        }
    }
}
