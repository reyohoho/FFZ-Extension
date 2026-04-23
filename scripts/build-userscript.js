const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Read version
const ffzVersion = process.env.FFZ_VERSION;
const ffzBuild = process.env.FFZ_BUILD;

let version = '4.0.0';
try {
	const clientPkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'client', 'package.json'), 'utf8'));
	if (clientPkg.version) version = clientPkg.version;
} catch { /* use default */ }

if (ffzVersion && ffzBuild)
	version = `${ffzVersion}.${ffzBuild}`;

const distDir = path.join(ROOT, 'dist', 'userscript');
fs.mkdirSync(distDir, { recursive: true });

const userscript = `// ==UserScript==
// @name         FrankerFaceZ
// @namespace    FrankerFaceZ
// @version      ${version}
// @author       FrankerFaceZ
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
// @downloadURL  https://cdn2.frankerfacez.com/ffz.user.js
// @updateURL    https://cdn2.frankerfacez.com/ffz.user.js
// @homepage     https://www.frankerfacez.com
// ==/UserScript==

(function() {
	'use strict';

	// Don't run on certain sub-domains.
	if (/^(?:localhost\\.rig|blog|im|chatdepot|tmi|api|brand|dev|gql|passport)\\./.test(location.hostname))
		return;

	if (/disable_frankerfacez/.test(location.search))
		return;

	if (document.body.dataset.ffzSource)
		return;

	document.body.dataset.ffzSource = 'userscript';

	var DEBUG = localStorage.ffzDebugMode == 'true' && document.body.classList.contains('ffz-dev'),
		HOST = location.hostname,
		SERVER = DEBUG ? '//localhost:8000' : '//cdn2.frankerfacez.com',
		script = document.createElement('script');

	var FLAVOR =
		HOST.includes('player') ? 'player' :
			HOST.includes('clips') ? 'clips' :
				(location.pathname === '/p/ffz_bridge/' ? 'bridge' : 'avalon');

	if (FLAVOR === 'clips' && location.pathname === '/embed')
		FLAVOR = 'player';

	script.id = 'ffz-script';
	script.async = true;
	script.crossOrigin = 'anonymous';
	script.src = SERVER + '/script/' + FLAVOR + '.js?_=' + Date.now();
	document.head.appendChild(script);
})();
`;

fs.writeFileSync(path.join(distDir, 'ffz.user.js'), userscript);
console.log(`Userscript written to ${path.join(distDir, 'ffz.user.js')} (v${version})`);
