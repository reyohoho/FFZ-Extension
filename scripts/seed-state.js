'use strict';

/**
 * Seed the publish state for a channel by reconstructing which commits a
 * previously shipped version was built from, then creating the channel's
 * release tag (the machine-readable publish state lives in annotated tags
 * named `{channel}/{version}`).
 *
 * This inverts scripts/calculate-version.sh: a version `X.Y.Z.B` means the
 * client's package.json said X.Y.Z, and the add-ons repo had B commits newer
 * than the client's last package.json change at build time.
 *
 * Usage:
 *   node scripts/seed-state.js <channel> <version>
 *     [--client-dir client] [--addons-dir addons] [--apply]
 *
 * Example:
 *   node scripts/seed-state.js chrome-stable 4.80.5.1423 \
 *     --client-dir ../FrankerFaceZ --addons-dir ../ffz-addons-working --apply
 *
 * Without --apply, prints the git commands to run instead of running them.
 */

const {execFileSync} = require('node:child_process');

function fail(msg) {
	console.error(msg);
	process.exit(1);
}

function git(dir, args) {
	return execFileSync('git', ['-C', dir, ...args], {encoding: 'utf8', maxBuffer: 64 * 1024 * 1024}).trim();
}

function findClientCommit(dir, version) {
	const commits = git(dir, ['log', '--pretty=format:%H', '--', 'package.json']).split('\n');

	for (const sha of commits) {
		let pkg;
		try {
			pkg = JSON.parse(git(dir, ['show', `${sha}:package.json`]));
		} catch {
			continue;
		}
		if ( pkg.version === version )
			return sha;
	}

	return null;
}

function findAddonsCommit(dir, sinceTimestamp, build) {
	// Build 0 means no add-ons commits were newer than the client's version
	// change at build time, so the baseline is the newest commit at or
	// before that moment.
	if ( build === 0 ) {
		const sha = git(dir, ['rev-list', '-1', `--until=@${sinceTimestamp}`, 'HEAD']);
		if ( ! sha )
			fail('Cannot find add-ons commit: no commits exist at or before the client version change.');
		return sha;
	}

	const commits = git(dir, ['rev-list', '--reverse', `--since=@${sinceTimestamp}`, 'HEAD'])
		.split('\n').filter(Boolean);

	if ( build > commits.length )
		fail(`Cannot find add-ons commit: build number ${build} is out of range (found ${commits.length} commits since the client version change). Double-check the version string.`);

	return commits[build - 1];
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

function main() {
	const args = parseArgs(process.argv.slice(2));
	const [channel, fullVersion] = args._;

	if ( ! channel || ! fullVersion )
		fail('Usage: seed-state.js <channel> <version X.Y.Z.B> [--client-dir client] [--addons-dir addons] [--apply]');

	const match = /^(\d+\.\d+\.\d+)\.(\d+)$/.exec(fullVersion);
	if ( ! match )
		fail(`Version must look like X.Y.Z.B, got: ${fullVersion}`);

	const [, clientVersion, buildStr] = match;
	const build = parseInt(buildStr, 10);
	const clientDir = args['client-dir'] || 'client';
	const addonsDir = args['addons-dir'] || 'addons';

	console.error(`Looking for client commit where package.json version became ${clientVersion}...`);
	const clientCommit = findClientCommit(clientDir, clientVersion);
	if ( ! clientCommit )
		fail(`No commit found in ${clientDir} where package.json has version ${clientVersion}.`);

	const timestamp = git(clientDir, ['log', '-1', '--pretty=format:%ct', clientCommit]);
	console.error(`Client commit: ${clientCommit} (modified at ${timestamp})`);

	const addonsCommit = findAddonsCommit(addonsDir, timestamp, build);
	console.error(`Add-ons commit ${build} since then: ${addonsCommit}`);

	const metadata = JSON.stringify({
		version: fullVersion,
		client_commit: clientCommit,
		addons_commit: addonsCommit,
		submitted_at: new Date().toISOString(),
		seeded: true
	}, null, 2);

	const tag = `${channel}/${fullVersion}`;

	if ( args.apply ) {
		execFileSync('git', ['tag', '-a', tag, '-m', metadata], {stdio: 'inherit'});
		console.error(`\nCreated tag ${tag}. Push it with:\n  git push origin ${tag}`);
	} else {
		console.log(`# Run these commands to seed the ${channel} channel:`);
		console.log(`git tag -a '${tag}' -m '${metadata.replace(/'/g, `'\\''`)}'`);
		console.log(`git push origin '${tag}'`);
	}
}

main();
