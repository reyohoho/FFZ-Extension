'use strict';

/**
 * Generate a changelog from the client and add-ons repositories, covering
 * everything between a baseline (the last submitted version's commits, read
 * from the channel's release tag) and the commits that were just built.
 *
 * Usage:
 *   node scripts/changelog.js
 *     --client-dir client --addons-dir addons
 *     --client-base <sha> --addons-base <sha>
 *     --client-head <sha> --addons-head <sha>
 *     --out changelog.md [--out-short changelog-short.txt]
 *
 * If a base SHA is missing or unknown to the repository, the last
 * FALLBACK_COUNT commits are listed instead, with a warning.
 *
 * When GITHUB_OUTPUT is set, writes `total_changes`.
 */

const {execFileSync} = require('node:child_process');
const fs = require('node:fs');

const FALLBACK_COUNT = 15;
const SHORT_LIMIT = 2800;

// Commits that are noise in a user-facing changelog.
const SKIP_PATTERNS = [
	/^v?\d+\.\d+\.\d+(\.\d+)?$/,        // bare version bumps ("4.80.5")
	/^merge /i,
	/^\[?ci skip\]?/i
];

function fail(msg) {
	console.error(msg);
	process.exit(1);
}

function git(dir, args) {
	return execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', maxBuffer: 32 * 1024 * 1024}).trim();
}

function commitExists(dir, sha) {
	if ( ! sha )
		return false;
	try {
		execFileSync('git', ['-C', dir, 'cat-file', '-e', `${sha}^{commit}`], {stdio: 'ignore'});
		return true;
	} catch {
		return false;
	}
}

function getSubjects(dir, base, head) {
	let range, warning = null;
	if ( commitExists(dir, base) )
		range = `${base}..${head}`;
	else {
		range = `${head}~${FALLBACK_COUNT}..${head}`;
		warning = `no baseline recorded — showing the last ${FALLBACK_COUNT} commits`;
		try {
			git(dir, ['rev-parse', `${head}~${FALLBACK_COUNT}`]);
		} catch {
			range = head; // repo shorter than the fallback window
		}
	}

	const raw = git(dir, ['log', '--no-merges', '--pretty=format:%s', range]);
	const subjects = raw.split('\n')
		.map(line => line.trim())
		.filter(line => line && ! SKIP_PATTERNS.some(pattern => pattern.test(line)));

	return {subjects, warning};
}

function section(title, result) {
	const lines = [`### ${title}`];
	if ( result.warning )
		lines.push(`*(${result.warning})*`);
	if ( ! result.subjects.length )
		lines.push('*No changes.*');
	else
		for (const subject of result.subjects)
			lines.push(`- ${subject}`);
	return lines.join('\n');
}

function shorten(full) {
	if ( full.length <= SHORT_LIMIT )
		return full;

	const lines = full.split('\n');
	const out = [];
	let length = 0, dropped = 0;

	for (const line of lines) {
		if ( length + line.length + 1 > SHORT_LIMIT - 60 ) {
			if ( line.startsWith('- ') )
				dropped++;
			continue;
		}
		out.push(line);
		length += line.length + 1;
	}

	if ( dropped )
		out.push(`\n…and ${dropped} more changes.`);
	return out.join('\n');
}

function parseArgs(argv) {
	const args = {};
	for (let i = 0; i < argv.length; i++)
		if ( argv[i].startsWith('--') )
			args[argv[i].slice(2)] = argv[++i];
	return args;
}

function main() {
	const args = parseArgs(process.argv.slice(2));

	for (const key of ['client-dir', 'addons-dir', 'client-head', 'addons-head', 'out'])
		if ( ! args[key] )
			fail(`Missing required argument: --${key}`);

	const client = getSubjects(args['client-dir'], args['client-base'], args['client-head']);
	const addons = getSubjects(args['addons-dir'], args['addons-base'], args['addons-head']);

	const full = [
		section('FrankerFaceZ', client),
		'',
		section('Add-Ons', addons)
	].join('\n');

	fs.writeFileSync(args.out, full + '\n');
	if ( args['out-short'] )
		fs.writeFileSync(args['out-short'], shorten(full) + '\n');

	const total = client.subjects.length + addons.subjects.length;
	console.error(`Changelog written to ${args.out} (${total} changes).`);

	if ( process.env.GITHUB_OUTPUT )
		fs.appendFileSync(process.env.GITHUB_OUTPUT, `total_changes=${total}\n`);
}

main();
