// scripts/db/check-uri.mjs
// Diagnoses MONGODB_URI without ever printing the password.
//
//   node scripts/db/check-uri.mjs
//
// "bad auth : authentication failed" from Atlas says only that the credential
// was rejected - never why. These are the causes that actually come up, and
// most are visible in the string itself.

const uri = process.env.MONGODB_URI;

if (!uri) {
  console.error('MONGODB_URI is not set in this shell.');
  process.exit(1);
}

let problems = 0;
const bad = (msg, fix) => { problems++; console.log(`  PROBLEM  ${msg}\n           -> ${fix}`); };
const ok = (msg) => console.log(`  ok       ${msg}`);

const srv = uri.startsWith('mongodb+srv://');
const plain = uri.startsWith('mongodb://');
if (!srv && !plain) {
  bad('Does not start with mongodb:// or mongodb+srv://',
      'Copy the string again from Atlas > Connect > Drivers.');
  process.exit(1);
}
console.log(`\nScheme: ${srv ? 'mongodb+srv (DNS SRV)' : 'mongodb (explicit hosts)'}`);

// Split off credentials without a URL parse - a raw password can contain
// characters that make the whole thing fail to parse, which is itself a finding.
const rest = uri.slice(uri.indexOf('://') + 3);
const at = rest.lastIndexOf('@');
if (at === -1) {
  bad('No credentials in the string (no "@" before the host)',
      'Expected mongodb+srv://USER:PASSWORD@cluster...');
  process.exit(1);
}
const creds = rest.slice(0, at);
const hostAndOpts = rest.slice(at + 1);
const colon = creds.indexOf(':');
const user = colon === -1 ? creds : creds.slice(0, colon);
const pass = colon === -1 ? '' : creds.slice(colon + 1);

console.log(`User:   ${user}`);
console.log(`Host:   ${hostAndOpts.split('/')[0].split('?')[0]}`);
console.log(`Pass:   ${pass ? `${pass.length} characters` : '(EMPTY)'}\n`);

if (!pass) {
  bad('The password is empty', 'Put the real password after the colon.');
}

// The single most common one: the Atlas placeholder left in place.
if (/[<>]/.test(pass) || pass.includes('db_password') || pass.toUpperCase().includes('PASSWORD')) {
  bad('The password still looks like Atlas\'s placeholder',
      'Replace <db_password> INCLUDING the angle brackets with the real password.');
} else {
  ok('Password is not the Atlas placeholder');
}

// Characters that must be percent-encoded inside a URI's userinfo section.
const needsEncoding = [...':/?#[]@'].filter((c) => pass.includes(c));
if (needsEncoding.length) {
  bad(`The password contains characters that must be percent-encoded: ${needsEncoding.join(' ')}`,
      'Easiest fix is to reset it in Atlas and let it autogenerate an alphanumeric one.');
} else {
  ok('Password needs no percent-encoding');
}

if (/\s/.test(uri)) {
  bad('The string contains whitespace', 'A stray space or newline crept in when copying.');
} else {
  ok('No stray whitespace');
}

if (uri.startsWith('"') || uri.endsWith('"') || uri.startsWith("'") || uri.endsWith("'")) {
  bad('The string is wrapped in quotes',
      'In cmd, `set VAR=value` keeps the quotes as part of the value. Use set "VAR=value".');
} else {
  ok('Not wrapped in quotes');
}

// THE one that bites when using the long form on a machine whose DNS cannot do
// SRV lookups. mongodb+srv learns authSource=admin from the cluster's TXT
// record; the plain form has no such record to read, so it defaults to
// authenticating against the database in the path - and Atlas users live in
// admin. Result: "bad auth", with a completely correct password.
if (plain) {
  if (/authSource=admin/i.test(hostAndOpts)) {
    ok('authSource=admin is present (required for the non-SRV form)');
  } else {
    bad('Non-SRV string is missing authSource=admin',
        'Append &authSource=admin (or ?authSource=admin if there is no query string yet). '
        + 'Without it the driver authenticates against the wrong database and Atlas '
        + 'reports "bad auth" even when the password is correct.');
  }
  if (/replicaSet=/i.test(hostAndOpts)) {
    ok('replicaSet is present');
  } else {
    bad('Non-SRV string is missing replicaSet=',
        'Atlas needs the replica set name in the explicit-host form.');
  }
}

console.log(problems
  ? `\n${problems} problem(s) found above.`
  : '\nNothing wrong with the string itself — so the password is simply not the current one.'
    + '\nReset it: Atlas > Database Access > Edit > Edit Password > Autogenerate.');
process.exit(problems ? 1 : 0);
