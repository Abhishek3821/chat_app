/**
 * Invite-link parsing — the logic behind the Scan button and every QR.
 *
 * Reported bug: scanning the app's own QR answered "That doesn't look like a
 * ChatKonect invite". `parseInvite` demanded an exact origin match, so a code
 * minted on `www.` was rejected when scanned from the apex domain, and nothing
 * scanned on localhost or a preview deploy ever worked.
 *
 * Pure functions, no DOM — so this runs straight in node with a stubbed
 * `window`, and pins both halves: what must be ACCEPTED (the app's own codes,
 * from any host) and what must still be REFUSED (anything that isn't an invite
 * path, so the Scan button can't be steered somewhere else).
 *
 * Run:  node test-invite.mjs   (from /client)
 */
globalThis.window = { location: { origin: 'https://www.chatkonect.com' } };

const { parseInvite, inviteUrlForUser, inviteUrlForGroup } = await import('./src/lib/invite.js');

const results = [];
const check = (name, cond, detail = '') => {
  results.push(!!cond);
  console.log(`  ${cond ? '✓' : '✗'} ${name}${cond || !detail ? '' : `  — ${detail}`}`);
};
const section = (t) => console.log(`\n— ${t}`);
const eq = (name, actual, expected) => check(name, actual === expected, `got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);

section('The app generates what it can read back');
const userUrl = inviteUrlForUser('aabhishekssingh97');
const groupUrl = inviteUrlForGroup('K7PQ2M9XZT');
eq('a personal QR round-trips', parseInvite(userUrl), '/invite/u/aabhishekssingh97');
eq('a group QR round-trips', parseInvite(groupUrl), '/invite/g/K7PQ2M9XZT');
check('the personal link is absolute (a phone has to fetch it)', /^https?:\/\//.test(userUrl), userUrl);
eq('a leading @ is stripped when minting', inviteUrlForUser('@bob'), 'https://www.chatkonect.com/invite/u/bob');

section('The same code scanned from a DIFFERENT origin — the reported bug');
const fromWww = 'https://www.chatkonect.com/invite/u/aabhishekssingh97';
window.location.origin = 'https://chatkonect.com'; // apex, no www
eq('apex session reads a www QR', parseInvite(fromWww), '/invite/u/aabhishekssingh97');
window.location.origin = 'http://localhost:5290';
eq('localhost reads a production QR', parseInvite(fromWww), '/invite/u/aabhishekssingh97');
window.location.origin = 'https://chatkonect-git-preview.vercel.app';
eq('a preview deploy reads it too', parseInvite(fromWww), '/invite/u/aabhishekssingh97');
window.location.origin = 'https://www.chatkonect.com';

section('The other shapes people arrive with');
eq('a bare path', parseInvite('/invite/g/ABCD1234'), '/invite/g/ABCD1234');
eq('an @handle', parseInvite('@aarpit688'), '/invite/u/aarpit688');
eq('a bare group code', parseInvite('K7PQ2M9XZT'), '/invite/g/K7PQ2M9XZT');
eq('surrounding whitespace', parseInvite('  /invite/u/bob \n'), '/invite/u/bob');
eq('a trailing slash', parseInvite('https://x.test/invite/u/bob/'), '/invite/u/bob');
eq('a query string is ignored', parseInvite('https://x.test/invite/u/bob?utm=qr'), '/invite/u/bob');

section('What must still be refused');
eq('empty text', parseInvite(''), null);
eq('null', parseInvite(null), null);
eq('a non-invite URL on our own domain', parseInvite('https://www.chatkonect.com/settings'), null);
eq('a bare non-invite path', parseInvite('/settings'), null);
eq('a plain website', parseInvite('https://evil.example.com'), null);
eq('a javascript: payload', parseInvite('javascript:alert(1)'), null);
eq('an invite-ish path with a bad segment', parseInvite('/invite/x/abc'), null);
eq('path traversal in the code', parseInvite('https://x.test/invite/u/../../admin'), null);
eq('an over-long code', parseInvite(`/invite/g/${'a'.repeat(120)}`), null);
eq('free text', parseInvite('hello there'), null);

section('The navigation target is always OUR OWN path');
const hostile = parseInvite('https://evil.example.com/invite/g/SOMECODE');
eq('a foreign host contributes only its code', hostile, '/invite/g/SOMECODE');
check(
  'and never an absolute URL we would navigate to off-site',
  hostile === null || (hostile.startsWith('/') && !hostile.startsWith('//')),
  hostile
);

const passed = results.filter(Boolean).length;
console.log(`\n${'─'.repeat(56)}\n${passed}/${results.length} checks passed`);
process.exit(passed === results.length ? 0 : 1);
