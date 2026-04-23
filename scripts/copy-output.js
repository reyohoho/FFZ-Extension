const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const TARGETS = ['chrome', 'firefox'];

const target = process.argv[2]; // 'chrome', 'firefox', or undefined (all)

const targets = target ? [target] : TARGETS;

for (const t of targets) {
	if (!TARGETS.includes(t)) {
		console.error(`Unknown target: ${t}`);
		process.exit(1);
	}
}

// Pick the newest addons.HASH.json produced by the add-ons webpack build.
// We resolve this BEFORE copying so we can rely on the real source mtimes
// (fs.copyFileSync resets mtime on the destination, which previously made
// this sort unstable when multiple stale hashed manifests were lying around).
const addonsSrcDir = path.join(ROOT, 'addons', 'dist');
const addonsManifestSrc = pickNewestAddonsManifest(addonsSrcDir);

for (const t of targets) {
	console.log(`Copying output for target: ${t}`);
	const dist = path.join(ROOT, 'dist', t);

	// Clean and recreate
	fs.rmSync(dist, { recursive: true, force: true });
	fs.mkdirSync(path.join(dist, 'web'), { recursive: true });

	// Copy client output
	copyDirSync(path.join(ROOT, 'client', 'dist'), path.join(dist, 'web'));

	// Copy addons output
	copyDirSync(path.join(ROOT, 'addons', 'dist'), path.join(dist, 'web'));

	// Copy static files (manifest, icons)
	copyDirSync(path.join(ROOT, 'src'), dist);

	// Remove files we don't want in the packaged extension
	rmSafe(path.join(dist, 'web', 'bom'));
	rmSafe(path.join(dist, 'web', 'addons-bom'));
	rmSafe(path.join(dist, 'web', 'manifest.json'));
	rmSafe(path.join(dist, 'web', 'addons', 'manifest.json'));

	const webDir = path.join(dist, 'web');

	// Remove plain addons.json first (from addons/dist copy)
	rmSafe(path.join(webDir, 'addons.json'));

	// Install the chosen manifest and wipe every hashed manifest copy to
	// guarantee the packaged extension contains exactly one `addons.json`.
	if (addonsManifestSrc) {
		fs.copyFileSync(
			path.join(addonsSrcDir, addonsManifestSrc),
			path.join(webDir, 'addons.json')
		);
	} else {
		console.warn('  WARN: no addons.<hash>.json found in addons/dist; addons.json will be missing');
	}

	for (const f of fs.readdirSync(webDir)) {
		if (/^addons\.[a-f0-9]+\.json$/.test(f))
			fs.unlinkSync(path.join(webDir, f));
	}

	// Adjust manifest per target
	const manifestPath = path.join(dist, 'manifest.json');
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	if (t === 'chrome') {
		// Remove Firefox-specific settings
		delete manifest.browser_specific_settings;
		// Chrome uses service_worker only
		if (manifest.background) {
			delete manifest.background.scripts;
		}
	} else if (t === 'firefox') {
		// Remove externally_connectable (unsupported in Firefox)
		delete manifest.externally_connectable;
		// Firefox MV3 uses background.scripts, not service_worker
		if (manifest.background) {
			delete manifest.background.service_worker;
		}
	}

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	console.log(`  -> ${dist}`);
}

// --- Helpers ---

function copyDirSync(src, dest) {
	if (!fs.existsSync(src)) return;
	fs.mkdirSync(dest, { recursive: true });
	for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
		const srcPath = path.join(src, entry.name);
		const destPath = path.join(dest, entry.name);
		if (entry.isDirectory()) {
			copyDirSync(srcPath, destPath);
		} else {
			fs.copyFileSync(srcPath, destPath);
		}
	}
}

function rmSafe(p) {
	try {
		fs.rmSync(p, { recursive: true, force: true });
	} catch { /* ignore */ }
}

function pickNewestAddonsManifest(dir) {
	if (!fs.existsSync(dir)) return null;
	const candidates = fs.readdirSync(dir)
		.filter(f => /^addons\.[a-f0-9]+\.json$/.test(f))
		.map(f => ({
			name: f,
			mtime: fs.statSync(path.join(dir, f)).mtimeMs
		}))
		.sort((a, b) => b.mtime - a.mtime);

	if (!candidates.length) return null;
	return candidates[0].name;
}
