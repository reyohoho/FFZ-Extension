const fs = require('fs');
const path = require('path');

const ffzVersion = process.env.FFZ_VERSION;
const ffzBuild = process.env.FFZ_BUILD;

let version;
if (ffzVersion && ffzBuild) {
	version = `${ffzVersion}.${ffzBuild}`;
} else {
	version = '4.0.0';
	try {
		const clientPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'package.json'), 'utf8'));
		if (clientPkg.version) version = clientPkg.version;
	} catch { /* use default */ }
}

// Update manifests for both Chrome and Firefox targets
for (const target of ['chrome', 'firefox']) {
	const manifestPath = path.join(__dirname, '..', 'dist', target, 'manifest.json');
	if (!fs.existsSync(manifestPath)) continue;

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	manifest.version = version;
	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	console.log(`Updated ${target} manifest version to ${version}`);
}
