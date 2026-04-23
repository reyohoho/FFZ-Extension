const fs = require('fs');
const path = require('path');

const DIST = path.resolve(__dirname, '..', 'dist');

// --- Chrome manifest ---
const chromeManifest = JSON.parse(fs.readFileSync(path.join(DIST, 'chrome', 'manifest.json'), 'utf8'));
delete chromeManifest.browser_specific_settings;
if (chromeManifest.background)
	delete chromeManifest.background.scripts;
fs.writeFileSync(path.join(DIST, 'chrome', 'manifest.json'), JSON.stringify(chromeManifest, null, '\t'));

// --- Firefox manifest ---
const firefoxManifest = JSON.parse(fs.readFileSync(path.join(DIST, 'firefox', 'manifest.json'), 'utf8'));
delete firefoxManifest.externally_connectable;
if (firefoxManifest.background)
	delete firefoxManifest.background.service_worker;
fs.writeFileSync(path.join(DIST, 'firefox', 'manifest.json'), JSON.stringify(firefoxManifest, null, '\t'));

// --- Userscript ---
let version = '4.0.0';
try {
	const clientPkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'client', 'package.json'), 'utf8'));
	if (clientPkg.version) version = clientPkg.version;
} catch { /* use default */ }

// Override with env if available (same logic as update-manifest.js)
const envVersion = process.env.FFZ_VERSION;
const envBuild = process.env.FFZ_BUILD;
if (envVersion && envBuild)
	version = `${envVersion}.${envBuild}`;

const userscript = `// ==UserScript==
// @name         Reyohoho Twitch Extension(Nightly)
// @namespace    RTE_Nightly
// @version      ${version}
// @author       Dan Salvato LLC
// @homepage     https://ext.rte.net.ru/
// @match        *://*.twitch.tv/*
// @exclude      *://api.twitch.tv/*
// @exclude      *://localhost.rig.twitch.tv/*
// @exclude      *://blog.twitch.tv/*
// @exclude      *://im.twitch.tv/*
// @exclude      *://chatdepot.twitch.tv/*
// @exclude      *://tmi.twitch.tv/*
// @exclude      *://brand.twitch.tv/*
// @exclude      *://dev.twitch.tv/*
// @exclude      *://gql.twitch.tv/*
// @exclude      *://passport.twitch.tv/*
// @grant        none
// @run-at       document-body
// ==/UserScript==

(() => {
	'use strict';

	if (/disable_frankerfacez/.test(location.search))
		return;

	if (document.body.dataset.ffzSource)
		return;

	document.body.dataset.ffzSource = 'userscript';

	const HOST = location.hostname,
		SERVER = '//cdn2.frankerfacez.com',
		script = document.createElement('script');

	let FLAVOR =
		HOST.includes('player') ? 'player' :
			HOST.includes('clips') ? 'clips' :
				(location.pathname === '/p/ffz_bridge/' ? 'bridge' : 'avalon');

	if (FLAVOR === 'clips' && location.pathname === '/embed')
		FLAVOR = 'player';

	script.id = 'ffz-script';
	script.async = true;
	script.crossOrigin = 'anonymous';
	script.src = \`\${SERVER}/script/\${FLAVOR}.js?_=\${Date.now()}\`;
	document.head.appendChild(script);
})();
`;

fs.mkdirSync(path.join(DIST, 'userscript'), { recursive: true });
fs.writeFileSync(path.join(DIST, 'userscript', 'frankerfacez.user.js'), userscript);

console.log('Build targets created: chrome, firefox, userscript');
