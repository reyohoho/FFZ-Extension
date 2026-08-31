'use strict';

/**
 * Minimal addons.mozilla.org (AMO) API v5 client.
 *
 * Usage:
 *   node scripts/amo-client.js upload --file path/to/extension.zip [--channel listed]
 *   node scripts/amo-client.js create-version --upload <uuid>
 *       [--release-notes-file notes.txt] [--approval-notes-file notes.txt]
 *   node scripts/amo-client.js attach-source --version <id> --file source.zip
 *   node scripts/amo-client.js status [--limit 5]
 *
 * Environment:
 *   AMO_JWT_ISSUER   API key issuer from addons.mozilla.org/developers/addon/api/key/
 *   AMO_JWT_SECRET   API key secret
 *   AMO_ADDON_ID     Add-on ID or GUID (default: frankerfacez@frankerfacez.com)
 *
 * When GITHUB_OUTPUT is set:
 *   upload          writes `upload_uuid`
 *   create-version  writes `version_id` and `version`
 *   status          writes `latest_version`, `latest_status`, `unreviewed_count`
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const BASE = 'https://addons.mozilla.org/api/v5';

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

function addonId() {
	return process.env.AMO_ADDON_ID || 'frankerfacez@frankerfacez.com';
}

function b64url(input) {
	return Buffer.from(input).toString('base64url');
}

// AMO uses a short-lived HS256 JWT, generated fresh for each request.
function makeToken() {
	const now = Math.floor(Date.now() / 1000);
	const header = b64url(JSON.stringify({alg: 'HS256', typ: 'JWT'}));
	const claims = b64url(JSON.stringify({
		iss: getEnv('AMO_JWT_ISSUER'),
		jti: crypto.randomUUID(),
		iat: now,
		exp: now + 240
	}));

	const signature = crypto.createHmac('sha256', getEnv('AMO_JWT_SECRET'))
		.update(`${header}.${claims}`)
		.digest('base64url');

	return `${header}.${claims}.${signature}`;
}

async function api(method, urlPath, opts = {}) {
	const resp = await fetch(`${BASE}${urlPath}`, {
		method,
		headers: {
			'Authorization': `JWT ${makeToken()}`,
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

async function cmdUpload(args) {
	const file = args.file;
	if ( ! file )
		fail('upload requires --file <path-to-zip>');

	const channel = args.channel || 'listed';
	const body = new FormData();
	body.set('channel', channel);
	body.set('upload', new Blob([fs.readFileSync(file)], {type: 'application/zip'}), path.basename(file));

	console.error(`Uploading ${file} to AMO (channel: ${channel})...`);
	const result = await api('POST', '/addons/upload/', {body});
	if ( ! result.ok )
		fail(`Upload failed (HTTP ${result.status}): ${result.text}`);

	const uuid = result.data.uuid;
	console.error(`Upload created: ${uuid}. Waiting for validation...`);

	// Poll until the upload has been processed by the validator.
	for (let attempt = 0; attempt < 60; attempt++) {
		const detail = await api('GET', `/addons/upload/${uuid}/`);
		if ( ! detail.ok )
			fail(`Upload polling failed (HTTP ${detail.status}): ${detail.text}`);

		if ( detail.data.processed ) {
			if ( ! detail.data.valid ) {
				console.error('Validation FAILED:');
				fail(JSON.stringify(detail.data.validation, null, 2));
			}
			console.error(`Validation passed (detected version: ${detail.data.version}).`);
			console.log(uuid);
			githubOutput({upload_uuid: uuid});
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 5000));
	}

	fail('Timed out waiting for AMO validation.');
}

function readNotes(file) {
	if ( ! file )
		return null;
	return fs.readFileSync(file, 'utf8').trim();
}

async function cmdCreateVersion(args) {
	if ( ! args.upload )
		fail('create-version requires --upload <uuid>');

	const body = {upload: args.upload};

	const release = readNotes(args['release-notes-file']);
	if ( release )
		body.release_notes = {'en-US': release};

	const approval = readNotes(args['approval-notes-file']);
	if ( approval )
		body.approval_notes = approval;

	const result = await api('POST', `/addons/addon/${addonId()}/versions/`, {
		headers: {'Content-Type': 'application/json'},
		body: JSON.stringify(body)
	});

	if ( ! result.ok )
		fail(`create-version failed (HTTP ${result.status}): ${result.text}`);

	console.error(`Created version ${result.data.version} (id: ${result.data.id}, file status: ${result.data.file?.status}).`);
	console.log(JSON.stringify(result.data, null, 2));
	githubOutput({version_id: result.data.id, version: result.data.version});
}

async function cmdAttachSource(args) {
	if ( ! args.version || ! args.file )
		fail('attach-source requires --version <id> --file <source-zip>');

	const body = new FormData();
	body.set('source', new Blob([fs.readFileSync(args.file)], {type: 'application/zip'}), path.basename(args.file));

	const result = await api('PATCH', `/addons/addon/${addonId()}/versions/${args.version}/`, {body});
	if ( ! result.ok )
		fail(`attach-source failed (HTTP ${result.status}): ${result.text}`);

	console.error('Source archive attached.');
	console.log(JSON.stringify({id: result.data.id, version: result.data.version, source: result.data.source}, null, 2));
}

async function cmdStatus(args) {
	const limit = parseInt(args.limit, 10) || 5;
	const result = await api('GET', `/addons/addon/${addonId()}/versions/?filter=all_with_unlisted&page_size=${limit}`);
	if ( ! result.ok )
		fail(`status failed (HTTP ${result.status}): ${result.text}`);

	const versions = result.data.results ?? [];
	const summary = versions.map(v => ({
		id: v.id,
		version: v.version,
		channel: v.channel,
		file_status: v.file?.status,
		reviewed: v.reviewed
	}));

	console.log(JSON.stringify(summary, null, 2));

	const latest = summary[0];
	githubOutput({
		latest_version: latest?.version,
		latest_status: latest?.file_status,
		unreviewed_count: String(summary.filter(v => v.file_status === 'unreviewed').length)
	});
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

	if ( command === 'upload' )
		await cmdUpload(args);
	else if ( command === 'create-version' )
		await cmdCreateVersion(args);
	else if ( command === 'attach-source' )
		await cmdAttachSource(args);
	else if ( command === 'status' )
		await cmdStatus(args);
	else
		fail('Usage: amo-client.js <upload|create-version|attach-source|status> [options]');
}

main().catch(err => fail(err?.stack ?? String(err)));
