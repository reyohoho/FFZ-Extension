'use strict';

/**
 * Minimal Chrome Web Store API v2 client using service account auth.
 *
 * Usage:
 *   node scripts/cws-client.js status
 *   node scripts/cws-client.js upload --file path/to/extension.zip
 *   node scripts/cws-client.js publish [--staged]
 *   node scripts/cws-client.js cancel
 *
 * Environment:
 *   CWS_SERVICE_ACCOUNT_KEY  JSON key for the service account (the file's contents)
 *   CWS_PUBLISHER_ID         Publisher ID from the CWS developer dashboard
 *   CWS_EXTENSION_ID         The extension's item ID
 *
 * When GITHUB_OUTPUT is set, the `status` subcommand also writes:
 *   pending             "true"/"false" — whether a submission is awaiting review
 *   pending_version     crxVersion of the pending submission, if any
 *   published_version   crxVersion of the live revision, if any
 */

const crypto = require('node:crypto');
const fs = require('node:fs');

const BASE = 'https://chromewebstore.googleapis.com';
const SCOPE = 'https://www.googleapis.com/auth/chromewebstore';

function fail(msg) {
	console.error(msg);
	process.exit(1);
}

function getEnv(name) {
	const value = process.env[name];
	if ( ! value )
		fail(`Missing required environment variable: ${name}`);
	return value;
}

function b64url(input) {
	return Buffer.from(input).toString('base64url');
}

async function getAccessToken() {
	let key;
	try {
		key = JSON.parse(getEnv('CWS_SERVICE_ACCOUNT_KEY'));
	} catch (err) {
		fail('CWS_SERVICE_ACCOUNT_KEY is not valid JSON.');
	}

	const now = Math.floor(Date.now() / 1000);
	const tokenUri = key.token_uri || 'https://oauth2.googleapis.com/token';

	const header = b64url(JSON.stringify({alg: 'RS256', typ: 'JWT'}));
	const claims = b64url(JSON.stringify({
		iss: key.client_email,
		scope: SCOPE,
		aud: tokenUri,
		iat: now,
		exp: now + 3600
	}));

	const signer = crypto.createSign('RSA-SHA256');
	signer.update(`${header}.${claims}`);
	const signature = signer.sign(key.private_key).toString('base64url');

	const resp = await fetch(tokenUri, {
		method: 'POST',
		headers: {'Content-Type': 'application/x-www-form-urlencoded'},
		body: new URLSearchParams({
			grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
			assertion: `${header}.${claims}.${signature}`
		})
	});

	const data = await resp.json().catch(() => null);
	if ( ! resp.ok || ! data?.access_token )
		fail(`Failed to obtain access token (HTTP ${resp.status}): ${JSON.stringify(data)}`);

	return data.access_token;
}

function itemName() {
	return `publishers/${getEnv('CWS_PUBLISHER_ID')}/items/${getEnv('CWS_EXTENSION_ID')}`;
}

async function api(token, method, path, opts = {}) {
	const resp = await fetch(`${BASE}${path}`, {
		method,
		headers: {
			'Authorization': `Bearer ${token}`,
			...opts.headers
		},
		body: opts.body
	});

	const text = await resp.text();
	let data = null;
	try {
		data = JSON.parse(text);
	} catch { /* leave as text */ }

	return {ok: resp.ok, status: resp.status, data, text};
}

function githubOutput(pairs) {
	if ( ! process.env.GITHUB_OUTPUT )
		return;
	const lines = Object.entries(pairs)
		.map(([key, value]) => `${key}=${value ?? ''}`)
		.join('\n');
	fs.appendFileSync(process.env.GITHUB_OUTPUT, lines + '\n');
}

async function fetchStatus(token) {
	const result = await api(token, 'GET', `/v2/${itemName()}:fetchStatus`);
	if ( ! result.ok )
		fail(`fetchStatus failed (HTTP ${result.status}): ${result.text}`);
	return result.data;
}

function versionOf(revisionStatus) {
	return revisionStatus?.distributionChannels?.[0]?.crxVersion ?? null;
}

async function cmdStatus(token) {
	const status = await fetchStatus(token);
	console.log(JSON.stringify(status, null, 2));

	const pending = !! status.submittedItemRevisionStatus;
	githubOutput({
		pending: String(pending),
		pending_version: versionOf(status.submittedItemRevisionStatus),
		published_version: versionOf(status.publishedItemRevisionStatus)
	});
}

async function cmdUpload(token, args) {
	const file = args.file;
	if ( ! file )
		fail('upload requires --file <path-to-zip>');

	const body = fs.readFileSync(file);
	console.error(`Uploading ${file} (${body.length} bytes)...`);

	const result = await api(token, 'POST', `/upload/v2/${itemName()}:upload?upload_type=media`, {
		headers: {'Content-Type': 'application/zip'},
		body
	});

	if ( ! result.ok )
		fail(`Upload failed (HTTP ${result.status}): ${result.text}`);

	console.log(JSON.stringify(result.data ?? result.text, null, 2));

	// Uploads may be processed asynchronously; poll until the store
	// reports a terminal state for the last upload.
	for (let attempt = 0; attempt < 30; attempt++) {
		const status = await fetchStatus(token);
		const state = status.lastAsyncUploadState;
		if ( ! state || ! /IN_PROGRESS|PENDING|PROCESSING/i.test(state) ) {
			if ( state && /FAIL|ERROR/i.test(state) )
				fail(`Upload processing failed: ${state}\n${JSON.stringify(status, null, 2)}`);
			console.error(`Upload complete (state: ${state ?? 'not reported'}).`);
			return;
		}
		console.error(`Upload processing (${state}), waiting...`);
		await new Promise(resolve => setTimeout(resolve, 10000));
	}

	fail('Timed out waiting for upload processing.');
}

async function cmdPublish(token, args) {
	const body = {
		publishType: args.staged ? 'STAGED_PUBLISH' : 'DEFAULT_PUBLISH'
	};

	const result = await api(token, 'POST', `/v2/${itemName()}:publish`, {
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(body)
	});

	if ( ! result.ok )
		fail(`Publish failed (HTTP ${result.status}): ${result.text}`);

	console.log(JSON.stringify(result.data, null, 2));
}

async function cmdCancel(token) {
	const result = await api(token, 'POST', `/v2/${itemName()}:cancelSubmission`, {
		headers: {'Content-Type': 'application/json'},
		body: '{}'
	});

	if ( ! result.ok )
		fail(`cancelSubmission failed (HTTP ${result.status}): ${result.text}`);

	console.log(JSON.stringify(result.data ?? {}, null, 2));
}

function parseArgs(argv) {
	const args = {_: []};
	for (let i = 0; i < argv.length; i++) {
		if ( argv[i].startsWith('--') ) {
			const key = argv[i].slice(2);
			if ( i + 1 < argv.length && ! argv[i + 1].startsWith('--') )
				args[key] = argv[++i];
			else
				args[key] = true;
		} else
			args._.push(argv[i]);
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const command = args._[0];

	if ( ! ['status', 'upload', 'publish', 'cancel'].includes(command) )
		fail('Usage: cws-client.js <status|upload|publish|cancel> [--file <zip>] [--staged]');

	const token = await getAccessToken();

	if ( command === 'status' )
		await cmdStatus(token);
	else if ( command === 'upload' )
		await cmdUpload(token, args);
	else if ( command === 'publish' )
		await cmdPublish(token, args);
	else if ( command === 'cancel' )
		await cmdCancel(token);
}

main().catch(err => fail(err?.stack ?? String(err)));
