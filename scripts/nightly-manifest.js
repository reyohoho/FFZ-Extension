const fs = require('fs');
const path = require('path');

for (const target of ['chrome', 'firefox']) {
	const manifestPath = path.join(__dirname, '..', 'dist', target, 'manifest.json');
	if (!fs.existsSync(manifestPath)) continue;

	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

	manifest.name = 'FrankerFaceZ Nightly';
	manifest.short_name = 'FFZ-Nightly';
	manifest.description = `This is the nightly testing build of FrankerFaceZ. FrankerFaceZ is an enhancement suite for Twitch.`;

	if (manifest?.browser_specific_settings?.gecko)
		manifest.browser_specific_settings.gecko.id = 'nightly@frankerfacez.com';

	fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'));
	console.log(`Updated ${target} manifest for nightly`);
}
