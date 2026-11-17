export function fakeJwt(role, extra = {}) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ iss: 'fixture-only', role, ...extra })).toString('base64url');
  const signature = Buffer.from('not-a-valid-' + 'signature-for-local-fixtures').toString('base64url');
  return [header, payload, signature].join('.');
}

export function fixtureKeys() {
  // Deliberately fake, runtime-assembled shapes; never usable provider credentials.
  const letters = 'Fixture' + 'Only0123456789';
  const make = (length) => letters.repeat(Math.ceil(length / letters.length)).slice(0, length);
  const pemLabel = ['PRIVATE', 'KEY'].join(' ');
  return {
    supabase_service_role: fakeJwt('service_' + 'role'),
    supabase_anon: fakeJwt('an' + 'on'),
    supabase_secret: ['sb', 'secret', make(40)].join('_'),
    supabase_publishable: ['sb', 'publishable', make(40)].join('_'),
    openai: ['sk', make(48)].join('-'),
    openai_project: ['sk', 'proj', make(80)].join('-'),
    anthropic: ['sk', 'ant', 'api03', make(80)].join('-'),
    stripe_secret: ['sk', 'live', make(32)].join('_'),
    stripe_restricted: ['rk', 'live', make(32)].join('_'),
    aws: 'AK' + 'IA' + 'FIXTUREONLY12345',
    github: ['ghp', make(36)].join('_'),
    github_fine: ['github', 'pat', make(82)].join('_'),
    slack: ['xo' + 'xb', '123456789012', '123456789012', make(24)].join('-'),
    sendgrid: ['S' + 'G', make(22), make(43)].join('.'),
    resend: ['r' + 'e', make(32)].join('_'),
    telegram: ['12345' + '6789', make(35)].join(':'),
    pem: [`-----BEGIN ${pemLabel}-----`, Buffer.from('invalid fixture key body '.repeat(4)).toString('base64'), `-----END ${pemLabel}-----`].join('\n'),
    google: 'AI' + 'za' + make(35),
  };
}
